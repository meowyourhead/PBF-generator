//! Update channel: GitHub Releases of the private repo.
//!
//! Security model
//!  - Only this (Rust) side talks to GitHub. The page sends "update:check" /
//!    "update:install" and gets back a status; it never sees the token or a URL,
//!    and it can't point a download anywhere.
//!  - The token is a fine-grained PAT limited to this one repo, Contents: read.
//!    It is sealed into the exe at build time (see build.rs) and only decrypted
//!    in memory for a request, then wiped.
//!  - HTTPS only, TLS 1.2+, via Windows' own TLS stack. Redirects are followed by
//!    hand so the token is never sent to the download host.
//!  - Every release exe must carry an Ed25519 signature (made with a private key
//!    that never leaves the developer's machine) over its version and SHA-256.
//!    A leaked token therefore can't be used to push an update: it is read-only,
//!    and an unsigned or re-labelled exe is rejected. Only newer versions install.

use crate::signing;
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce, aead::Aead};
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{Value, json};
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use zeroize::Zeroizing;

const REPO: &str = "meowyourhead/PBF-generator";
const ASSET_EXE: &str = "PBF-Generator.exe";
const ASSET_SIG: &str = "PBF-Generator.exe.sig";
const MAX_EXE: u64 = 64 * 1024 * 1024;
const MAX_SMALL: u64 = 2 * 1024 * 1024;

static SEALED: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/update_token.bin"));
static KA: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/update_ka.bin"));
static KB: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/update_kb.bin"));
static PUBKEY: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/update_pubkey.bin"));

pub fn current_version() -> [u32; 3] {
    signing::parse_version(env!("CARGO_PKG_VERSION")).expect("Cargo version is numeric")
}

pub fn configured() -> bool {
    SEALED.len() > 12 + 16 && KA.len() == 32 && KB.len() == 32 && PUBKEY.len() == 32
}

/// Init script giving the page the version and whether updates are available.
pub fn page_info_script() -> String {
    format!(
        "window.__pbfApp = Object.freeze({});",
        json!({ "version": signing::display_version(current_version()), "updates": configured() })
    )
}

#[derive(Clone)]
struct Release {
    version: [u32; 3],
    exe_url: String,
    exe_size: u64,
    sig_url: String,
}

#[derive(Default)]
pub struct Updater {
    pending: Mutex<Option<Release>>,
    busy: Mutex<bool>,
}

/// Replies the page understands (window.__pbfUpdate).
pub fn reply_error(msg: &str) -> String { json!({ "state": "error", "message": msg }).to_string() }
fn reply_progress(msg: &str) -> String { json!({ "state": "installing", "message": msg }).to_string() }

pub enum Outcome {
    /// Send this JSON to the page.
    Reply(String),
    /// New exe is in place and started; the app should quit.
    Restart,
}

impl Updater {
    fn try_begin(&self) -> bool {
        let mut b = self.busy.lock().unwrap_or_else(|e| e.into_inner());
        if *b { return false; }
        *b = true;
        true
    }
    fn end(&self) {
        *self.busy.lock().unwrap_or_else(|e| e.into_inner()) = false;
    }

    pub fn check(self: &Arc<Self>) -> Outcome {
        if !configured() { return Outcome::Reply(reply_error("Updates are not set up in this build")); }
        if !self.try_begin() { return Outcome::Reply(reply_error("An update is already in progress")); }
        let r = self.check_inner();
        self.end();
        Outcome::Reply(r.unwrap_or_else(|e| reply_error(&e)))
    }

    fn check_inner(&self) -> Result<String, String> {
        let agent = agent()?;
        let auth = auth_header()?;
        let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
        let resp = agent
            .get(&url)
            .set("Authorization", &auth)
            .set("Accept", "application/vnd.github+json")
            .set("X-GitHub-Api-Version", "2022-11-28")
            .call()
            .map_err(describe)?;
        let body = read_limited(resp, MAX_SMALL)?;
        let rel: Value = serde_json::from_slice(&body).map_err(|_| "GitHub sent an unexpected reply".to_string())?;

        let tag = rel["tag_name"].as_str().unwrap_or_default();
        let version = signing::parse_version(tag).ok_or("The latest release has an unreadable version")?;
        if version <= current_version() {
            *self.pending.lock().unwrap_or_else(|e| e.into_inner()) = None;
            return Ok(json!({ "state": "latest" }).to_string());
        }
        let assets = rel["assets"].as_array().ok_or("The latest release has no files")?;
        let find = |name: &str| -> Result<(String, u64), String> {
            let a = assets
                .iter()
                .find(|a| a["name"].as_str() == Some(name))
                .ok_or_else(|| format!("The latest release is missing {name}"))?;
            let url = a["url"].as_str().unwrap_or_default();
            // Only GitHub's own API URL for an asset of this repo is ever fetched.
            let prefix = format!("https://api.github.com/repos/{REPO}/releases/assets/");
            let id = url.strip_prefix(&prefix).unwrap_or_default();
            if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
                return Err("The latest release has an unexpected download link".into());
            }
            Ok((url.to_owned(), a["size"].as_u64().unwrap_or(0)))
        };
        let (exe_url, exe_size) = find(ASSET_EXE)?;
        let (sig_url, _) = find(ASSET_SIG)?;
        if exe_size == 0 || exe_size > MAX_EXE {
            return Err("The update file has an unexpected size".into());
        }
        *self.pending.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(Release { version, exe_url, exe_size, sig_url });
        Ok(json!({ "state": "available", "version": signing::display_version(version) }).to_string())
    }

    /// `progress` forwards interim status lines to the page.
    pub fn install(self: &Arc<Self>, progress: impl Fn(String)) -> Outcome {
        if !configured() { return Outcome::Reply(reply_error("Updates are not set up in this build")); }
        if !self.try_begin() { return Outcome::Reply(reply_error("An update is already in progress")); }
        let r = self.install_inner(&progress);
        self.end();
        match r {
            Ok(()) => Outcome::Restart,
            Err(e) => Outcome::Reply(reply_error(&e)),
        }
    }

    fn install_inner(&self, progress: &impl Fn(String)) -> Result<(), String> {
        let rel = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or("Check for updates first")?;
        let agent = agent()?;
        let auth = auth_header()?;

        let sig = fetch_asset(&agent, &rel.sig_url, &auth, 4096)?;
        let exe = fetch_asset(&agent, &rel.exe_url, &auth, rel.exe_size)?;
        drop(auth);
        if exe.len() as u64 != rel.exe_size {
            return Err("The download was incomplete. Try again.".into());
        }

        progress(reply_progress("Checking signature…"));
        verify(rel.version, &exe, &sig)?;
        // A Windows exe starts with "MZ"; a cheap sanity check on top of the signature.
        if !exe.starts_with(b"MZ") {
            return Err("The update file is not a Windows program".into());
        }

        progress(reply_progress("Restarting…"));
        swap_and_launch(&exe)
    }
}

fn verify(version: [u32; 3], exe: &[u8], sig_file: &[u8]) -> Result<(), String> {
    const BAD: &str = "The update's signature is not valid, so it was not installed";
    let key: [u8; 32] = PUBKEY.try_into().map_err(|_| BAD.to_string())?;
    let key = VerifyingKey::from_bytes(&key).map_err(|_| BAD.to_string())?;
    let sig_hex = std::str::from_utf8(sig_file).map_err(|_| BAD.to_string())?;
    let sig: [u8; 64] = signing::from_hex(sig_hex)
        .and_then(|v| v.try_into().ok())
        .ok_or_else(|| BAD.to_string())?;
    key.verify_strict(&signing::message(version, exe), &Signature::from_bytes(&sig))
        .map_err(|_| BAD.to_string())
}

/// Puts the new exe where the running one is and starts it. Windows lets a
/// running exe be renamed (not deleted), so: current -> .old, new -> current.
fn swap_and_launch(bytes: &[u8]) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "Can't find the app's own file".to_string())?;
    let (new, old) = side_files(&exe);
    let denied = |_| "Can't write next to the app. Move it to a folder you can write to.".to_string();
    let _ = std::fs::remove_file(&new);
    std::fs::write(&new, bytes).map_err(denied)?;
    let _ = std::fs::remove_file(&old);
    if let Err(e) = std::fs::rename(&exe, &old) {
        let _ = std::fs::remove_file(&new);
        return Err(denied(e));
    }
    if let Err(e) = std::fs::rename(&new, &exe) {
        let _ = std::fs::rename(&old, &exe);
        let _ = std::fs::remove_file(&new);
        return Err(denied(e));
    }
    std::process::Command::new(&exe)
        .spawn()
        .map_err(|_| "Update installed. Please reopen the app.".to_string())?;
    Ok(())
}

fn side_files(exe: &Path) -> (PathBuf, PathBuf) {
    let name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    (exe.with_file_name(format!("{name}.new")), exe.with_file_name(format!("{name}.old")))
}

/// Removes the previous exe left behind by an update (it may still be closing).
pub fn clean_up_old() {
    let Ok(exe) = std::env::current_exe() else { return };
    let (new, old) = side_files(&exe);
    if !old.exists() && !new.exists() { return; }
    std::thread::spawn(move || {
        for _ in 0..40 {
            let _ = std::fs::remove_file(&new);
            if std::fs::remove_file(&old).is_ok() || !old.exists() { break; }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

fn token() -> Result<Zeroizing<String>, String> {
    const BAD: &str = "This build's update key is damaged";
    let mut key = Zeroizing::new([0u8; 32]);
    for i in 0..32 {
        key[i] = KA[i] ^ KB[i];
    }
    let cipher = ChaCha20Poly1305::new((&*key).into());
    let mut pt = Zeroizing::new(
        cipher
            .decrypt(Nonce::from_slice(&SEALED[..12]), &SEALED[12..])
            .map_err(|_| BAD.to_string())?,
    );
    let s = String::from_utf8(std::mem::take(&mut *pt)).map_err(|_| BAD.to_string())?;
    Ok(Zeroizing::new(s))
}

fn auth_header() -> Result<Zeroizing<String>, String> {
    let t = token()?;
    Ok(Zeroizing::new(format!("Bearer {}", t.as_str())))
}

fn agent() -> Result<ureq::Agent, String> {
    let tls = native_tls::TlsConnector::builder()
        .min_protocol_version(Some(native_tls::Protocol::Tlsv12))
        .build()
        .map_err(|_| "Couldn't set up a secure connection".to_string())?;
    Ok(ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .https_only(true)
        .redirects(0)
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .user_agent(concat!("PBF-Generator-Updater/", env!("CARGO_PKG_VERSION")))
        .build())
}

/// Downloads a release asset. GitHub answers with a redirect to a short-lived
/// signed URL on its download host; that second request carries no token.
fn fetch_asset(agent: &ureq::Agent, api_url: &str, auth: &str, limit: u64) -> Result<Vec<u8>, String> {
    let resp = agent
        .get(api_url)
        .set("Authorization", auth)
        .set("Accept", "application/octet-stream")
        .set("X-GitHub-Api-Version", "2022-11-28")
        .call()
        .map_err(describe)?;
    let resp = if (300..400).contains(&resp.status()) {
        let loc = resp.header("Location").unwrap_or_default().to_owned();
        if !loc.starts_with("https://") {
            return Err("GitHub sent an unexpected download link".into());
        }
        agent.get(&loc).call().map_err(describe)?
    } else {
        resp
    };
    if resp.status() != 200 {
        return Err("The download failed. Try again.".into());
    }
    read_limited(resp, limit)
}

fn read_limited(resp: ureq::Response, limit: u64) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    resp.into_reader()
        .take(limit + 1)
        .read_to_end(&mut buf)
        .map_err(|_| "The connection dropped. Try again.".to_string())?;
    if buf.len() as u64 > limit {
        return Err("GitHub sent more data than expected".into());
    }
    Ok(buf)
}

fn describe(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(401, _) => "The update token was rejected or has expired".into(),
        ureq::Error::Status(403, _) | ureq::Error::Status(429, _) => {
            "GitHub refused the request (rate limit or permissions). Try again later.".into()
        }
        ureq::Error::Status(404, _) => "No release found on GitHub".into(),
        ureq::Error::Status(code, _) => format!("GitHub returned an error ({code})"),
        ureq::Error::Transport(_) => "Couldn't reach GitHub. Check your internet connection.".into(),
    }
}
