// Injected by the desktop shell (the window has no native title bar):
//  - a thin top row holds the window controls and acts as the title bar;
//  - the page background and card side rails also drag the window;
//  - edges resize the window;
//  - window.__pbfShell.setScale(s) zooms the whole page (Display scale) and
//    refits the window; the controls stay the same physical size;
//  - window.__pbfShell.refit() refits after the page changes its own size;
//  - on first open the window is sized to fit the content down to Comment.
(() => {
  const BAR_H = 28;   // physical-ish (logical px at 100% scale)
  const BAR_GAP = 4;  // space between the bar and the first card
  const EDGE = 6;
  const ANIM_MS = 180; // matches the shell's window resize animation
  const send = (m) => window.ipc.postMessage(m);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const systemDpr = window.devicePixelRatio || 1;   // before any zoom is applied
  let maximized = false;
  let scale = 1;
  let initialFitDone = false;
  let fitting = null;

  function setScaleVar() {
    document.documentElement.style.setProperty('--pbf-scale', String(scale));
  }

  // ---- Fit the window to the content (Red cell ... Comment) ----------------
  function contentHeightCss() {
    const app = document.querySelector('.app');
    const cs = getComputedStyle(document.body);
    return app.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }
  // Rows that adapt to whatever width the cards set (the Generate / Reset all row
  // wraps its keyboard hints), so they must not drive the window width.
  const FIT_IGNORE = '.dock-actions, [data-fit-ignore]';
  function contentWidthCss() {
    // Widest the cards need without wrapping (the page caps itself at its max-width).
    const app = document.querySelector('.app');
    const cs = getComputedStyle(document.body);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const ignored = [...document.querySelectorAll(FIT_IGNORE)].map(el => [el, el.style.display]);
    ignored.forEach(([el]) => { el.style.display = 'none'; });
    const old = app.style.width;
    app.style.width = 'max-content';
    const natural = app.getBoundingClientRect().width;
    app.style.width = old;
    ignored.forEach(([el, d]) => { el.style.display = d; });
    const cap = parseFloat(getComputedStyle(app).maxWidth) || natural;
    return Math.min(natural, cap) + pad;
  }
  async function zoomSettled() {
    // The page zoom lands asynchronously; wait until devicePixelRatio reflects it.
    // Only waits when a zoom change is actually in flight, so ordinary fits start at once.
    const want = systemDpr * scale;
    if (Math.abs(window.devicePixelRatio - want) <= 0.01) return;
    for (let i = 0; i < 40 && Math.abs(window.devicePixelRatio - want) > 0.01; i++) await wait(25);
    await wait(30);   // not rAF: the window may still be hidden at start-up
  }
  function resized(timeout) {
    return new Promise((resolve) => {
      const done = () => { window.removeEventListener('resize', done); clearTimeout(t); setTimeout(resolve, 60); };
      const t = setTimeout(done, timeout);
      window.addEventListener('resize', done);
    });
  }
  // Card spacing animates (CSS transitions on margin/padding), e.g. while the theme
  // applies at start-up; measuring mid-transition gives a wrong height.
  async function transitionsSettled(maxMs) {
    const running = document.getAnimations().filter(a => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition
      && /margin|padding|height|width|gap/.test(a.transitionProperty || ''));
    if (!running.length) return;
    await Promise.race([Promise.all(running.map(a => a.finished.catch(() => {}))), wait(maxMs)]);
  }
  function remeasurePage() {
    // Let the page re-measure parts that rewrap with width (the comment box).
    if (typeof window.__pbfRemeasure === 'function') { try { window.__pbfRemeasure(); } catch (e) { /* ignore */ } }
  }
  // Work out the final size without touching the window: lay the page out at the
  // target width, measure its height, then put the layout back. The window can then
  // go to that size in one smooth step instead of several visible jumps.
  function measureTarget(maxWCss, maxHCss) {
    const app = document.querySelector('.app');
    const cs = getComputedStyle(document.body);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const w = Math.min(contentWidthCss(), maxWCss);
    const old = app.style.width;
    app.style.width = (w - pad) + 'px';
    remeasurePage();
    const h = Math.min(contentHeightCss(), maxHCss);
    app.style.width = old;
    return { w, h };
  }
  function screenAvail() {
    // Physical px. screen.* ignores page zoom, so convert with the monitor's own scale.
    const monitorDpr = window.devicePixelRatio / scale;
    return { w: Math.floor(screen.availWidth * monitorDpr), h: Math.floor(screen.availHeight * monitorDpr) };
  }
  // Sizes are sent in physical pixels so zoom and monitor DPI need no guessing.
  async function fitToContent(first) {
    await zoomSettled();
    if (document.fonts.status !== 'loaded') { try { await document.fonts.ready; } catch (e) { /* ignore */ } }
    await transitionsSettled(600);
    if (maximized) return;
    const dpr = window.devicePixelRatio;
    const avail = screenAvail();
    const t = measureTarget(avail.w / dpr, avail.h / dpr);
    const w = Math.ceil(t.w * dpr), h = Math.ceil(t.h * dpr);

    if (first) {
      // Still hidden: size it, check once at the real size, then centre and show.
      send(`fit:${w}:${h}:${avail.w}:${avail.h}:`);
      await resized(400);
      remeasurePage();
      const w2 = Math.min(Math.ceil(contentWidthCss() * dpr), avail.w);
      const h2 = Math.min(Math.ceil(contentHeightCss() * dpr), avail.h);
      send(`fit:${w2}:${h2}:${avail.w}:${avail.h}:center`);
      return;
    }

    // One eased move to the measured size (the shell animates it).
    send(`fit:${w}:${h}:${avail.w}:${avail.h}:keep`);
    await wait(ANIM_MS + 120);
    // Rare case (a breakpoint flipped at the new width): settle with one more small move.
    remeasurePage();
    const w2 = Math.min(Math.ceil(contentWidthCss() * dpr), avail.w);
    const h2 = Math.min(Math.ceil(contentHeightCss() * dpr), avail.h);
    if (Math.abs(w2 - Math.round(window.innerWidth * dpr)) > 2 || Math.abs(h2 - Math.round(window.innerHeight * dpr)) > 2) {
      send(`fit:${w2}:${h2}:${avail.w}:${avail.h}:keep`);
      await wait(ANIM_MS + 60);
    }
  }
  function refit(first) {
    // Serialise fits; a scale change during a fit queues one more. While fitting,
    // scrollbars stay hidden so a brief overflow can't flash one and reflow the page.
    const root = document.documentElement;
    fitting = (fitting || Promise.resolve())
      .then(() => { root.classList.add('pbf-fitting'); return fitToContent(first); })
      .catch(() => {})
      .then(() => { root.classList.remove('pbf-fitting'); });
    return fitting;
  }

  window.__pbfShell = {
    setScale(s) {
      s = Number(s) || 1;
      if (s === scale && initialFitDone) return;
      scale = s;
      setScaleVar();
      send(`zoom:${scale}`);
      if (initialFitDone) refit(false);
    },
    // The page calls this after it changes its own size (e.g. Cell type "+N more").
    refit() {
      if (initialFitDone) refit(false);
    }
  };

  // ---- Controls ------------------------------------------------------------
  const css = `
    #pbf-titlebar { --s: var(--pbf-scale, 1);
      position: fixed; top: 0; left: 0; right: 0; height: calc(${BAR_H}px / var(--s));
      display: flex; align-items: stretch; z-index: 2147483646;
      background: var(--bg, #1a2421); user-select: none; -webkit-user-select: none; }
    #pbf-titlebar .pbf-drag { flex: 1; }
    #pbf-titlebar button { all: unset; width: calc(46px / var(--s)); height: 100%; display: flex;
      align-items: center; justify-content: center; color: var(--fg, #e6efe9);
      cursor: default; transition: background 0.12s; }
    #pbf-titlebar button:hover { background: color-mix(in srgb, var(--fg, #888) 14%, transparent); }
    #pbf-titlebar button:active { background: color-mix(in srgb, var(--fg, #888) 24%, transparent); }
    #pbf-titlebar button.pbf-close:hover { background: #e81123; color: #fff; }
    #pbf-titlebar button.pbf-close:active { background: #f1707a; color: #fff; }
    #pbf-titlebar svg { width: calc(10px / var(--s)); height: calc(10px / var(--s)); fill: none;
      stroke: currentColor; stroke-width: calc(1px / var(--s)); }
    #pbf-titlebar .pbf-max .pbf-restore-ico { display: none; }
    #pbf-titlebar.is-max .pbf-max .pbf-max-ico { display: none; }
    #pbf-titlebar.is-max .pbf-max .pbf-restore-ico { display: block; }
    html body { padding-top: calc(${BAR_H}px / var(--pbf-scale, 1) + ${BAR_GAP}px) !important; }
    /* The window grows to fit the comment, so the comment box need not cap itself
       (its 25vh cap would shrink with the window it is trying to grow). */
    html .dock .output { max-height: none !important; }
    html.pbf-fitting, html.pbf-fitting body { overflow: hidden !important; }

    /* Toasts live in the title bar, centred on the same line as the window controls.
       Only the newest shows; older ones fade out beneath it. The page's own toast
       placement (bottom / transform) is reset so only this centring applies. */
    #pbf-titlebar #notification-area {
      position: absolute; top: 0; bottom: auto; height: 100%; transform: none; margin: 0;
      left: calc(3 * 46px / var(--s)); right: calc(3 * 46px / var(--s));
      display: grid; place-items: center; gap: 0; pointer-events: none; }
    /* A fixed pill height leaves equal gaps above and below (3px each in the 28px bar);
       the text's line fills the pill inside its border, so the text centres too. */
    #pbf-titlebar .notif {
      grid-area: 1 / 1; max-width: 100%; max-height: none; box-sizing: border-box;
      height: calc(22px / var(--s)); margin: 0;
      padding: 0 calc(12px / var(--s));
      font-size: calc(12px / var(--s)); line-height: calc(20px / var(--s));
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      box-shadow: none; border-width: calc(1px / var(--s));
      transition: opacity 0.35s ease;
      animation: pbf-toast-in 0.22s cubic-bezier(0.2, 0, 0, 1) both; }
    #pbf-titlebar .notif:not(:first-child),
    #pbf-titlebar .notif.notif-fade { opacity: 0; padding: 0 calc(12px / var(--s)); max-height: none; height: calc(22px / var(--s)); }
    #pbf-titlebar .notif:not(:first-child) { transition-duration: 0.12s; }
    @keyframes pbf-toast-in { from { opacity: 0; transform: translateY(calc(-6px / var(--s))); } }

    @media (prefers-reduced-motion: reduce) {
      #pbf-titlebar button, #pbf-titlebar .notif { transition: none; animation: none; }
    }
  `;

  const html = `
    <div class="pbf-drag"></div>
    <button type="button" class="pbf-min" title="Minimize" tabindex="-1" aria-label="Minimize">
      <svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg></button>
    <button type="button" class="pbf-max" title="Maximize" tabindex="-1" aria-label="Maximize">
      <svg class="pbf-max-ico" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg>
      <svg class="pbf-restore-ico" viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/></svg></button>
    <button type="button" class="pbf-close" title="Close" tabindex="-1" aria-label="Close">
      <svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10"/></svg></button>
  `;

  // The top row, empty page background and card side rails act as the title bar.
  const DRAG_TARGETS = 'html, body, .app, .main-layout, .main-content, .row-container, .dock';
  const DRAG_AREAS = '.pbf-drag, .card-rail';
  function isDragTarget(t) {
    if (!(t instanceof Element)) return false;
    if (t.closest('.modal-overlay, #pbf-titlebar button')) return false;
    return t.matches(DRAG_TARGETS) || !!t.closest(DRAG_AREAS);
  }

  function edgeAt(e) {
    if (maximized) return '';
    const w = window.innerWidth, h = window.innerHeight;
    const edge = EDGE / scale;
    let d = '';
    if (e.clientY < edge) d += 'n'; else if (e.clientY > h - edge) d += 's';
    if (e.clientX < edge) d += 'w'; else if (e.clientX > w - edge) d += 'e';
    return d;
  }

  function mount() {
    setScaleVar();
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'pbf-titlebar';
    bar.innerHTML = html;
    document.body.appendChild(bar);

    // Move the page's toast area into the title bar (the page still finds it by id).
    const toasts = document.getElementById('notification-area');
    if (toasts) bar.appendChild(toasts);

    bar.querySelector('.pbf-min').addEventListener('click', () => send('minimize'));
    bar.querySelector('.pbf-max').addEventListener('click', () => send('toggle-max'));
    bar.querySelector('.pbf-close').addEventListener('click', () => send('close'));

    window.__pbfSetMaximized = (m) => {
      maximized = m;
      bar.classList.toggle('is-max', m);
      bar.querySelector('.pbf-max').title = m ? 'Restore' : 'Maximize';
    };

    const cursors = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
      ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
    let cursorSet = false;
    document.addEventListener('mousemove', (e) => {
      const d = edgeAt(e);
      if (d) { document.documentElement.style.cursor = cursors[d]; cursorSet = true; }
      else if (cursorSet) { document.documentElement.style.cursor = ''; cursorSet = false; }
    }, true);
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const d = edgeAt(e);
      if (d) { e.preventDefault(); e.stopPropagation(); send('resize-' + d); return; }
      if (isDragTarget(e.target)) {
        e.preventDefault();
        send(e.detail === 2 ? 'toggle-max' : 'drag');
      }
    }, true);

    const first = () => refit(true).then(() => { initialFitDone = true; });
    if (document.readyState === 'complete') first();
    else window.addEventListener('load', first, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
