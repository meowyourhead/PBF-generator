# PBF Generator

A Windows desktop app for writing peripheral blood film (PBF) comments. You pick findings, and it builds the comment text.

## Layout

- `ui/PBF generator vX.Y.html`: the whole UI as a single page. Older versions live in git history.
- `app/`: a Rust shell (wry/tao) that embeds the newest `ui/PBF generator vX.Y.html`, the fonts in `app/assets/` and the `owl.jpg` icon into one standalone `.exe`.
- `app/src/updater.rs`: Settings > Updates. Checks this repo's GitHub Releases and installs signed updates.
- `tools/`: release scripts (token setup, build + sign + publish).
- `tests/harness.js`: a test harness that runs in the browser against the HTML page.

## Build

```bash
cd app
cargo build --release
```

Release builds come from `tools/release.ps1`, which also signs the exe.

## Releases and updates

Settings > Updates reads this repo's latest GitHub release (no credentials needed). It installs only newer versions, and only when the exe's Ed25519 signature checks out against the public key in `app/update_pubkey.txt`.

To release: bump `version` in `app/Cargo.toml`, then run `tools/release.ps1 -Publish`.

The signing key is kept DPAPI-encrypted in `%APPDATA%\PBF Generator release\signing-key.dat`, outside the repo. Back it up: installed copies only accept updates signed with it.
