// PBF generator parity/behaviour harness.
// Load in the page: eval(await (await fetch('/tests/harness.js', { cache: 'no-store' })).text())
// Step syntax: "groupId:value" clicks [data-value], "cell:<cell name>|<severity>" clicks a matrix cell,
// "#close-modals" closes all modals, any other string starting with '#' or '.' is a raw selector.
(function () {
  const sleepless = true;

  function resolve(step) {
    if (step.startsWith('cell:')) {
      const [name, sev] = step.slice(5).split('|');
      return Array.from(document.querySelectorAll('#cell-matrix [data-cell]'))
        .find(el => el.dataset.cell === name && el.dataset.severity === sev);
    }
    if (step.startsWith('#') || step.startsWith('.')) return document.querySelector(step);
    const i = step.indexOf(':');
    const group = document.getElementById(step.slice(0, i));
    const value = step.slice(i + 1);
    if (!group) return null;
    return Array.from(group.querySelectorAll('[data-value]')).find(el => el.dataset.value === value);
  }

  function click(step) {
    if (step === '#close-modals') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      return;
    }
    const el = resolve(step);
    if (!el) throw new Error('Harness: element not found for step ' + step);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function freshStart() {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    resetAllFields();
    document.getElementById('output').value = '';
    document.querySelectorAll('#notification-area .notif').forEach(n => n.remove());
    document.getElementById('output').classList.remove('blurred');
  }

  function withSandbox(fn) {
    const hist = localStorage.getItem('pbf_history');
    const clip = navigator.clipboard && navigator.clipboard.writeText;
    if (navigator.clipboard) navigator.clipboard.writeText = () => Promise.resolve();
    const origConfirm = window.confirm;
    window.confirm = () => true;
    try { return fn(); }
    finally {
      if (hist === null) localStorage.removeItem('pbf_history'); else localStorage.setItem('pbf_history', hist);
      if (navigator.clipboard && clip) navigator.clipboard.writeText = clip;
      window.confirm = origConfirm;
      freshStart();
    }
  }

  const G = (g, ...vals) => vals.map(v => g + ':' + v);

  const CASES = [
    { name: 'default', steps: [] },
    { name: 'chroma-slight-hypo', steps: ['chroma-grade:slightly', 'chroma-type:hypochromic'] },
    { name: 'chroma-marked-hypo-size-mod-micro', steps: ['chroma-grade:markedly', 'chroma-type:hypochromic', 'size-grade:moderately', 'size-type:microcytic'] },
    { name: 'size-slight-macro', steps: ['size-grade:slightly', 'size-type:macrocytic'] },
    { name: 'aniso-marked', steps: ['size-grade:markedly', 'size-type:anisocytotic'] },
    { name: 'hypo-mod-aniso-slight', steps: ['chroma-grade:moderately', 'chroma-type:hypochromic', 'size-grade:slightly', 'size-type:anisocytotic'] },
    { name: 'oval', steps: ['oval-toggle:oval'] },
    { name: 'oval-off', steps: ['oval-toggle:oval', 'oval-toggle:oval'] },
    { name: 'oval-then-grade', steps: ['oval-toggle:oval', 'chroma-grade:slightly'] },
    { name: 'cell-one', steps: ['cell:target cells|occasional'] },
    { name: 'cell-two', steps: ['cell:target cells|occasional', 'cell:spherocytes|occasional'] },
    { name: 'cell-mixed', steps: ['cell:echinocytes|occasional', 'cell:target cells|occasional', 'cell:teardrop cells|occasional', 'cell:spherocytes|moderate', 'cell:blast cells|marked'] },
    { name: 'cell-move', steps: ['cell:target cells|occasional', 'cell:target cells|moderate'] },
    { name: 'cell-toggle-off', steps: ['cell:target cells|occasional', 'cell:target cells|occasional'] },
    { name: 'plt-cld', steps: ['platelet-clumps-slider:CLD'] },
    { name: 'plt-cli', steps: ['platelet-clumps-slider:CLI'] },
    { name: 'plt-sethro', steps: ['platelet-no-clumps-slider:SETHRO'] },
    { name: 'plt-satn', steps: ['platelet-satellitism-slider:SATN'] },
    { name: 'plt-satn-off', steps: ['platelet-satellitism-slider:SATN', 'platelet-satellitism-slider:SATN'] },
    { name: 'plt-opts-extra', steps: ['platelet-optional-group:OLPS', 'platelet-optional-group:OGPS', 'platelet-extra-group:CIT', 'platelet-extra-group:PCEC'] },
    { name: 'plt-mogps', steps: ['platelet-optional-group:MOGPS', '#close-modals'] },
    { name: 'early-mals-ocsm', steps: ['early-primary-slider:MALS', 'early-optional-group:OCSM'] },
    { name: 'early-reclick', steps: ['early-primary-slider:NECS'] },
    { name: 'special-all', steps: G('abnormal-group', 'OVER', 'LIP', 'COLD', 'NRBC') },
    { name: 'kitchen-sink', steps: ['chroma-grade:moderately', 'chroma-type:hypochromic', 'size-grade:slightly', 'size-type:microcytic', 'cell:target cells|occasional', 'cell:spherocytes|moderate', 'platelet-clumps-slider:CLN', 'platelet-optional-group:OLPS', 'early-primary-slider:OLS', 'abnormal-group:NRBC'] }
  ];

  const VALIDATION = [
    { name: 'v-grade-normo-chroma', steps: ['chroma-grade:slightly'] },
    { name: 'v-hypo-no-grade', steps: ['chroma-type:hypochromic'] },
    { name: 'v-grade-normo-size', steps: ['size-grade:slightly'] },
    { name: 'v-micro-no-grade', steps: ['size-type:microcytic'] }
  ];

  function run() {
    return withSandbox(() => {
      const cases = CASES.map(c => {
        freshStart();
        c.steps.forEach(click);
        return { name: c.name, text: getCommentText(), state: JSON.parse(JSON.stringify(state)) };
      });
      const validation = VALIDATION.map(c => {
        freshStart();
        c.steps.forEach(click);
        generateComment();
        const errs = document.querySelectorAll('#notification-area .notif-error');
        return {
          name: c.name,
          blurred: document.getElementById('output').classList.contains('blurred'),
          error: errs.length ? errs[errs.length - 1].textContent : ''
        };
      });
      return { cases, validation };
    });
  }

  function compare(baseline) {
    const now = run();
    const out = [];
    baseline.cases.forEach((b, i) => {
      const n = now.cases[i];
      if (!n || n.name !== b.name) { out.push('case missing: ' + b.name); return; }
      if (n.text !== b.text) out.push(b.name + ': text\n  was: ' + b.text + '\n  now: ' + n.text);
      if (JSON.stringify(n.state) !== JSON.stringify(b.state)) out.push(b.name + ': state\n  was: ' + JSON.stringify(b.state) + '\n  now: ' + JSON.stringify(n.state));
    });
    baseline.validation.forEach((b, i) => {
      const n = now.validation[i];
      if (!n || n.blurred !== b.blurred || n.error !== b.error) out.push(b.name + ': validation was ' + JSON.stringify(b) + ' now ' + JSON.stringify(n));
    });
    return out;
  }

  // Live baseline: runs this harness inside the untouched v2.4 file in a hidden iframe.
  async function baseline(path = '/tests/baselines/PBF%20generator%20v2.4.html') {
    const src = await (await fetch('/tests/harness.js', { cache: 'no-store' })).text();
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;width:1280px;height:900px;left:-9999px;top:0';
    frame.src = path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
    await new Promise(res => { frame.onload = res; document.body.appendChild(frame); });
    frame.contentWindow.eval(src);
    const result = frame.contentWindow.PBFTest.run();
    frame.remove();
    return JSON.parse(JSON.stringify(result));
  }

  // `allow`: case names whose output is intentionally different from v2.4.
  async function parity(allow = ['oval-then-grade']) {
    return compare(await baseline()).filter(line => !allow.some(n => line.startsWith(n + ':')));
  }

  // Checks run against v2.5 only. Each returns { pass, failures }.
  function check(fn) {
    const failures = [];
    const expect = (cond, msg) => { if (!cond) failures.push(msg); };
    try { fn(expect); } catch (e) { failures.push('threw: ' + (e && e.stack || e)); }
    return { pass: failures.length === 0, failures };
  }

  function legacyCheck() {
    const saved = JSON.stringify(appConfig.abnormalFindings.codes);
    return withSandbox(() => check(expect => {
      try {
        appConfig.abnormalFindings.codes.NRBC = { text: "WBC corrected for the presence of NRBC's.", rare: true };
        renderDynamicSections();
        freshStart();
        click('abnormal-group:NRBC');
        const t = getCommentText();
        expect(t.endsWith("WBC corrected for the presence of NRBC's."), 'object code text not used: ' + t);
        appConfig.abnormalFindings.codes.NRBC = "WBC corrected for the presence of NRBC's.";
        renderDynamicSections();
        freshStart();
        click('abnormal-group:NRBC');
        expect(getCommentText().endsWith("WBC corrected for the presence of NRBC's."), 'string code text broken');
      } finally {
        appConfig.abnormalFindings.codes = JSON.parse(saved);
        renderDynamicSections();
      }
    }));
  }

  function key(target, k, extra = {}) {
    const ev = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra));
    target.dispatchEvent(ev);
  }

  // Full code text follows the cursor (or sits beside the keyboard-focused code).
  function tooltipChecks() {
    return withSandbox(() => check(expect => {
      const tip = () => document.getElementById('code-tip');
      expect(!document.getElementById('readout'), 'old readout bar still present');
      expect(tip(), '#code-tip missing');
      if (!tip()) return;
      const shown = () => !tip().hidden && getComputedStyle(tip()).display !== 'none';
      const move = (el, x, y) => el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
      const out = el => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      expect(!shown(), 'tooltip visible before hovering');

      const mogps = resolve('platelet-optional-group:MOGPS');
      expect(!mogps.hasAttribute('title'), 'chip still has a native title (double tooltip)');
      const r = mogps.getBoundingClientRect();
      const cx = Math.round(r.left + 5), cy = Math.round(r.top + 5);
      move(mogps, cx, cy);
      expect(shown(), 'tooltip not shown on hover');
      expect(tip().textContent === 'Moderate giant platelets seen, total platelet count may be underestimated.', 'MOGPS tooltip should be the full text only: ' + tip().textContent);
      const t = tip().getBoundingClientRect();
      expect(Math.abs(t.left - cx) < 40 && Math.abs(t.top - cy) < 60, 'tooltip not next to cursor: tip ' + Math.round(t.left) + ',' + Math.round(t.top) + ' cursor ' + cx + ',' + cy);
      move(mogps, cx + 30, cy + 2);
      expect(Math.abs(tip().getBoundingClientRect().left - (cx + 30)) < 40, 'tooltip does not follow the cursor');
      out(mogps);
      expect(!shown(), 'tooltip not hidden on mouseout');

      const tar = resolve('cell:target cells|occasional');
      expect(!tar.hasAttribute('title'), 'cell chip still has a native title');
      move(tar, 10, 10);
      expect(tip().textContent === 'target cells', 'cell tooltip should be the full text only: ' + tip().textContent);
      ['chroma-grade:slightly', 'chroma-grade:moderately', 'size-grade:markedly'].forEach(s => { out(resolve(s)); move(resolve(s), 10, 10); expect(!shown(), 'grade button shows a tooltip: ' + s); });
      move(resolve('chroma-type:hypochromic'), 10, 10);
      expect(tip().textContent === 'hypochromic', 'red cell tooltip: ' + tip().textContent);

      move(mogps, innerWidth - 3, 40);
      expect(tip().getBoundingClientRect().right <= innerWidth + 1, 'tooltip runs off the right edge');
      out(mogps);

      const ols = resolve('early-primary-slider:OLS');
      ols.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(shown() && tip().textContent === 'Occasional number of neutrophils show a shift to the left.', 'tooltip not shown on keyboard focus: ' + tip().textContent);
      const or = ols.getBoundingClientRect(), ot = tip().getBoundingClientRect();
      expect(Math.abs(ot.left - or.left) < 60 && ot.top >= or.bottom - 2 && ot.top - or.bottom < 40, 'focus tooltip not beside the focused code');
      ols.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      expect(!shown(), 'tooltip not hidden on focusout');

      // Clicking focuses the code: the tip must stay beside the cursor, not jump under the code.
      const pr = mogps.getBoundingClientRect();
      const px = Math.round(pr.left + 5), py = Math.round(pr.top + 5);
      move(mogps, px, py);
      const before = tip().getBoundingClientRect();
      mogps.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: px, clientY: py }));
      mogps.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const after = tip().getBoundingClientRect();
      expect(shown() && after.left === before.left && after.top === before.top, 'tooltip moved on click: ' + Math.round(before.left) + ',' + Math.round(before.top) + ' -> ' + Math.round(after.left) + ',' + Math.round(after.top));
      mogps.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }));
  }

  // Titles live in a vertical side rail; actions sit above the comment.
  function layoutChecks() {
    return check(expect => {
      const cards = Array.from(document.querySelectorAll('.main-content .card'));
      expect(cards.length >= 5, 'expected 5 cards, found ' + cards.length);
      expect(!document.querySelector('.card-header'), 'horizontal title bar still present');
      cards.forEach(c => {
        const rail = c.querySelector(':scope > .card-rail');
        const title = rail && rail.querySelector('.card-title');
        expect(rail, 'card without side rail: ' + c.textContent.trim().slice(0, 20));
        if (!title) return;
        expect(getComputedStyle(title).writingMode.startsWith('vertical'), 'rail title not vertical: ' + title.textContent);
        expect(rail.getBoundingClientRect().width <= 48, 'rail too wide: ' + Math.round(rail.getBoundingClientRect().width) + 'px');
        expect(getComputedStyle(c).flexDirection === 'row', 'card not laid out beside its rail');
      });
      const actions = document.querySelector('.dock-actions'), comment = document.querySelector('.dock-comment');
      expect(actions && comment && (actions.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING), 'Generate row is not above the comment');
      expect(actions.getBoundingClientRect().bottom <= comment.getBoundingClientRect().top + 1, 'Generate row not visually above the comment');
    });
  }

  // Run at a short viewport (e.g. 1280x700) and at mobile size.
  function dockChecks() {
    return withSandbox(() => check(expect => {
      const dock = document.querySelector('.dock');
      expect(dock, '.dock missing');
      if (!dock) return;
      expect(getComputedStyle(dock).position === 'sticky', 'dock not sticky');
      const inView = el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.height > 0; };
      window.scrollTo(0, 0);
      expect(inView(document.getElementById('generate-btn')), 'Generate not visible at top of page');
      expect(inView(document.getElementById('output')), 'comment not visible at top of page');
      const out = document.getElementById('output');
      out.value = 'Long comment. '.repeat(230);
      autoFitOutput();
      const h = out.getBoundingClientRect().height;
      expect(h <= 0.35 * innerHeight + 2, 'output grew to ' + Math.round(h) + 'px (> 35vh)');
      out.value = '';
      autoFitOutput();
      window.scrollTo(0, document.documentElement.scrollHeight);
      const cards = Array.from(document.querySelectorAll('.main-content > .card, .main-content > .row-container > .card'));
      const last = cards[cards.length - 1];
      const dockTop = dock.getBoundingClientRect().top;
      expect(last.getBoundingClientRect().bottom <= dockTop + 1, 'last section hidden behind dock at bottom of page');
      window.scrollTo(0, 0);
    }));
  }

  const MODALS = ['history-modal', 'secret-menu', 'mogps-modal', 'glossary-modal', 'theme-modal'];

  function modalChecks() {
    return check(expect => {
      const isOpen = id => document.getElementById(id).classList.contains('active');
      MODALS.forEach(id => {
        const m = document.getElementById(id);
        const x = m.querySelector('.modal-header [data-close]');
        expect(x && x.dataset.close === id, id + ': header close button with data-close missing');
        expect(!m.querySelector('[onclick*="closeModal"]'), id + ': inline closeModal onclick remains');
        openModal(id);
        if (x) { x.click(); expect(!isOpen(id), id + ': X did not close'); }
        openModal(id);
        m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(!isOpen(id), id + ': backdrop click did not close');
        openModal(id);
        key(document.body, 'Escape');
        expect(!isOpen(id), id + ': Escape did not close');
        const h = m.querySelector('.modal-header');
        expect(h && !/[A-Z].*\b[A-Z][a-z]/.test(h.textContent.trim().replace(/^MOGPS/, '')), id + ': title not sentence case: ' + (h && h.textContent.trim()));
      });
    });
  }

  // The admin panel was removed in v3.6: no modal, no login code, and Alt+A does nothing.
  function adminChecks() {
    return check(expect => {
      expect(!document.getElementById('admin-modal'), '#admin-modal still in the page');
      expect(!document.getElementById('export-modal'), '#export-modal still in the page');
      ['attemptLogin', 'renderAdminView', 'addCode', 'exportGlobalConfig'].forEach(f =>
        expect(typeof window[f] === 'undefined', f + ' still defined'));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', altKey: true, bubbles: true }));
      expect(!document.querySelector('.modal-overlay.active'), 'Alt+A opened a dialog');
    });
  }
  // Storage that refuses writes, and a corrupt saved theme, must not break the app.
  async function storageChecks() {
    const results = check(expect => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
      try {
        toggleSpecial(true);
        expect(document.getElementById('special-bar').getAttribute('aria-expanded') === 'true', 'Special cannot open when storage writes fail');
        toggleSpecial(false);
        expect(document.getElementById('special-bar').getAttribute('aria-expanded') === 'false', 'Special cannot close when storage writes fail');
      } finally {
        Storage.prototype.setItem = orig;
      }
    });
    const savedTheme = localStorage.getItem('pbf_theme');
    localStorage.setItem('pbf_theme', '{bad');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;width:1000px;height:800px;left:-9999px;top:0';
    frame.src = location.pathname + '?corrupt=' + Date.now();
    await new Promise(res => { frame.onload = res; document.body.appendChild(frame); });
    const cells = frame.contentDocument.querySelectorAll('#cell-matrix [data-cell]').length;
    const chips = frame.contentDocument.querySelectorAll('#abnormal-group [data-value]').length;
    frame.remove();
    if (savedTheme === null) localStorage.removeItem('pbf_theme'); else localStorage.setItem('pbf_theme', savedTheme);
    if (!(cells > 0 && chips > 0)) { results.pass = false; results.failures.push('app did not render with corrupt pbf_theme (cells=' + cells + ', special=' + chips + ')'); }
    return results;
  }

  // The whole dock (not just the textarea) must leave most of the window for the cards.
  function dockHeightCheck() {
    return withSandbox(() => check(expect => {
      const out = document.getElementById('output');
      out.value = 'Long comment. '.repeat(200);
      autoFitOutput();
      const dh = document.querySelector('.dock').getBoundingClientRect().height;
      expect(dh <= 0.5 * innerHeight, 'dock is ' + Math.round(dh) + 'px = ' + Math.round(100 * dh / innerHeight) + '% of window');
      out.value = '';
      autoFitOutput();
      document.querySelectorAll('#notification-area .notif').forEach(n => n.remove());
    }));
  }

  // Regression tests for the five bugs carried over from v2.4.
  function bugfixChecks() {
    const saved = JSON.stringify(appConfig.abnormalFindings.codes);
    return withSandbox(() => check(expect => {
      const out = document.getElementById('output');
      const overlay = document.getElementById('preview-overlay');

      // 1. (Edit mode was removed on request; nothing to check.)

      // 2. Enter / Backspace while a dialog is open must not act on the page behind it.
      freshStart();
      out.value = 'UNCHANGED';
      openModal('glossary-modal');
      key(document.body, 'Enter');
      expect(out.value === 'UNCHANGED', 'bug2: Enter in a dialog ran Generate');
      key(document.body, 'Backspace');
      expect(!document.getElementById('reset-all-btn').classList.contains('armed'), 'bug2: Backspace in a dialog armed Reset all');
      closeModal('glossary-modal');

      // 3. Glossary shows config codes containing < and & literally.
      try {
        appConfig.abnormalFindings.codes['<5%'] = 'a & b <i>x</i>';
        renderGlossary();
        const g = document.getElementById('glossary-content');
        expect(g.textContent.includes('<5%'), 'bug3: glossary lost key "<5%"');
        expect(g.textContent.includes('a & b <i>x</i>'), 'bug3: glossary did not show text literally');
        expect(!g.querySelector('.g-out i'), 'bug3: glossary rendered admin text as HTML');
      } finally {
        appConfig.abnormalFindings.codes = JSON.parse(saved);
        renderDynamicSections();
      }

      // 4. (Admin export was removed in v3.6; the SHARED_DATA block must still be unique.)
      const raw = window.__rawHtml || '';
      if (raw) {
        expect((raw.match(/let SHARED_DATA = \{/g) || []).length === 1, 'bug4: "let SHARED_DATA = {" appears more than once in the file');
        expect((raw.match(/const defaultConfig/g) || []).length === 1, 'bug4: "const defaultConfig" appears more than once in the file');
      } else {
        expect(false, 'bug4: set window.__rawHtml to the file text before running');
      }

      // 5. OVAL then a red-cell choice restores Normo defaults instead of a broken sentence.
      freshStart();
      click('oval-toggle:oval');
      click('chroma-grade:slightly');
      expect(state.ovalState === '' && state.chroma === 'normochromic' && state.size === 'normocytic', 'bug5: defaults not restored after leaving OVAL: ' + JSON.stringify([state.ovalState, state.chroma, state.size]));
      expect(!/ and \./.test(getCommentText()), 'bug5: broken preview: ' + getCommentText());
      expect(resolve('chroma-type:normochromic').classList.contains('active') && resolve('size-type:normocytic').classList.contains('active'), 'bug5: Normo buttons not shown active');
      freshStart();
      click('oval-toggle:oval');
      click('chroma-type:hypochromic');
      expect(state.chroma === 'hypochromic' && state.size === 'normocytic', 'bug5: Hypo after OVAL should keep size Normo');
    }));
  }

  // Removed on request: manual edit, copy button, title dots, per-section resets, Alt+S.
  function removalChecks() {
    return withSandbox(() => check(expect => {
      expect(!document.getElementById('edit-mode-checkbox') && !document.getElementById('edit-toggle-btn'), 'edit-mode toggle still present');
      expect(!document.getElementById('copy-output-btn'), 'copy button still present');
      expect(typeof isEditMode === 'undefined', 'edit-mode code still present');
      expect(document.getElementById('output').readOnly, 'comment box is editable');
      const t = document.querySelector('.card-title');
      expect(t && getComputedStyle(t, '::before').content === 'none', 'coloured dot still next to section titles');
      expect(!document.querySelector('.reset-btn, [onclick*="resetSection"]'), 'per-section reset button still present');
      expect(document.getElementById('reset-all-btn'), 'Reset all must stay');
      const bar = document.getElementById('special-bar');
      const before = bar.getAttribute('aria-expanded');
      key(document.body, 's', { altKey: true });
      expect(bar.getAttribute('aria-expanded') === before, 'Alt+S still toggles Special');
      expect(!document.getElementById('secret-menu').classList.contains('active'), 'Alt+S opens quick codes');
      expect(!/Alt\s*\+?\s*S\b/.test(document.querySelector('.main-content').textContent.replace(/\s+/g, ' ')) && !/Alt\+S/.test(bar.title), 'Alt+S still mentioned in the page');
      // Generate still copies automatically.
      let copied = null;
      navigator.clipboard.writeText = v => { copied = v; return Promise.resolve(); };
      freshStart();
      generateComment();
      expect(copied && copied.startsWith('Majority of red blood cells'), 'Generate no longer copies the comment');
    }));
  }

  // Follow-up 4: Early cell title wraps, quick codes stay open, glossary/history hidden, dock unframed.
  async function tweakChecks() {
    const res = check(expect => {
      const early = document.getElementById('title-early');
      const card = early.closest('.card');
      const content = card.querySelector('.card-content');
      expect(early.getBoundingClientRect().height <= content.getBoundingClientRect().height + 1, 'Early cell title taller than its codes (' + Math.round(early.getBoundingClientRect().height) + 'px vs ' + Math.round(content.getBoundingClientRect().height) + 'px)');
      expect(early.getBoundingClientRect().width > 18, 'Early cell title not on two lines');
      ['glossary-btn', 'history-btn'].forEach(id => {
        const b = document.getElementById(id);
        expect(b && (b.hidden || getComputedStyle(b).display === 'none'), id + ' still visible');
      });
      const dock = getComputedStyle(document.querySelector('.dock'));
      expect(dock.borderTopWidth === '0px' && dock.boxShadow === 'none' && dock.borderTopLeftRadius === '0px', 'dock still framed: border ' + dock.borderTopWidth + ', shadow ' + dock.boxShadow + ', radius ' + dock.borderTopLeftRadius);
    });
    const clip = navigator.clipboard.writeText;
    navigator.clipboard.writeText = () => Promise.resolve();
    try {
      openModal('secret-menu');
      const btn = document.querySelector('#secret-main-grid .btn');
      btn.click();
      await new Promise(r => setTimeout(r, 900));
      if (!document.getElementById('secret-menu').classList.contains('active')) { res.pass = false; res.failures.push('quick codes closed after copying'); }
      if (btn.textContent === '✓') { res.pass = false; res.failures.push('quick code label did not return after copying'); }
      document.querySelector('#secret-blood-grid .btn').click();
      await new Promise(r => setTimeout(r, 900));
      if (!document.getElementById('secret-menu').classList.contains('active')) { res.pass = false; res.failures.push('quick codes closed after copying a blood group'); }
    } finally {
      closeModal('secret-menu');
      navigator.clipboard.writeText = clip;
    }
    return res;
  }

  // Zenless theme must actually look like zenless-ui.
  function zenlessChecks() {
    const saved = JSON.stringify(userTheme);
    // Read final styles: a hidden preview pane never advances CSS transitions.
    const noAnim = document.createElement('style');
    noAnim.textContent = '*,*::before,*::after{transition:none!important}';
    document.head.appendChild(noAnim);
    return withSandbox(() => check(expect => {
      try {
        userTheme.palette = 'forest';  // a removed palette saved by an older version
        let threw = null; try { applyTheme(); } catch (e) { threw = e.message; }
        expect(!threw, 'saved removed palette crashes applyTheme: ' + threw);
        userTheme.palette = 'zenless'; userTheme.accent = palettes.zenless.dark.accent; userTheme.mode = 'dark';
        applyTheme();
        expect(document.documentElement.dataset.palette === 'zenless', 'zenless not applied');
        const card = getComputedStyle(document.querySelector('.main-content .card'));
        expect(card.borderBottomRightRadius === '0px' && parseFloat(card.borderTopLeftRadius) >= 16, 'card lacks zenless cut corner: ' + card.borderRadius);
        expect(card.borderTopColor === 'rgb(0, 0, 0)' && parseFloat(card.borderTopWidth) >= 2, 'card lacks 2px black border');
        freshStart();
        click('platelet-optional-group:OLPS');
        const on = getComputedStyle(resolve('platelet-optional-group:OLPS'));
        expect(/z_ani_background/.test(on.animationName) || matchMedia('(prefers-reduced-motion: reduce)').matches, 'selected chip lacks the yellow/green pulse');
        expect(on.color === 'rgb(0, 0, 0)', 'selected chip text not black: ' + on.color);
        const seg = getComputedStyle(document.getElementById('chroma-type'));
        expect(seg.borderTopLeftRadius === '9999px' || parseFloat(seg.borderTopLeftRadius) > 100, 'segmented track not a pill');
        expect(/linear-gradient\(45deg/.test(getComputedStyle(document.body).backgroundImage), 'body lacks the diagonal texture');
        // v3.7: light mode is the paper-and-ink variant, keeping the ink frame and black side tabs.
        userTheme.mode = 'light'; applyTheme();
        expect(getComputedStyle(document.body).backgroundColor === 'rgb(228, 228, 223)', 'zenless light mode lacks the paper base');
        const lcard = getComputedStyle(document.querySelector('.main-content .card'));
        expect(lcard.backgroundColor === 'rgb(251, 251, 248)' && lcard.borderTopColor === 'rgb(0, 0, 0)', 'zenless light card not paper with ink border');
        expect(getComputedStyle(document.querySelector('.main-content .card-rail')).backgroundColor === 'rgb(0, 0, 0)', 'zenless light side tab not black');
        // Genshin: both modes now, switch unlocked; dark turns the panels to slate, dialogs stay cream.
        userTheme.palette = 'genshin'; userTheme.mode = 'dark'; applyTheme();
        expect(document.documentElement.dataset.theme === 'dark', 'genshin ignored dark mode');
        expect(!document.getElementById('mode-toggle-btn').classList.contains('is-locked'), 'genshin mode switch still locked');
        expect(getComputedStyle(document.querySelector('.main-content .card')).backgroundColor === 'rgb(35, 42, 61)', 'genshin dark card not slate');
        expect(getComputedStyle(document.querySelector('#secret-menu .modal')).color === 'rgb(73, 83, 102)', 'genshin dark dialog lost its ink text');
        userTheme.mode = 'light'; applyTheme();
        expect(getComputedStyle(document.querySelector('.main-content .card')).backgroundColor === 'rgb(236, 229, 216)', 'genshin light card not parchment');
        // Quick codes: the code label must sit inside its pill under Genshin.
        buildSecretMenu(); openModal('secret-menu');
        document.querySelectorAll('#secret-menu .qc-btn').forEach(b => {
          const o = b.getBoundingClientRect(), k = b.querySelector('.qc-face-label').getBoundingClientRect();
          expect(k.left >= o.left - 0.5 && k.right <= o.right + 0.5, 'genshin quick code spills out of its button: ' + b.textContent.trim());
        });
        closeModal('secret-menu');
        // v3.11: Aurora is gone; AC Odyssey and Valorant replace it, each with both modes.
        expect(!palettes.aurora && !document.querySelector('#theme-palette option[value="aurora"]'), 'aurora theme still present');
        userTheme.palette = 'aurora'; applyTheme();
        expect(userTheme.palette === 'claude', 'saved aurora theme does not fall back to claude');
        const qcFits = name => document.querySelectorAll('#secret-menu .qc-btn').forEach(b => {
          const o = b.getBoundingClientRect(), k = b.querySelector('.qc-face-label').getBoundingClientRect();
          expect(k.left >= o.left - 0.5 && k.right <= o.right + 0.5, name + ' quick code spills out of its button: ' + b.textContent.trim());
        });
        userTheme.palette = 'odyssey'; userTheme.mode = 'dark'; applyTheme();
        expect(!document.getElementById('mode-toggle-btn').classList.contains('is-locked'), 'odyssey mode switch locked');
        const ocard = getComputedStyle(document.querySelector('.main-content .card'));
        expect(ocard.borderTopLeftRadius === '0px', 'odyssey card not square');
        expect(/ACO Fira/.test(getComputedStyle(document.querySelector('.chip')).fontFamily), 'odyssey chips not in the menu sans');
        expect(/ACO Cinzel/.test(getComputedStyle(document.querySelector('.card-title')).fontFamily), 'odyssey side tab not in the Trajan-style capitals');
        expect(/polygon/.test(getComputedStyle(document.querySelector('.main-content .card-rail')).clipPath), 'odyssey side tab lacks the banner notch');
        expect(/svg/.test(getComputedStyle(document.body).cursor), 'odyssey lacks the ring cursor');
        buildSecretMenu(); openModal('secret-menu'); qcFits('odyssey'); closeModal('secret-menu');
        userTheme.mode = 'light'; applyTheme();
        expect(getComputedStyle(document.querySelector('.main-content .card')).backgroundColor === 'rgb(235, 226, 205)', 'odyssey light card not papyrus');
        userTheme.palette = 'valorant'; userTheme.mode = 'dark'; applyTheme();
        expect(getComputedStyle(document.body).backgroundColor === 'rgb(15, 25, 35)', 'valorant dark base not navy #0f1923');
        expect(/VAL Anton/.test(getComputedStyle(document.querySelector('.card-title')).fontFamily), 'valorant side tab not in the display face');
        freshStart(); click('platelet-optional-group:OLPS');
        expect(getComputedStyle(resolve('platelet-optional-group:OLPS')).borderTopColor === 'rgb(237, 232, 176)', 'valorant pick lacks the pale-gold frame');
        buildSecretMenu(); openModal('secret-menu'); qcFits('valorant'); closeModal('secret-menu');
        userTheme.mode = 'light'; applyTheme();
        expect(getComputedStyle(document.body).backgroundColor === 'rgb(236, 232, 225)', 'valorant light base not off-white #ece8e1');
        expect(getComputedStyle(document.querySelector('.dock .btn-primary')).backgroundColor === 'rgb(255, 70, 85)', 'valorant light Generate not brand red');
        // v3.13: Fallout (Pip-Boy green, Vault-Tec light) opens in dark like the other game themes.
        expect(palettes.fallout && palettes.fallout.defaultMode === 'dark', 'fallout missing or not dark by default');
        userTheme.palette = 'fallout'; userTheme.mode = 'dark'; applyTheme();
        expect(/FO Roboto/.test(getComputedStyle(document.querySelector('.chip')).fontFamily), 'fallout chips not in Roboto Condensed');
        freshStart(); click('platelet-optional-group:OLPS');
        const fpick = getComputedStyle(resolve('platelet-optional-group:OLPS'));
        expect(fpick.backgroundColor === 'rgb(27, 253, 30)' && fpick.color === 'rgb(0, 57, 0)', 'fallout pick not the green bar with dark text: ' + fpick.backgroundColor + ' / ' + fpick.color);
        expect(/svg/.test(getComputedStyle(document.body).cursor), 'fallout lacks the green arrow cursor');
        buildSecretMenu(); openModal('secret-menu'); qcFits('fallout'); closeModal('secret-menu');
        userTheme.mode = 'light'; applyTheme();
        expect(getComputedStyle(document.querySelector('.main-content .card-rail')).backgroundColor === 'rgb(29, 63, 123)', 'fallout light side tab not vault blue');
        expect(getComputedStyle(document.querySelector('.dock .btn-primary')).backgroundColor === 'rgb(255, 205, 47)', 'fallout light Generate not Vault-Tec yellow');
        // v3.14: each game theme has its own quiet animation layer, which never takes the pointer.
        if (matchMedia('(prefers-reduced-motion: no-preference)').matches) {
          const motion = { fallout: [document.documentElement, '::before', 'fo-roll'], cyberpunk: [document.documentElement, '::before', 'cp-slice'],
            genshin: [document.documentElement, '::after', 'gi-meteor'], odyssey: [document.body, '::before', 'ac-pan'],
            valorant: [document.documentElement, '::after', 'va-drift'], zenless: [document.documentElement, '::before', 'zz-channel'] };
          for (const [p, [el, ps, name]] of Object.entries(motion)) {
            userTheme.palette = p; userTheme.mode = 'dark'; applyTheme();
            const cs = getComputedStyle(el, ps);
            expect(cs.animationName.includes(name), p + ' lacks its ' + name + ' animation: ' + cs.animationName);
            expect(cs.pointerEvents === 'none', p + ' animation layer takes the pointer');
          }
          userTheme.palette = 'claude'; applyTheme();
          expect(getComputedStyle(document.documentElement, '::before').animationName === 'none', 'claude picked up a game animation');
        }
      } finally {
        Object.assign(userTheme, JSON.parse(saved));
        applyTheme();
        noAnim.remove();
      }
    }));
  }

  // ---------- v3.0 companion pet checks (PBFTest.pet.<group>()) ----------
  const pet = {
    async core() { return check(expect => {
      expect(typeof PetEngine === 'object', 'PetEngine missing');
      ['init', 'onThemeChange', 'resize', 'notify', 'openCard', 'rand'].forEach(f => expect(typeof PetEngine[f] === 'function', f + ' missing'));
      expect(typeof window.PixelScene === 'undefined', 'old PixelScene still present');
      PetEngine._test.seed(42); const a = [PetEngine.rand(), PetEngine.rand()];
      PetEngine._test.seed(42); const b = [PetEngine.rand(), PetEngine.rand()];
      expect(a[0] === b[0] && a[1] === b[1], 'rand not seedable');
      const ov = document.getElementById('pet-overlay');
      expect(ov && getComputedStyle(ov).pointerEvents === 'none', 'overlay missing or capturing pointer');
      expect(ov && +getComputedStyle(ov).zIndex === 60, 'overlay z-index must be 60');
      expect(/^PBF Comment Generator v3\.\d+$/.test(document.title), 'title');
    }); },
    async store() {
      const saved = localStorage.getItem('pbf_pet');
      return withSandbox(() => check(expect => {
        try {
          const S = PetEngine._test.units.PetStore;
          expect(S.migrateAnimal('dog') === 'shiba' && S.migrateAnimal('rabbit') === 'cat' && S.migrateAnimal('cow') === 'cat', 'migration');
          expect(S.migrateAnimal('capybara') === 'capybara' && S.migrateAnimal('off') === 'off' && S.migrateAnimal(undefined) === 'off', 'migration keep');
          localStorage.setItem('pbf_pet', '{not json'); expect(S.load().v === 1, 'corrupt falls back');
          const st = S.defaults('cat'); st.name = 'Tom'; st.renamed = true; S.save(st);
          expect(S.load().name === 'Tom', 'round trip');
          expect(S.setSpecies(S.load(), 'shiba').name === 'Tom', 'renamed name kept on species change');
          expect(S.setSpecies(S.defaults('cat'), 'shiba').name === 'Kuri', 'default name follows species');
          const d = S.offlineDrift({ hunger: 60, energy: 50, fun: 50, affection: 40, curiosity: 50 }, 30 * 24 * 3600e3);
          expect(d.hunger <= 70 && d.affection >= 30, 'offline caps: ' + JSON.stringify(d));
          const f = S.offlineDrift({ hunger: 20, energy: 50, fun: 50, affection: 50, curiosity: 50 }, -5e9);
          expect(f.hunger === 20 && f.affection === 50, 'negative elapsed must be a no-op');
          let s2 = S.defaults('cat'); s2 = S.recordDay(s2, '2026-11-12'); s2 = S.recordDay(s2, '2026-11-12'); s2 = S.recordDay(s2, '2026-11-13');
          expect(s2.daysCount === 2, 'days counts distinct dates');
          const m = S.defaults('cat'); m.needs.energy = 10;
          expect(S.moodWord(m, { now: 0, startledUntil: 0, asleep: false }) === 'sleepy', 'mood priority');
          expect(S.moodWord(m, { now: 0, startledUntil: 1000, asleep: false }) === 'startled', 'startled wins');
          const orig = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('quota'); };
          let threw = null; try { S.save(S.defaults('cat')); } catch (e) { threw = e; } finally { Storage.prototype.setItem = orig; }
          expect(!threw, 'save must swallow storage errors');
          expect([...document.querySelectorAll('#theme-animal option')].map(o => o.value).join() === 'off,cat,shiba,capybara', 'select options');
        } finally {
          if (saved === null) localStorage.removeItem('pbf_pet'); else localStorage.setItem('pbf_pet', saved);
        }
      }));
    },
    async art() { return check(expect => {
      const A = PetEngine._test.units.PetArt;
      A.SPECIES.forEach(sp => Object.keys(A.FRAMES).forEach(pose => {
        const n = sp === 'capybara' && pose === 'jump' ? 3 : A.FRAMES[pose];
        for (let i = 0; i < n; i++) {
          const f = A.frame(sp, pose, i);
          expect(f.map.length === f.H && f.map.every(r => r.length === f.W), sp + ' ' + pose + i + ' ragged');
          expect(f.map.join('').replace(/ /g, '').length > 40, sp + ' ' + pose + i + ' empty');
          ['head', 'neck', 'mouth', 'hat', 'shadow'].forEach(k => expect(Array.isArray(f.anchors[k]), sp + ' ' + pose + i + ' anchor ' + k));
          expect(sp === 'capybara' ? f.anchors.tail === null : Array.isArray(f.anchors.tail), sp + ' tail anchor');
        }
      }));
      expect(A.frame('shiba', 'stand', 0).W <= 36 && A.frame('capybara', 'stand', 0).W <= 40, 'sizes per spec §2.4');
      ['level', 'up', 'down'].forEach(a => ['up', 'back'].forEach(e => A.SPECIES.forEach(sp => expect(A.head(sp, a, e).map.length > 0, 'head ' + sp + a + e))));
      for (let k = 0; k < 5; k++) { expect(A.tail('cat', k), 'cat tail ' + k); expect(A.tail('shiba', k), 'shiba tail ' + k); }
      expect(A.tail('capybara', 0) === null, 'capybara has no tail');
      const hex = /^#[0-9a-f]{6}$/;
      Object.values(palettes).forEach(p => [p.dark || p, p.light || p].forEach(v => {
        const pal = A.palette({ accent: v.accent, accent2: v.accent2, accent3: v.accent3 });
        ['o', 's', 'b', 'h', 'w', 'k', 'e', 'n', 'acc1', 'acc2'].forEach(k => expect(hex.test(pal[k]), 'palette ' + k + ' for ' + v.accent));
      }));
      expect(A.palette({ accent: '#d97757', accent2: '#e89b7b', accent3: '#c26347' }).o === A.mix('#d97757', '#000000', .5), 'outline mix');
    }); },
    async render() {
      const savedT = JSON.stringify(userTheme);
      return check(expect => {
        try {
          if (userTheme.animal === 'off') { userTheme.animal = 'cat'; applyTheme(); }
          const W = PetEngine._test.units.PetWorld;
          const S = W.measure(); const ids = S.map(s => s.id).join();
          expect(ids === 'floor,generate,reset', 'surfaces: ' + ids);
          const ov = document.getElementById('pet-overlay').getBoundingClientRect(), g = document.getElementById('generate-btn').getBoundingClientRect();
          const gen = S.find(s => s.id === 'generate');
          expect(gen && Math.abs(gen.y - (g.top - ov.top)) <= 1, 'generate top measured');
          const strip = document.querySelector('.dock-actions').getBoundingClientRect();
          expect(Math.abs(S[0].y - (strip.bottom - ov.top - 2)) <= 1, 'floor on the strip ground line');
          const band = W.centreBand(); expect(band.x0 <= gen.x0 - 58, 'band covers generate');
          const view = { species: 'cat', pose: 'stand', frame: 0, dir: 1, x: gen.x0, footY: gen.y, headAngle: 'level', ears: 'up', eyes: 'open', tailK: 0, puffed: false, breath: 0, squash: 0, accessory: null, alpha: 1 };
          PetEngine._test.placeView(view);
          const hitEl = document.elementFromPoint(g.left + 4, g.top + 4); expect(hitEl && hitEl.closest('#generate-btn'), 'pet blocks Generate');
          const before = PetEngine._test.paletteKey();
          userTheme.palette = 'cyberpunk'; userTheme.accent = palettes.cyberpunk.dark.accent; applyTheme();
          expect(PetEngine._test.paletteKey() !== before, 'palette not rebuilt');
        } finally { Object.assign(userTheme, JSON.parse(savedT)); applyTheme(); }
      });
    },
    async body() { return check(expect => {
      const B = PetEngine._test.units.PetBody, Wd = PetEngine._test.units.PetWorld;
      PetEngine._test.seed(7); const S = Wd.measure();
      const b = B.create('cat'); b.surf = 'floor'; b.x = 100; b.footY = S[0].y;
      B.walkTo(b, 300); B.step(b, 33, S); expect(Math.abs(b.vx) < 30 * 0.3, 'no instant start: ' + b.vx);
      for (let i = 0; i < 60; i++) B.step(b, 33, S); expect(Math.abs(b.vx) > 25, 'reaches walk speed: ' + b.vx);
      const f0 = b.frame, d0 = b.dist; let guard = 0; while (b.dist - d0 < 4.01 && guard++ < 100) B.step(b, 33, S); expect(b.frame !== f0, 'frame advances by distance');
      for (let i = 0; i < 300; i++) B.step(b, 33, S); expect(Math.abs(b.x - 300) < 3 && b.vx === 0, 'eases to stop at target: x=' + b.x + ' vx=' + b.vx);
      const gen = S.find(s => s.id === 'generate');
      expect(B.jumpTo(b, 'generate', gen.x0 + 2) === true, 'cat can jump to generate');
      for (let i = 0; i < 90; i++) B.step(b, 33, S); expect(b.surf === 'generate' && Math.abs(b.footY - gen.y) < 1, 'landed on generate');
      const c = B.create('capybara'); c.surf = 'floor'; c.x = 100; c.footY = S[0].y;
      expect(B.jumpTo(c, 'generate', gen.x0 + 2) === (S[0].y - gen.y <= 40), 'capybara height limit');
      const tall = S.map(s => Object.assign({}, s)); tall.find(s => s.id === 'reset').y = S[0].y - 60;
      const c2 = B.create('capybara'); c2.surf = 'floor'; c2.x = 100; c2.footY = S[0].y;
      expect(B.jumpTo(c2, 'reset', tall.find(s => s.id === 'reset').x0 + 2, tall) === false, 'capybara refuses a 60px jump');
      b.surf = 'generate'; const S2 = S.filter(s => s.id !== 'generate'); for (let i = 0; i < 60; i++) B.step(b, 33, S2);
      expect(b.surf === 'floor' && Math.abs(b.footY - S2[0].y) < 1, 'fell to floor when surface vanished');
      const x0 = b.x; B.walkTo(b, b.x + 400); B.step(b, 60000, S2); expect(Math.abs(b.x - x0) < 10, 'huge dt teleported pet');
      PetEngine._test.reducedMotion(true);
      try { expect(B.jumpTo(b, 'reset', S.find(s => s.id === 'reset').x0) === false, 'jump under reduced motion'); } finally { PetEngine._test.reducedMotion(null); }
      const v = B.view(b, 1000); ['species', 'pose', 'frame', 'dir', 'x', 'footY', 'headAngle', 'ears', 'eyes', 'tailK', 'breath', 'squash'].forEach(k => expect(k in v, 'view lacks ' + k));
    }); },
    async brain() {
      const savedT = JSON.stringify(userTheme), savedPet = localStorage.getItem('pbf_pet');
      return withSandbox(() => check(expect => {
        try {
          const Br = PetEngine._test.units.PetBrain, T = PetEngine._test;
          T.seed(3); T.resetPet('cat');
          const seen = new Set();
          // a user who touches the app every 30s: keeps the idle-nap rule out of the way
          for (let i = 0; i < 400; i++) { if (i % 10 === 0) PetEngine.notify('busy'); T.sim(3000); seen.add(Br.current(T.brain())); }
          expect(seen.size >= 6, 'too few distinct activities: ' + [...seen]);
          const band = T.units.PetWorld.centreBand();
          const stops = T.floorStops();
          expect(stops.length > 0, 'no floor stops logged');
          expect(stops.every(s => s.x1 < band.x0 || s.x0 > band.x1), 'idle stop inside centre band: ' + JSON.stringify(stops.filter(s => !(s.x1 < band.x0 || s.x0 > band.x1)).slice(0, 3)));
          T.resetPet('cat'); PetEngine.notify('reset'); T.sim(100);
          expect(Br.current(T.brain()) === 'react:reset' && T.view().pose === 'startle', 'reset startle: ' + Br.current(T.brain()) + '/' + T.view().pose);
          T.resetPet('cat'); T.sim(121000);
          expect(Br.current(T.brain()) === 'nap', 'idle 2 min naps: ' + Br.current(T.brain()));
          PetEngine.notify('busy'); T.sim(500); expect(['bow', 'stand'].includes(T.view().pose), 'wakes on busy: ' + T.view().pose);
          T.resetPet('capybara'); const sc = Br.scores(T.brain(), T.ctx());
          T.resetPet('shiba'); const ss = Br.scores(T.brain(), T.ctx());
          expect(ss.zoomies > sc.zoomies, 'shiba zoomier than capybara');
          const got = []; const n = PetEngine.notify; PetEngine.notify = e => got.push(e);
          try { freshStart(); generateComment(); click('chroma-grade:slightly'); generateComment(); resetAllFields(); } finally { PetEngine.notify = n; }
          expect(got.includes('generate') && got.includes('error') && got.includes('reset'), 'hooks: ' + got);
        } finally {
          Object.assign(userTheme, JSON.parse(savedT)); applyTheme();
          if (savedPet === null) localStorage.removeItem('pbf_pet'); else localStorage.setItem('pbf_pet', savedPet);
          PetEngine._test.reload();
        }
      }));
    },
    async ui() {
      const savedT = JSON.stringify(userTheme), savedPet = localStorage.getItem('pbf_pet');
      return withSandbox(() => check(expect => {
        const U = PetEngine._test.units.PetUI, T = PetEngine._test;
        try {
          T.resetPet('cat'); applyTheme(); T.render();
          const r = T.petPoint() || T.petClientRect();
          const ev = (el, x, y) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }); (el || document.body).dispatchEvent(e); return e.defaultPrevented; };
          expect(ev(document.elementFromPoint(r.cx, r.cy), r.cx, r.cy) && U.isMenuOpen() === 'pet', 'pet menu did not open');
          expect(U.menuItems('pet').map(i => i.id).join() === 'pet,feed,play,nap,come,stay,sep,card,species,hide', 'pet menu order: ' + U.menuItems('pet').map(i => i.id).join());
          expect(U.menuItems('pet').find(i => i.id === 'feed').sub[0].label === 'Fish ★', 'favourite first');
          expect(/^Mochi · \w+ · day \d+$/.test(document.querySelector('.pet-menu-hd').textContent), 'menu header: ' + document.querySelector('.pet-menu-hd').textContent);
          const ke = (k) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(e); };
          ke('ArrowDown'); expect(document.activeElement.dataset.id === 'feed', 'ArrowDown moves focus: ' + document.activeElement.dataset.id);
          ke('ArrowRight'); expect(document.activeElement.dataset.id === 'feed:fish', 'ArrowRight opens sub-menu');
          ke('ArrowLeft'); expect(document.activeElement.dataset.id === 'feed', 'ArrowLeft back');
          const out = document.getElementById('output'); let gen = 0; const n = PetEngine.notify; PetEngine.notify = e => { if (e === 'generate') gen++; n(e); };
          try { ke('Escape'); } finally { PetEngine.notify = n; }
          expect(!U.isMenuOpen(), 'Esc closes menu');
          const o = out.getBoundingClientRect();
          expect(!ev(out, o.left + 5, o.top + 5) && !U.isMenuOpen(), 'textarea right-click hijacked');
          const gb = document.getElementById('generate-btn').getBoundingClientRect();
          T.movePetAwayFrom(gb); T.render();
          expect(!ev(document.getElementById('generate-btn'), gb.left + 3, gb.top + 3), 'button right-click hijacked');
          const fl = T.emptyFloorPoint();
          expect(ev(document.elementFromPoint(fl.x, fl.y), fl.x, fl.y) && U.isMenuOpen() === 'floor', 'floor menu');
          expect(U.menuItems('floor').map(i => i.id).join() === 'treatHere,ballHere,callHere', 'floor items');
          U.closeMenu();
          T.resetPet('cat'); T.render();
          const r2 = T.petPoint() || T.petClientRect(), aff0 = T.state().needs.affection;
          document.elementFromPoint(r2.cx, r2.cy).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r2.cx, clientY: r2.cy }));
          expect(T.units.PetBrain.current(T.brain()) === 'react:boop' && T.state().needs.affection > aff0, 'click on pet boops: ' + T.units.PetBrain.current(T.brain()));
          T.hidePet(); T.render();
          expect(!ev(document.elementFromPoint(r2.cx, r2.cy), r2.cx, r2.cy) && !U.isMenuOpen(), 'hidden pet still takes right-click');
        } finally {
          U.closeMenu();
          Object.assign(userTheme, JSON.parse(savedT)); applyTheme();
          if (savedPet === null) localStorage.removeItem('pbf_pet'); else localStorage.setItem('pbf_pet', savedPet);
          T.reload();
        }
      }));
    },
    async toys() {
      const savedT = JSON.stringify(userTheme), savedPet = localStorage.getItem('pbf_pet');
      return withSandbox(() => check(expect => {
        const T = PetEngine._test, W = T.units.PetWorld;
        try {
          T.seed(11); T.resetPet('shiba'); const S = W.measure();
          const gen = S.find(s => s.id === 'generate');
          const ball = W.spawnToy('ball', gen.x1 - 4, gen.y - 20, 60);
          for (let i = 0; i < 300; i++) W.stepToys(33, S);
          expect(ball.surf === 'floor' && Math.abs(ball.vx) < 4, 'ball rolled off and rested on floor: ' + JSON.stringify({ surf: ball.surf, vx: ball.vx }));
          W.clearProps();
          T.resetPet('shiba'); T.throwBall(); T.sim(15000);
          expect(T.stats().fetches === 1, 'shiba fetches: ' + T.stats().fetches);
          T.resetPet('cat');
          for (let i = 0; i < 20; i++) { T.feedNow(); T.sim(8000); }
          expect(T.stats().treats >= 18, 'treats eaten: ' + T.stats().treats);
          W.startLaser(); T.sim(20500); expect(W.laser === null, 'laser ends after 20s');
        } finally {
          W.clearProps();
          Object.assign(userTheme, JSON.parse(savedT)); applyTheme();
          if (savedPet === null) localStorage.removeItem('pbf_pet'); else localStorage.setItem('pbf_pet', savedPet);
          T.reload();
        }
      }));
    },
    async card() {
      const savedT = JSON.stringify(userTheme), savedPet = localStorage.getItem('pbf_pet');
      return withSandbox(() => check(expect => {
        const T = PetEngine._test;
        try {
          T.resetPet('cat'); PetEngine.openCard();
          const m = document.getElementById('pet-card-modal');
          expect(m && m.classList.contains('active'), 'card not open');
          const name = m.querySelector('input[name="pet-name"]'); expect(name && name.maxLength === 20, 'maxlength');
          name.value = 'Biscuit'; name.dispatchEvent(new Event('change', { bubbles: true }));
          expect(T.units.PetStore.load().name === 'Biscuit', 'rename persisted');
          T.setDays(4);
          const locked = [...m.querySelectorAll('[data-accessory]')].filter(b => b.disabled).map(b => b.dataset.accessory);
          expect(locked.join() === 'bow,scarf,party,crown' && !m.querySelector('[data-accessory="orange"]'), 'unlocks for cat day 4: ' + locked);
          m.querySelector('[data-accessory="bandana"]').click();
          expect(T.state().accessory === 'bandana' && T.view().accessory === 'bandana', 'bandana worn');
          expect(!m.querySelector('input[name="pet-gags"]') && !m.querySelector('.pet-need') && !m.querySelector('.pet-card-stats') && !m.querySelector('[data-reset-pet]') && !m.querySelector('.pet-card-sub'), 'card still shows stats / gags / reset');
          expect(m.querySelector('.pet-card-portrait') && m.querySelector('.pet-card-meta') && m.querySelectorAll('h3').length === 2, 'card lost portrait / mood / sections');
          expect(document.getElementById('pet-card-btn'), 'theme modal button');
          m.querySelector('[data-species="capybara"]').click();
          expect(userTheme.animal === 'capybara' && T.state().name === 'Biscuit' && m.querySelector('[data-accessory="orange"]'), 'change animal from card');
          closeModal('pet-card-modal');
        } finally {
          const m = document.getElementById('pet-card-modal'); if (m) m.classList.remove('active');
          Object.assign(userTheme, JSON.parse(savedT)); applyTheme();
          if (savedPet === null) localStorage.removeItem('pbf_pet'); else localStorage.setItem('pbf_pet', savedPet);
          T.reload();
        }
      }));
    },
    async perf() {
      const savedT = JSON.stringify(userTheme);
      return check(expect => {
        const T = PetEngine._test;
        try {
          T.resetPet('shiba'); applyTheme(); T.throwBall();
          const t = T.timeFrames(300);
          expect(t.avg < 1.0, 'avg frame ' + t.avg.toFixed(3) + 'ms');
          userTheme.animal = 'off'; applyTheme(); expect(!T.running(), 'loop runs while Off');
          userTheme.animal = 'shiba'; applyTheme(); expect(T.running(), 'loop not restarted');
          Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
          expect(!T.running(), 'loop runs while hidden');
          delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
          expect(T.running(), 'loop not resumed after visible');
        } finally {
          try { delete document.hidden; } catch (e) { /* ignore */ }
          Object.assign(userTheme, JSON.parse(savedT)); applyTheme(); T.reload();
        }
      });
    },
    // Final-review fixes (one check per finding).
    async fixes() {
      const savedT = JSON.stringify(userTheme), savedPet = localStorage.getItem('pbf_pet');
      return withSandbox(() => check(expect => {
        const T = PetEngine._test, U = T.units.PetUI;
        try {
          // #1 Backspace / Enter inside the pet menu never reach the app shortcuts
          T.resetPet('cat'); applyTheme(); T.render();
          let r = T.petPoint() || T.petClientRect();
          const ctxm = (el, x, y) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }); (el || document.body).dispatchEvent(e); return e.defaultPrevented; };
          ctxm(document.elementFromPoint(r.cx, r.cy), r.cx, r.cy);
          const kd = k => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
          let resets = 0; const rn = PetEngine.notify; PetEngine.notify = (e, d) => { if (e === 'reset') resets++; return rn(e, d); };
          try { kd('Backspace'); expect(!document.getElementById('reset-all-btn').classList.contains('armed'), '#1 Backspace in menu armed Reset all'); kd('Backspace'); } finally { PetEngine.notify = rn; }
          expect(resets === 0, '#1 Backspace x2 in menu reset all fields');
          U.closeMenu();
          // #2 right-click while a modal is open stays native
          openModal('theme-modal'); T.render(); r = T.petClientRect();
          expect(!ctxm(document.getElementById('theme-modal'), r.cx, r.cy) && !U.isMenuOpen(), '#2 pet menu opened under a modal');
          closeModal('theme-modal');
          // #3 hsl/hsla and 8-digit hex accents tint the pet
          const A = T.units.PetArt;
          expect(A.palette({ accent: 'hsla(210, 80%, 50%, 1)' }).b === '#1a80e6', '#3 hsla accent: ' + A.palette({ accent: 'hsla(210, 80%, 50%, 1)' }).b);
          expect(A.palette({ accent: 'hsl(120 50% 40%)' }).b === '#339933', '#3 hsl accent');
          expect(A.palette({ accent: '#3366ccff' }).b === '#3366cc', '#3 8-digit hex');
          // #4 hover petting stops when the pet walks away
          T.resetPet('cat'); T.render(); r = T.petPoint() || T.petClientRect();
          const el = document.elementFromPoint(r.cx, r.cy);
          el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.cx, clientY: r.cy }));
          el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.cx + 1, clientY: r.cy }));
          { const fl = T.units.PetWorld.measure()[0], bw = T.units.PetBody.widthOf(T.body());
            T.placeOnSurface('floor', T.body().x > (fl.x0 + fl.x1) / 2 ? fl.x0 : fl.x1 - bw); T.brain().act = { name: 'react:hold', phase: 0, until: 1e12, data: {} }; T.render(); }
          const pets0 = T.stats().pets; U.tickHover(performance.now() + 5000); U.tickHover(performance.now() + 9000);
          expect(T.stats().pets === pets0, '#4 petting continued after the pet left');
          // #5 a new day is counted (once) while the app stays open
          T.resetPet('cat'); const d0 = T.state().daysCount;
          T.checkDay(Date.now() + 86400e3); T.checkDay(Date.now() + 86400e3);
          expect(T.state().daysCount === d0 + 1, '#5 day rollover not counted once: ' + (T.state().daysCount - d0));
          // #6 pet failures never reach the app
          const PB = T.units.PetBrain, origN = PB.notify; PB.notify = () => { throw new Error('boom'); };
          let threw = null; try { PetEngine.notify('error'); PetEngine.notify('generate'); } catch (e) { threw = e; } finally { PB.notify = origN; }
          expect(!threw, '#6 notify threw');
          const PR = T.units.PetRender, origR = PR.rebuild; PR.rebuild = () => { throw new Error('boom'); };
          threw = null; try { applyTheme(); } catch (e) { threw = e; } finally { PR.rebuild = origR; }
          expect(!threw, '#6 onThemeChange threw into applyTheme');
          // #7 a throwing logic step never escapes tick nor piles up steps
          const origS = PB.step; PB.step = () => { throw new Error('boom'); };
          threw = null; try { for (let i = 0; i < 20; i++) T.tick(1000 + i * 400); } catch (e) { threw = e; } finally { PB.step = origS; }
          expect(!threw && T.acc() <= 250, '#7 tick: ' + (threw && threw.message) + ' acc=' + T.acc());
          // #8 corrupt saved values are sanitised
          localStorage.setItem('pbf_pet', JSON.stringify({ v: 1, species: 'cat', accessory: 'constructor', daysCount: '5', lastDay: '2000-01-01', stats: { treats: '3', pets: 'x' } }));
          const L = T.units.PetStore.load();
          expect(L.accessory === null && typeof L.daysCount === 'number' && L.daysCount === 6 && L.stats.treats === 3 && L.stats.pets === 0, '#8 sanitize: ' + JSON.stringify({ a: L.accessory, d: L.daysCount, s: L.stats }));
          // #9 'Drop treat here' lands on the floor where clicked
          T.resetPet('cat'); const S = T.units.PetWorld.measure(), g = S.find(s => s.id === 'generate');
          T.placeOnSurface('generate', g.x0 + 2); T.units.PetWorld.clearProps();
          const fx = T.freeFloorX();
          T.act('treatHere:fish', { x: fx });
          const tr = T.units.PetWorld.treats[0];
          expect(tr && tr.surf === 'floor' && Math.abs(tr.x - fx) < 3, '#9 treat surface: ' + (tr && tr.surf));
          // #13 hiding is undone by re-selecting the companion, and capped at 24h
          T.resetPet('cat'); T.hidePet();
          const sel = document.getElementById('theme-animal'); sel.value = 'cat'; sel.dispatchEvent(new Event('input', { bubbles: true }));
          expect(!T.state().hiddenUntil, '#13 re-selecting the companion did not unhide');
          T.state().hiddenUntil = Date.now() + 5 * 24 * 3600e3; expect(!T.isHidden(), '#13 hide longer than 24h honoured');
          // #16a Stay pins the pet to its surface: a treat does not pull it away
          T.resetPet('cat'); T.brain().stay = true; T.units.PetWorld.clearProps();
          T.units.PetWorld.spawnTreat('fish', T.freeFloorX(T.body().x), 'floor');
          let ate = false; for (let i = 0; i < 50; i++) { T.sim(100); if (T.units.PetBrain.current(T.brain()) === 'eat') ate = true; }
          expect(!ate && T.body().surf === 'floor' && T.units.PetWorld.treats.length === 1, '#16 stay did not pin: ate=' + ate);
          // #16b species petting
          T.resetPet('cat'); PetEngine.notify('pet'); T.sim(100);
          expect(T.view().eyes === 'closed', '#16 cat petting eyes: ' + T.view().eyes);
          T.resetPet('capybara'); PetEngine.notify('pet'); T.sim(100);
          expect(T.view().eyes === 'closed', '#16 capybara petting eyes');
          T.resetPet('shiba'); PetEngine.notify('pet'); T.sim(100);
          expect(T.view().eyes === 'happy' && T.body().wag === 'excited', '#16 shiba petting');
        } finally {
          U.closeMenu(); try { closeModal('theme-modal'); } catch (e) { /* ignore */ }
          Object.assign(userTheme, JSON.parse(savedT)); applyTheme();
          if (savedPet === null) localStorage.removeItem('pbf_pet'); else localStorage.setItem('pbf_pet', savedPet);
          T.reload();
        }
      }));
    },
    // v3.1: no backgrounds/weather/visitors, buttons are solid, no gags.
    async v31() {
      const savedT = JSON.stringify(userTheme), savedPet = localStorage.getItem('pbf_pet');
      return withSandbox(() => check(expect => {
        const T = PetEngine._test, W = T.units.PetWorld, B = T.units.PetBody;
        try {
          // nothing is drawn behind the dock
          T.resetPet('cat'); applyTheme(); T.render();
          const env = document.getElementById('pixel-scene-canvas');
          const px = env.width && env.height ? env.getContext('2d').getImageData(0, 0, env.width, env.height).data : [];
          let painted = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) painted++;
          expect(painted === 0, 'background canvas has ' + painted + ' painted pixels');
          expect(typeof W.stepAmbient === 'undefined' && W.visitor === undefined && W.weather === undefined && W.poops === undefined, 'weather / visitors / poop still exist');
          // the buttons are one solid block on the floor
          const S = W.measure(), blk = W.blocks()[0];
          expect(blk && blk.x0 <= S.find(s => s.id === 'generate').x0 + 2 && blk.x1 >= S.find(s => s.id === 'reset').x1 - 2, 'button block: ' + JSON.stringify(blk));
          // walking past the block: never overlaps it on the floor, goes over the top instead
          const b = T.body(), bw = B.widthOf(b), fl = S[0];
          const roomL = blk.x0 - fl.x0 >= bw + 4, roomR = fl.x1 - blk.x1 >= bw + 4;
          const start = roomR ? blk.x1 + 4 : blk.x0 - bw - 4, end = roomL ? blk.x0 - bw - 4 : blk.x0 + 4;
          T.placeOnSurface('floor', start); T.brain().act = { name: 'react:hold', phase: 0, until: 1e12, data: {} };
          B.walkTo(b, end, 'walk');
          let overlap = 0, onTop = false;
          for (let i = 0; i < 900; i++) {
            T.stepBody(33);
            if (b.surf === 'floor' && b.mode !== 'air' && b.x + bw > blk.x0 + 1 && b.x < blk.x1 - 1) overlap++;
            if (b.surf === 'generate' || b.surf === 'reset') onTop = true;
            if (b.surf === 'floor' && b.mode === 'idle' && Math.abs(b.x - end) < 3) break;
          }
          expect(overlap === 0, 'pet walked through the buttons (' + overlap + ' steps)');
          expect(onTop, 'pet never climbed onto the buttons');
          if (roomL && roomR) expect(b.surf === 'floor' && Math.abs(b.x - end) < 3, 'did not reach the far side: ' + b.surf + ' ' + Math.round(b.x));
          // a ball rolled at the block bounces back
          W.clearProps();
          const ball = W.spawnToy('ball', roomR ? blk.x1 + 30 : blk.x0 - 30, fl.y, roomR ? -150 : 150); ball.surf = 'floor';
          let inside = 0, flipped = false;
          for (let i = 0; i < 200; i++) { W.stepToys(33, S); if (ball.surf === 'floor' && ball.x > blk.x0 + 1 && ball.x < blk.x1 - 1) inside++; if (Math.sign(ball.vx) === (roomR ? 1 : -1)) flipped = true; }
          expect(inside === 0 && flipped, 'ball went through the buttons: inside=' + inside + ' flipped=' + flipped);
          // a treat dropped behind a button lands on its top
          W.clearProps(); const tb = W.spawnTreat('fish', (blk.x0 + blk.x1) / 2, 'floor');
          expect(tb && tb.surf !== 'floor', 'treat placed behind a button');
          // no gags
          T.resetPet('cat'); for (let i = 0; i < 25; i++) { T.feedNow(); T.sim(8000); }
          expect(T.view().pose !== 'faint' && !T.units.PetUI.menuItems('pet').some(i => i.id === 'revive'), 'gags still present');
        } finally {
          W.clearProps();
          Object.assign(userTheme, JSON.parse(savedT)); applyTheme();
          if (savedPet === null) localStorage.removeItem('pbf_pet'); else localStorage.setItem('pbf_pet', savedPet);
          T.reload();
        }
      }));
    },
    // v3.2: minimalist Theme settings with one companion bar.
    async themeSettings() {
      const savedT = JSON.stringify(userTheme), savedPet = localStorage.getItem('pbf_pet'), savedTheme = localStorage.getItem('pbf_theme');
      return withSandbox(() => check(expect => {
        const m = document.getElementById('theme-modal');
        try {
          openModal('theme-modal'); applyTheme();
          const sw = [...m.querySelectorAll('.ts-swatch')];
          expect(sw.length === Object.keys(palettes).length, 'one swatch per theme: ' + sw.length);
          expect(m.querySelector('[role="radiogroup"] .ts-swatch[aria-checked="true"]').dataset.value === userTheme.palette, 'selected swatch matches the theme');
          sw.find(s => s.dataset.value === 'space').click();
          expect(userTheme.palette === 'space' && document.documentElement.dataset.palette === 'space', 'swatch click did not change theme');
          // v3.5: each tile carries its theme's name and colours
          expect(sw.every(s => s.querySelector('.ts-sw-name').textContent === palettes[s.dataset.value].name), 'tile names do not match the themes');
          expect(sw.every(s => { const n = s.querySelector('.ts-sw-name'); return n.scrollWidth <= n.clientWidth; }), 'a tile name is clipped');
          expect(sw.find(s => s.dataset.value === 'space').style.getPropertyValue('--sw-bg') === palettes.space.bg, 'tile does not use its theme background');
          expect(new Set(sw.map(s => Math.round(s.getBoundingClientRect().top))).size >= 2, 'theme tiles do not span 2+ rows');
          sw.find(s => s.dataset.value === 'claude').click();
          expect([...m.querySelectorAll('.ts-scale button')].map(b => b.dataset.value).join() === '90,100,120,140', 'display scale stops are 90/100/120/140');
          expect(document.getElementById('ts-scale-label').textContent === 'Display scale', 'label reads Display scale');
          m.querySelector('.ts-scale [data-value="120"]').click();
          expect(userTheme.scale === 1.2 && m.querySelector('.ts-scale [data-value="120"]').getAttribute('aria-checked') === 'true', 'display size segment');
          // v3.3: no accent picker; the accent follows the theme; iOS is called Glass
          expect(!document.getElementById('theme-accent-btn') && !document.getElementById('color-dropdown'), 'accent picker still present');
          sw.find(s => s.dataset.value === 'ios').click();
          expect(sw.find(s => s.dataset.value === 'ios').textContent === 'Glass' && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === palettes.ios[userTheme.mode].accent, 'Glass theme name/accent');
          sw.find(s => s.dataset.value === 'claude').click();
          m.querySelector('.ts-scale [data-value="100"]').click();
          // the companion bar: one place for the animal and the pet card
          const bar = m.querySelector('.ts-companion');
          expect(bar && bar.contains(document.getElementById('pet-card-btn')) && bar.querySelector('.ts-species'), 'companion bar does not hold both the pet card and the animal choice');
          expect(getComputedStyle(document.getElementById('theme-animal')).opacity === '0', 'old companion dropdown still visible');
          bar.querySelector('.ts-species [data-value="shiba"]').click();
          expect(userTheme.animal === 'shiba', 'species segment did not pick the Shiba');
          // v3.3: the bar shows only the animal, no name/mood text
          const petBtn = document.getElementById('pet-card-btn');
          expect(petBtn.querySelector('.ts-pet-portrait') && petBtn.textContent.trim() === '', 'pet button should show only the animal: "' + petBtn.textContent.trim() + '"');
          document.getElementById('pet-card-btn').click();
          expect(document.getElementById('pet-card-modal').classList.contains('active'), 'clicking the pet did not open the pet card');
          closeModal('pet-card-modal');
          bar.querySelector('.ts-species [data-value="off"]').click();
          expect(userTheme.animal === 'off' && document.getElementById('pet-card-btn').disabled, 'Off should disable the pet card');
          // keyboard: arrows move within a radiogroup
          const first = m.querySelector('.ts-species [data-value="off"]'); first.focus();
          first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
          expect(userTheme.animal === 'cat' && document.activeElement.dataset.value === 'cat', 'ArrowRight in the animal switch');
        } finally {
          closeModal('theme-modal');
          Object.assign(userTheme, JSON.parse(savedT)); applyTheme();
          if (savedPet === null) localStorage.removeItem('pbf_pet'); else localStorage.setItem('pbf_pet', savedPet);
          if (savedTheme === null) localStorage.removeItem('pbf_theme'); else localStorage.setItem('pbf_theme', savedTheme);
          PetEngine._test.reload();
        }
      }));
    },
    async all() {
      const failures = [];
      for (const g of ['core', 'store', 'art', 'render', 'body', 'brain', 'ui', 'toys', 'card', 'perf', 'fixes', 'v31', 'themeSettings', 'parityV29']) {
        const r = await pet[g](); r.failures.forEach(f => failures.push(g + ': ' + f));
      }
      return { pass: failures.length === 0, failures };
    },
    async parityV29() {
      const diff = compare(await baseline('/tests/baselines/PBF%20generator%20v2.9.html'));
      return { pass: diff.length === 0, failures: diff };
    }
  };

  window.PBFTest = Object.assign(window.PBFTest || {}, { pet, CASES, VALIDATION, run, compare, baseline, parity, check, legacyCheck, tooltipChecks, layoutChecks, dockChecks, modalChecks, adminChecks, storageChecks, dockHeightCheck, bugfixChecks, removalChecks, tweakChecks, zenlessChecks, key, click, resolve, freshStart, withSandbox });
})();