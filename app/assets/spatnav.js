// spatnav.js: TV remote spatial navigation for any website inside the browser view.
(() => {
  if (window.__fp) return;
  window.__fp = 1;

  const SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,video,iframe,label[for],' +
    '[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[onclick],[tabindex]:not([tabindex="-1"])';
  const TYPING = /^(text|search|email|url|tel|password|number|date|time|datetime-local|month|week)$/i;
  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  let cur = null;

  const Roles = window.__fpRoles || { roleOf: () => '', dialogs: () => [] };
  const role = el => Roles.roleOf(el);

  const style = () => {
    const s = document.createElement('style');
    s.textContent = '.__fp{outline:4px solid #FF3B5C!important;outline-offset:2px!important;' +
      'box-shadow:0 0 0 8px rgba(255,59,92,.35)!important;border-radius:6px;transition:outline-offset .1s}';
    (document.head || document.documentElement).appendChild(s);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', style) : style();

  const gap = (a1, a2, b1, b2) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));
  const inView = r => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;

  function clickable(el) {
    if (el.matches('[role=slider],input[type=range]') || /progress|seek|scrub|timeline|slider/i.test((el.getAttribute('class') || '') + ' ' + el.id)) return false;
    const r = el.getBoundingClientRect();
    if (r.width > innerWidth * 0.4 && r.height < 48 && bigVideo()) return false;
    if (el.matches(SEL)) return !el.disabled;
    const c = getComputedStyle(el).cursor;
    return c === 'pointer' && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer');
  }

  function shown(el, r) {
    if (r.width < 6 || r.height < 6) return false;
    if (r.width * r.height > innerWidth * innerHeight * 0.5 && !/^(VIDEO|IFRAME)$/.test(el.tagName)) return false;
    if (el.checkVisibility) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && +s.opacity > 0.05;
  }

  function origin(dir) {
    if (cur && document.contains(cur)) {
      const r = cur.getBoundingClientRect();
      if (inView(r)) return r;
    }
    const w = innerWidth, h = innerHeight;
    return { up: { left: 0, right: w, top: h, bottom: h }, down: { left: 0, right: w, top: 0, bottom: 0 },
      left: { left: w, right: w, top: 0, bottom: h }, right: { left: 0, right: 0, top: 0, bottom: h } }[dir];
  }

  function blockedSet(all) {
    const covered = [], open = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth || !shown(el, r) || !clickable(el)) continue;
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2);
      const hit = document.elementFromPoint(x, y);
      (hit && hit !== el && !el.contains(hit) && !hit.contains(el) ? covered : open).push(el);
    }
    return new Set(open.length ? covered : []);
  }

  function find(dir, from) {
    const f = from || origin(dir), w = innerWidth, h = innerHeight;
    const all = document.querySelectorAll('body *'), blocked = blockedSet(all);
    let best = null, bestScore = Infinity, bestP = 0;
    for (const el of all) {
      if (el === cur || blocked.has(el) || (cur && (el.contains(cur) || cur.contains(el)))) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < -h || r.top > 2 * h || r.right < -w || r.left > 2 * w) continue;
      let p, s;
      if (dir === 'down') { p = r.top - f.bottom; s = gap(r.left, r.right, f.left, f.right); }
      else if (dir === 'up') { p = f.top - r.bottom; s = gap(r.left, r.right, f.left, f.right); }
      else if (dir === 'right') { p = r.left - f.right; s = gap(r.top, r.bottom, f.top, f.bottom); }
      else { p = f.left - r.right; s = gap(r.top, r.bottom, f.top, f.bottom); }
      if (p < -2) continue;
      const score = p + 2 * s;
      if (score >= bestScore || !shown(el, r) || !clickable(el) || role(el) === 'dot') continue;
      best = el; bestScore = score; bestP = p;
    }
    const limit = dir === 'up' || dir === 'down' ? h * 0.75 : w * 0.9;
    return best && bestP <= limit ? best : null;
  }

  function scrollable(el, dx, dy) {
    const root = el === document.scrollingElement || el === document.documentElement || el === document.body;
    if (!root) {
      const s = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(dy ? s.overflowY : s.overflowX)) return false;
    }
    if (dy > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    if (dy < 0) return el.scrollTop > 0;
    if (dx > 0) return el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    return el.scrollLeft > 0;
  }

  function scroll(dir) {
    const dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0, dy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
    let el = cur && document.contains(cur) ? cur.parentElement : null;
    while (el && !scrollable(el, dx, dy)) el = el.parentElement;
    const page = document.scrollingElement || document.documentElement;
    if (!el && scrollable(page, dx, dy)) el = page;
    if (!el) {
      let area = 0;
      for (const c of document.querySelectorAll('body *')) {
        if (!scrollable(c, dx, dy)) continue;
        const a = c.clientWidth * c.clientHeight;
        if (a > area) { area = a; el = c; }
      }
    }
    if (!el) return false;
    el.scrollBy({ left: dx * innerWidth * 0.6, top: dy * innerHeight * 0.6, behavior: 'smooth' });
    return true;
  }

  const pointerMode = () => { try { return !!(window.FMHY && FMHY.pointer && FMHY.pointer()); } catch (e) { return false; } };
  const clear = () => {
    document.querySelectorAll('.__fp').forEach(e => e.classList.remove('__fp'));
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
    cur = null;
  };
  window.__fpClear = clear;
  window.__fpResume = () => { cur = null; touched = false; settle(); };

  function highlight(el) {
    if (pointerMode()) return;
    if (cur) cur.classList.remove('__fp');
    cur = el;
    el.classList.add('__fp');
    if (el.tagName === 'IFRAME') {
      if (document.activeElement === el) el.blur();
    } else {
      if (!el.matches('a[href],button,input,select,textarea,summary,[tabindex]')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
    const r = el.getBoundingClientRect();
    if (r.top < 40 || r.bottom > innerHeight - 40 || r.left < 0 || r.right > innerWidth)
      el.scrollIntoView({ block: r.height > innerHeight * 0.8 ? 'start' : 'center', inline: 'center', behavior: 'smooth' });
  }

  function move(dir) {
    const next = find(dir);
    if (next) return highlight(next);
    if (scroll(dir)) return;
    if (bigVideo()) {
      if (cur) cur.classList.remove('__fp');
      cur = null;
      return;
    }
    if (window.parent !== window) {
      if (cur) cur.classList.remove('__fp');
      cur = null;
      parent.postMessage({ __fp: 'exit', dir }, '*');
    }
  }

  function bigVideo() {
    return [...document.querySelectorAll('video')].find(v => {
      const r = v.getBoundingClientRect();
      return r.width * r.height > innerWidth * innerHeight * 0.3;
    });
  }

  let touched = false, autoPicked = false;
  function settle() {
    if (pointerMode()) return;
    if (cur) cur.classList.remove('__fp');
    cur = null;
    if (bigVideo()) return;
    const all = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (inView(r) && shown(el, r) && clickable(el)) all.push(el);
    }
    const reading = (a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return Math.abs(x.top - y.top) > 40 ? x.top - y.top : x.left - y.left; };
    const calm = el => !['dot', 'tab', 'menu', 'search', 'close', 'back'].includes(role(el));
    const pick = all.find(el => role(el) === 'play') || all.find(el => role(el) === 'enter') || all.filter(el => role(el) === 'tile').sort(reading)[0] || all.find(calm) || all[0];
    if (pick) highlight(pick);
    autoPicked = true;
  }

  function activate(el) {
    if (el.tagName === 'VIDEO') { el.paused ? el.play() : el.pause(); return; }
    if (el.tagName === 'IFRAME') { el.focus(); el.contentWindow.postMessage({ __fp: 'enter' }, '*'); return; }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !/^(checkbox|radio|submit|button|reset|image)$/i.test(el.type)) {
      el.focus();
      return;
    }
    const a = el.closest('a[href]');
    if (a && window.FMHY) FMHY.clicked(a.href);
    if (!el.matches('a,button,input,summary,label')) {
      const r = el.getBoundingClientRect(), at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
        el.dispatchEvent(t[0] === 'p' && window.PointerEvent ? new PointerEvent(t, at) : new MouseEvent(t, at));
    }
    el.click();
  }

  window.__fpStep = dir => move(dir);
  window.__fpClick = () => { if (cur && document.contains(cur)) activate(cur); else settle(); };
  addEventListener('load', () => setTimeout(settle, 400));
})();
