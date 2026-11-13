# PBF Generator

A Windows desktop app for writing peripheral blood film (PBF) comments. You pick findings, and it builds the comment text.

## Layout

- `ui/PBF generator v3.6.html`: the whole UI as a single page. Older versions live in git history.
- `app/`: a Rust shell (wry/tao) that embeds the newest `ui/PBF generator vX.Y.html`, the fonts in `app/assets/` and the `owl.jpg` icon into one standalone `.exe`.
- `tests/harness.js`: a test harness that runs in the browser against the HTML page.

## Build

```bash
cd app
cargo build --release
```

The build writes the exe to `app/target/release/pbf_generator.exe`. Prebuilt copies are on the Releases page.
