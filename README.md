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

A plain build has the updater switched off. Release builds come from `tools/release.ps1`.

## Releases and updates

The repo is private, so the app reads releases with a fine-grained token that can only read this repo's contents. Updates must be signed with the release key, so the token alone cannot push an update.

1. Once: create a fine-grained token (only this repo, Contents: Read-only), then run `tools/set-update-token.ps1` in a terminal and paste it at the hidden prompt. It is stored DPAPI-encrypted in `%APPDATA%\PBF Generator release\`.
2. Bump `version` in `app/Cargo.toml`, then run `tools/release.ps1 -Publish`.

The first release run creates the signing key in `%APPDATA%\PBF Generator release\signing-key.dat` and writes the public half to `app/update_pubkey.txt`. Back up the key file: installed copies only accept updates signed with it.
