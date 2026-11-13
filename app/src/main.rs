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
    Rect, WebContext, WebView, WebViewBuilder, WebViewBuilderExtWindows, WebViewExtWindows,
    http::{Response, header::CONTENT_TYPE},
};

/// The webview is a child of the window whose size the shell sets itself. While the
/// window glides to a new size the webview already sits at the larger of the two
/// sizes (clipped by the window), so the page lays out once and the window edge
/// simply reveals or covers it, with no per-frame re-layout.
fn set_webview_size(webview: &WebView, size: PhysicalSize<u32>) {
    let _ = webview.set_bounds(Rect {
        position: wry::dpi::PhysicalPosition::new(0, 0).into(),
        size: wry::dpi::PhysicalSize::new(size.width, size.height).into(),
    });
}

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

const ANIM_DURATION: Duration = Duration::from_millis(240);
const FRAME: Duration = Duration::from_millis(8);

impl Anim {
    /// Returns the frame for `now` and whether the animation has finished.
    fn frame(&self, now: Instant) -> (PhysicalPosition<i32>, PhysicalSize<u32>, bool) {
        let t = (now - self.start).as_secs_f64() / ANIM_DURATION.as_secs_f64();
        if t >= 1.0 {
            return (self.to_pos, self.to_size, true);
        }
        // ease-in-out cubic: starts and lands softly, so the edge never lurches
        let e = if t < 0.5 { 4.0 * t * t * t } else { 1.0 - (-2.0 * t + 2.0).powi(3) / 2.0 };
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

    let start_size = window.inner_size();
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_bounds(Rect {
            position: wry::dpi::PhysicalPosition::new(0, 0).into(),
            size: wry::dpi::PhysicalSize::new(start_size.width, start_size.height).into(),
        })
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
        .build_as_child(&window)?;

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
                        let to = a.to_size;
                        anim = None;
                        set_webview_size(&webview, to);
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
                        // Lay the page out once at its final size (or keep the larger
                        // current one while shrinking), then glide the window over it.
                        set_webview_size(
                            &webview,
                            PhysicalSize::new(inner.width.max(w), inner.height.max(h)),
                        );
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
            // As a child webview it no longer hears these from the window itself.
            Event::WindowEvent { event: WindowEvent::Focused(true), .. } => {
                let _ = webview.focus();
            }
            Event::WindowEvent { event: WindowEvent::Moved(_), .. } => {
                // Keeps dropdowns and tooltips anchored after the window moves.
                let _ = unsafe { webview.controller().NotifyParentWindowPositionChanged() };
            }
            Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                window.set_maximized(!window.is_maximized())
            }
            Event::UserEvent(UserEvent::Resize(dir)) => {
                let _ = window.drag_resize_window(dir);
            }
            Event::WindowEvent { event: WindowEvent::Resized(size), .. } => {
                let m = window.is_maximized();
                if m {
                    anim = None;
                }
                // During a glide the webview keeps its final size; otherwise it follows
                // the window (user drags, maximise, first fit).
                if anim.is_none() && size.width > 0 && size.height > 0 {
                    set_webview_size(&webview, size);
                }
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
