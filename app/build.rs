//! Build step:
//!  1. Picks the newest "PBF generator vX.Y.html" from the project root.
//!  2. Replaces the Google Fonts <link> tags with the locally cached fonts
//!     (assets/fonts.css + assets/fonts/*.woff2) inlined as base64, so the app
//!     works fully offline.
//!  3. Converts ../owl.jpg into the exe icon and a raw RGBA window icon.

use base64::Engine;
use image::imageops::FilterType;
use std::{env, fs, path::PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest.parent().unwrap().to_path_buf();
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());

    // ---- 1. newest HTML -------------------------------------------------
    let mut best: Option<(Vec<u32>, PathBuf)> = None;
    for entry in fs::read_dir(&root).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if let Some(rest) = lower.strip_prefix("pbf generator v") {
            if let Some(ver) = rest.strip_suffix(".html") {
                let v: Vec<u32> = ver.split('.').map(|p| p.parse().unwrap_or(0)).collect();
                if best.as_ref().map_or(true, |(bv, _)| v > *bv) {
                    best = Some((v, entry.path()));
                }
            }
        }
    }
    let (_, html_path) = best.expect("no 'PBF generator vX.Y.html' found in project root");
    println!("cargo:rerun-if-changed={}", root.display());
    println!("cargo:rerun-if-changed={}", html_path.display());
    println!("cargo:warning=Embedding {}", html_path.file_name().unwrap().to_string_lossy());
    let html = fs::read_to_string(&html_path).unwrap();

    // ---- 2. inline fonts ------------------------------------------------
    let assets = manifest.join("assets");
    println!("cargo:rerun-if-changed={}", assets.display());
    let mut css = fs::read_to_string(assets.join("fonts.css")).unwrap();
    let mut fonts: Vec<_> = fs::read_dir(assets.join("fonts")).unwrap().flatten().collect();
    fonts.sort_by_key(|e| e.file_name());
    for f in fonts {
        let name = f.file_name().to_string_lossy().to_string();
        let b64 = base64::engine::general_purpose::STANDARD.encode(fs::read(f.path()).unwrap());
        css = css.replace(&format!("fonts/{name}"), &format!("data:font/woff2;base64,{b64}"));
    }
    let style = format!("<style>/* embedded fonts */\n{css}</style>");

    let mut kept = Vec::new();
    let mut injected = false;
    for line in html.lines() {
        if line.contains("fonts.googleapis.com") || line.contains("fonts.gstatic.com") {
            if !injected {
                kept.push(style.as_str());
                injected = true;
            }
            continue;
        }
        kept.push(line);
    }
    if !injected {
        println!("cargo:warning=Google Fonts link not found; fonts not injected");
    }
    fs::write(out.join("index.html"), kept.join("\n")).unwrap();

    // ---- 3. icon --------------------------------------------------------
    let jpg = root.join("owl.jpg");
    println!("cargo:rerun-if-changed={}", jpg.display());
    let img = image::open(&jpg).expect("owl.jpg not found");
    let img = brighten_green(&crop_to_green(&img));

    let win_icon = rounded(&img, 256);
    fs::write(out.join("icon_256.rgba"), win_icon.as_raw()).unwrap();
    win_icon.save(out.join("icon_preview.png")).unwrap();

    // Multi-size .ico (each frame PNG-encoded).
    let ico_path = out.join("owl.ico");
    let mut frames = Vec::new();
    for s in [16u32, 24, 32, 48, 64, 128, 256] {
        let rgba = rounded(&img, s);
        frames.push(
            image::codecs::ico::IcoFrame::as_png(rgba.as_raw(), s, s, image::ExtendedColorType::Rgba8)
                .unwrap(),
        );
    }
    let file = fs::File::create(&ico_path).unwrap();
    image::codecs::ico::IcoEncoder::new(file).encode_images(&frames).unwrap();

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon(ico_path.to_str().unwrap());
        res.compile().expect("failed to compile Windows resources");
    }
}

/// Lifts the green background a little brighter, leaving the owl alone.
/// Each pixel is weighted by how green it is, so feather edges blend smoothly.
fn brighten_green(img: &image::DynamicImage) -> image::DynamicImage {
    let mut rgb = img.to_rgb8();
    for p in rgb.pixels_mut() {
        let (r, g, b) = (p[0] as f32, p[1] as f32, p[2] as f32);
        let lead = g - r.max(b); // how far green leads the other channels
        let w = ((lead - 12.0) / 40.0).clamp(0.0, 1.0);
        if w == 0.0 {
            continue;
        }
        // Raise brightness ~45% and push a touch more saturation into green.
        let k = 1.0 + 0.45 * w;
        let nr = r * k;
        let ng = g * k + 14.0 * w;
        let nb = b * k;
        p[0] = nr.round().clamp(0.0, 255.0) as u8;
        p[1] = ng.round().clamp(0.0, 255.0) as u8;
        p[2] = nb.round().clamp(0.0, 255.0) as u8;
    }
    image::DynamicImage::ImageRgb8(rgb)
}

/// Resizes to `size`×`size` and masks the corners to a rounded square
/// (radius 22% of the side, anti-aliased with 4×4 supersampling).
fn rounded(img: &image::DynamicImage, size: u32) -> image::RgbaImage {
    let mut out = img.resize_exact(size, size, FilterType::Lanczos3).to_rgba8();
    let s = size as f32;
    let r = s * 0.22;
    const N: u32 = 4;
    for y in 0..size {
        for x in 0..size {
            let mut inside = 0u32;
            for sy in 0..N {
                for sx in 0..N {
                    let px = x as f32 + (sx as f32 + 0.5) / N as f32;
                    let py = y as f32 + (sy as f32 + 0.5) / N as f32;
                    // Distance from the nearest corner-circle centre (zero along the straight edges).
                    let dx = (r - px).max(px - (s - r)).max(0.0);
                    let dy = (r - py).max(py - (s - r)).max(0.0);
                    if dx * dx + dy * dy <= r * r {
                        inside += 1;
                    }
                }
            }
            let a = out.get_pixel(x, y)[3] as u32 * inside / (N * N);
            out.get_pixel_mut(x, y)[3] = a as u8;
        }
    }
    out
}

/// owl.jpg is a green rounded-square tile on a white background with a drop
/// shadow. Find the green tile's edges and crop just inside its rounded
/// corners, leaving only owl-on-green (no white, shadow or border).
fn crop_to_green(img: &image::DynamicImage) -> image::DynamicImage {
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    let green = |x: u32, y: u32| {
        let p = rgb.get_pixel(x, y);
        let (r, g, b) = (p[0] as i32, p[1] as i32, p[2] as i32);
        g > r + 25 && g > b + 15
    };
    let (mx, my) = (w / 2, h / 2);
    let left = (0..w).find(|&x| green(x, my)).unwrap_or(0);
    let right = (0..w).rev().find(|&x| green(x, my)).unwrap_or(w - 1);
    let top = (0..h).find(|&y| green(mx, y)).unwrap_or(0);
    let tile = right.saturating_sub(left).max(1);
    // Rounded corners are ~12% of the tile; clearing them needs ~3.5%, plus
    // margin for the dark border and anti-aliasing.
    let inset = tile * 6 / 100;
    let side = (tile - 2 * inset).min(h - top - inset);
    img.crop_imm(left + inset, top + inset, side, side)
}
