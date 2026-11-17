//! Shared by the app (verify) and `pbf_sign` (sign): what exactly gets signed.
//!
//! A release signature covers the version *and* the exe's SHA-256, so an old
//! signed exe can't be re-published under a newer version number.

use sha2::{Digest, Sha256};

/// "v1.0", "1.0.2" -> [1, 0, 0] / [1, 0, 2]. Up to three numeric parts.
pub fn parse_version(s: &str) -> Option<[u32; 3]> {
    let s = s.trim();
    let s = s.strip_prefix(['v', 'V']).unwrap_or(s);
    let parts: Vec<&str> = s.split('.').collect();
    if parts.is_empty() || parts.len() > 3 {
        return None;
    }
    let mut v = [0u32; 3];
    for (i, p) in parts.iter().enumerate() {
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) || p.len() > 6 {
            return None;
        }
        v[i] = p.parse().ok()?;
    }
    Some(v)
}

/// "1.0" when the patch number is 0, else "1.0.2".
#[allow(dead_code)]
pub fn display_version(v: [u32; 3]) -> String {
    if v[2] == 0 { format!("{}.{}", v[0], v[1]) } else { format!("{}.{}.{}", v[0], v[1], v[2]) }
}

pub fn message(version: [u32; 3], exe: &[u8]) -> Vec<u8> {
    let digest = Sha256::digest(exe);
    let mut m = format!("PBF-Generator release\n{}.{}.{}\n", version[0], version[1], version[2]).into_bytes();
    for b in digest {
        m.extend_from_slice(format!("{b:02x}").as_bytes());
    }
    m
}

#[allow(dead_code)]
pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    if s.len() % 2 != 0 || !s.is_ascii() {
        return None;
    }
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()).collect()
}
