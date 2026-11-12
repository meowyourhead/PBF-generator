#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::borrow::Cow;
use std::time::{Duration, Instant};
use tao::{
    dpi::{LogicalSize, PhysicalPosition, PhysicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::windows::WindowBuilderExtWindows,
    window::{Icon, ResizeDirection, WindowBuilder},
};
use wry::{
    WebContext, WebViewBuilder, WebViewBuilderExtWindows,
    http::{Response, header::CONTENT_TYPE},
};

static INDEX_HTML: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/index.html"));
static ICON_RGBA: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/icon_256.rgba"));
static TITLEBAR_JS: &str = include_str!("titlebar.js");

#[derive(Clone, Copy, PartialEq)]
enum Placement {
    /// Intermediate step: resize only.
    None,
    /// First open: centre on the screen and show the window.
    Center,
    /// Later refits (Display scale): keep the position, nudged back on screen.
    Keep,
}

/// Messages from the in-page shell script (see titlebar.js).
enum UserEvent {
    Drag,
    Minimize,
    ToggleMaximize,
    Close,
    Resize(ResizeDirection),
    /// Page zoom for Display scale (1.0 = 100%).
    Zoom(f64),
    /// Fit the window to the page content. All values in physical pixels:
    /// inner width/height and the screen's available width/height.
    Fit { w: u32, h: u32, avail_w: i32, avail_h: i32, place: Placement },
}

fn parse_message(msg: &str) -> Option<UserEvent> {
    if let Some(z) = msg.strip_prefix("zoom:") {
        let z: f64 = z.parse().ok()?;
        return (0.5..=2.0).contains(&z).then_some(UserEvent::Zoom(z));
    }
    let mut it = msg.strip_prefix("fit:")?.split(':');
    let w = it.next()?.parse().ok()?;
    let h = it.next()?.parse().ok()?;
    let avail_w = it.next()?.parse().ok()?;
    let avail_h = it.next()?.parse().ok()?;
    let place = match it.next() {
        Some("center") => Placement::Center,
        Some("keep") => Placement::Keep,
        _ => Placement::None,
    };
    Some(UserEvent::Fit { w, h, avail_w, avail_h, place })
}

/// An eased window move/resize, so autofit glides instead of jumping.
struct Anim {
    from_pos: PhysicalPosition<i32>,
    from_size: PhysicalSize<u32>,
    to_pos: PhysicalPosition<i32>,
    to_size: PhysicalSize<u32>,
    start: Instant,
}

const ANIM_DURATION: Duration = Duration::from_millis(180);
const FRAME: Duration = Duration::from_millis(8);

impl Anim {
    /// Returns the frame for `now` and whether the animation has finished.
    fn frame(&self, now: Instant) -> (PhysicalPosition<i32>, PhysicalSize<u32>, bool) {
        let t = (now - self.start).as_secs_f64() / ANIM_DURATION.as_secs_f64();
        if t >= 1.0 {
            return (self.to_pos, self.to_size, true);
        }
        let e = 1.0 - (1.0 - t).powi(3); // ease-out cubic
        let lerp = |a: f64, b: f64| (a + (b - a) * e).round();
        (
            PhysicalPosition::new(
                lerp(self.from_pos.x as f64, self.to_pos.x as f64) as i32,
                lerp(self.from_pos.y as f64, self.to_pos.y as f64) as i32,
            ),
            PhysicalSize::new(
                lerp(self.from_size.width as f64, self.to_size.width as f64) as u32,
                lerp(self.from_size.height as f64, self.to_size.height as f64) as u32,
            ),
            false,
        )
    }
}

fn data_dir() -> std::path::PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("PBF Generator")
}

fn main() -> wry::Result<()> {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("PBF Generator")
        .with_decorations(false)
        .with_undecorated_shadow(true)
        // Hidden until the page has measured itself, so it opens already fitted.
        .with_visible(false)
        .with_inner_size(LogicalSize::new(1400.0, 900.0))
        .with_min_inner_size(LogicalSize::new(400.0, 300.0))
        .with_window_icon(Icon::from_rgba(ICON_RGBA.to_vec(), 256, 256).ok())
        .build(&event_loop)
        .expect("failed to create window");

    // Persistent profile so localStorage (theme, history, settings) survives restarts.
    let mut context = WebContext::new(Some(data_dir()));

    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_https_scheme(true)
        .with_custom_protocol("pbf".into(), |_id, _req| {
            Response::builder()
                .header(CONTENT_TYPE, "text/html; charset=utf-8")
                .body(Cow::Borrowed(INDEX_HTML))
                .unwrap()
        })
        .with_initialization_script(TITLEBAR_JS)
        // Generate copies the comment; allow it without WebView2's clipboard prompt.
        .with_clipboard(true)
        .with_ipc_handler(move |req| {
            let ev = match req.body().as_str() {
                "drag" => UserEvent::Drag,
                "minimize" => UserEvent::Minimize,
                "toggle-max" => UserEvent::ToggleMaximize,
                "close" => UserEvent::Close,
                "resize-n" => UserEvent::Resize(ResizeDirection::North),
                "resize-s" => UserEvent::Resize(ResizeDirection::South),
                "resize-e" => UserEvent::Resize(ResizeDirection::East),
                "resize-w" => UserEvent::Resize(ResizeDirection::West),
                "resize-ne" => UserEvent::Resize(ResizeDirection::NorthEast),
                "resize-nw" => UserEvent::Resize(ResizeDirection::NorthWest),
                "resize-se" => UserEvent::Resize(ResizeDirection::SouthEast),
                "resize-sw" => UserEvent::Resize(ResizeDirection::SouthWest),
                other => match parse_message(other) {
                    Some(ev) => ev,
                    None => return,
                },
            };
            let _ = proxy.send_event(ev);
        })
        .with_url("pbf://localhost/")
        .with_devtools(cfg!(debug_assertions))
        .build(&window)?;

    let mut was_maximized = false;
    let mut shown = false;
    let mut anim: Option<Anim> = None;
    // Show anyway if the page never reports its size.
    let show_deadline = Instant::now() + Duration::from_secs(4);
    event_loop.run(move |event, _, control_flow| {
        *control_flow = if !shown {
            ControlFlow::WaitUntil(show_deadline)
        } else if anim.is_some() {
            ControlFlow::WaitUntil(Instant::now() + FRAME)
        } else {
            ControlFlow::Wait
        };
        if !shown && Instant::now() >= show_deadline {
            window.set_visible(true);
            shown = true;
        }
        match event {
            Event::MainEventsCleared => {
                if let Some(a) = &anim {
                    let (pos, size, done) = a.frame(Instant::now());
                    if a.from_pos != a.to_pos {
                        window.set_outer_position(pos);
                    }
                    window.set_inner_size(size);
                    if done {
                        anim = None;
                        *control_flow = ControlFlow::Wait;
                    }
                }
            }
            Event::UserEvent(UserEvent::Zoom(z)) => {
                let _ = webview.zoom(z);
            }
            Event::UserEvent(UserEvent::Fit { w, h, avail_w, avail_h, place }) => {
                if !window.is_maximized() {
                    let target = PhysicalSize::new(w, h);
                    // Outer size = inner size + the frame tao keeps around undecorated windows.
                    let inner = window.inner_size();
                    let outer = window.outer_size();
                    let frame_w = outer.width as i32 - inner.width as i32;
                    let frame_h = outer.height as i32 - inner.height as i32;
                    let (ow, oh) = (w as i32 + frame_w, h as i32 + frame_h);
                    let cur = window.outer_position().unwrap_or_default();
                    let pos = match (place, window.current_monitor()) {
                        (Placement::None, _) | (_, None) => cur,
                        (_, Some(mon)) => {
                            let m = mon.position();
                            let ms = mon.size();
                            let aw = avail_w.min(ms.width as i32);
                            let ah = avail_h.min(ms.height as i32);
                            if place == Placement::Center || !shown {
                                PhysicalPosition::new(m.x + (aw - ow) / 2, m.y + ((ah - oh) / 2).max(0))
                            } else {
                                PhysicalPosition::new(
                                    cur.x.clamp(m.x, (m.x + aw - ow).max(m.x)),
                                    cur.y.clamp(m.y, (m.y + ah - oh).max(m.y)),
                                )
                            }
                        }
                    };
                    if place == Placement::Keep && shown {
                        // Glide from wherever the window is now (even mid-animation).
                        anim = Some(Anim {
                            from_pos: cur,
                            from_size: inner,
                            to_pos: pos,
                            to_size: target,
                            start: Instant::now(),
                        });
                        *control_flow = ControlFlow::WaitUntil(Instant::now());
                    } else {
                        anim = None;
                        window.set_inner_size(target);
                        if pos != cur {
                            window.set_outer_position(pos);
                        }
                    }
                }
                if place == Placement::Center && !shown {
                    window.set_visible(true);
                    window.set_focus();
                    shown = true;
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. }
            | Event::UserEvent(UserEvent::Close) => *control_flow = ControlFlow::Exit,
            Event::UserEvent(UserEvent::Drag) => {
                let _ = window.drag_window();
            }
            Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                window.set_maximized(!window.is_maximized())
            }
            Event::UserEvent(UserEvent::Resize(dir)) => {
                let _ = window.drag_resize_window(dir);
            }
            Event::WindowEvent { event: WindowEvent::Resized(_), .. } => {
                let m = window.is_maximized();
                if m != was_maximized {
                    was_maximized = m;
                    let _ = webview.evaluate_script(&format!(
                        "window.__pbfSetMaximized && window.__pbfSetMaximized({m})"
                    ));
                }
            }
            _ => {}
        }
    });
}
