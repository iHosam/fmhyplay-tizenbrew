// frame.js: Runs in every frame; discovers server/quality options and sniffs HLS/DASH streams.
(() => {
  if (window.__fpf) return;
  window.__fpf = 1;
  const fid = Math.random().toString(36).slice(2, 7);
  let items = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const label = e => (e.innerText || '').trim().replace(/\s+/g, ' ');
  const junk = /reorder|drag|close|cancel|dismiss|^back\b|search all|again|^[x×✕]$/i;
  const onTok = /^(is[-_])?(active|selected|current|checked|playing)$|[-_](active|selected|current)$/i;
  const optSel = 'button,[role=option],[role=menuitem],[role=radio],li,a';
  const leaf = e => !e.querySelector(optSel);

  const isOn = e => {
    for (let n = e, i = 0; n && i < 4; n = n.parentElement, i++) {
      if ([...n.classList].some(t => onTok.test(t))) return true;
      if (n.getAttribute('aria-selected') === 'true' || n.getAttribute('aria-checked') === 'true' || n.hasAttribute('aria-current')) return true;
    }
    return false;
  };
  const click = e => {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
      e.dispatchEvent(new (t[0] === 'p' && window.PointerEvent ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, view: window }));
    e.click();
  };
  const wake = async () => {
    const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    for (const t of [document, document.body, v, v && v.parentElement])
      if (t) for (const n of ['pointermove', 'mousemove']) t.dispatchEvent(new MouseEvent(n, { bubbles: true, clientX: 200, clientY: 200 }));
    await wait(450);
  };

  const named = /\b(servers?|sources?|mirrors?|providers?)\b/i;
  const meta = e => String(e.className && e.className.baseVal === undefined ? e.className : '') + ' ' + e.id + ' ' + [...e.attributes].filter(a => /^data-/.test(a.name)).map(a => a.name + a.value).join(' ');
  const onScreen = () => {
    const all = [...document.querySelectorAll('button,a,li,span,div,[role=tab],[role=button],[role=option]')].filter(e => {
      const t = label(e);
      if (t.length < 2 || t.length > 28) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || r.width > 420 || !leaf(e)) return false;
      return /^(server|source|mirror|provider|player|embed)\b/i.test(t) || named.test(meta(e));
    });
    const g = new Map();
    for (const e of all) { const p = e.parentElement; if (!g.has(p)) g.set(p, []); g.get(p).push(e); }
    let out = [];
    for (const v of g.values()) if (v.length >= 2) out = out.concat(v);
    return out.slice(0, 12).map(e => ({ label: label(e), on: isOn(e), el: e }));
  };

  const markOdd = list => {
    const cls = list.map(x => String(x.el.className)), n = new Map();
    cls.forEach(c => n.set(c, (n.get(c) || 0) + 1));
    const odd = list.filter((x, i) => n.get(cls[i]) === 1);
    if (list.length >= 3 && odd.length === 1 && !list.some(x => x.on)) odd[0].on = true;
    return list;
  };

  const headRe = /^(servers?|sources?|mirrors?|providers?)$/i, qualRe = /^(quality|qualities|resolution)$/i;
  const textOf = e => [...e.querySelectorAll('*')].filter(c => !c.children.length).map(c => (c.textContent || '').trim()).filter(Boolean).join(' ') || (e.textContent || '').trim();
  const firstText = e => [...e.querySelectorAll('*')].filter(c => !c.children.length).map(c => (c.textContent || '').trim()).find(Boolean) || (e.textContent || '').trim();
  const headed = () => {
    const out = { s: [], q: [] };
    for (const h of document.querySelectorAll('*')) {
      if (h.children.length > 1 || h.closest(optSel)) continue;
      const t = (h.textContent || '').trim();
      const kind = headRe.test(t) ? 's' : qualRe.test(t) ? 'q' : '';
      if (!kind || out[kind].length) continue;
      for (let c = h.parentElement, i = 0; c && i < 3; c = c.parentElement, i++) {
        const opts = [...c.querySelectorAll(optSel)].filter(e => leaf(e) && !e.contains(h));
        const names = opts.map(textOf);
        if (opts.length >= 2 && names.every(n => n.length >= 1 && n.length <= 30 && !junk.test(n))) {
          out[kind] = markOdd(opts.slice(0, 24).map((e, j) => ({ label: names[j], on: isOn(e), el: e })));
          break;
        }
      }
    }
    return out;
  };

  const openers = () => [...document.querySelectorAll('button,[role=button],a')].filter(b => {
    const t = (b.getAttribute('aria-label') || b.title || label(b)).trim();
    return /^(servers?|sources?|mirrors?|change (server|source))$/i.test(t);
  });
  const entries = added => added.filter(e => e.matches(optSel) && leaf(e)).filter(e => {
    const t = firstText(e);
    return t.length >= 1 && t.length <= 30 && !junk.test(t) && !junk.test(e.getAttribute('aria-label') || '');
  });
  const closeMenu = (added, op) => {
    const x = added.find(e => /close|dismiss|cancel/i.test(e.getAttribute('aria-label') || e.title || ''));
    click(x || op);
  };
  const viaMenu = async () => {
    let ops = openers();
    if (!ops.length) { await wake(); ops = openers(); }
    for (const op of ops) {
      const before = new Set(document.getElementsByTagName('*'));
      click(op);
      await wait(700);
      const added = [...document.getElementsByTagName('*')].filter(e => !before.has(e));
      const list = entries(added);
      closeMenu(added, op);
      if (list.length >= 2) return list.slice(0, 12).map(e => ({ label: label(e), on: isOn(e), menu: true }));
    }
    return [];
  };
  const settingsBtns = () => [...document.querySelectorAll('button,[role=button]')].filter(b => /^(settings?|options?|more options|menu)$/i.test((b.getAttribute('aria-label') || b.title || label(b)).trim()));
  const sourceRow = added => added.find(e => e.matches(optSel) && /^(servers?|sources?)$/i.test(firstText(e)));
  const openRow = () => [...document.querySelectorAll(optSel)].find(e => /^(servers?|sources?)$/i.test(firstText(e)) && e.closest('[role=dialog],[role=menu]'));
  const sourceList = () => {
    const dlg = [...document.querySelectorAll('[role=dialog],[role=menu],[role=listbox]')].reverse().find(d => /server|source/i.test(d.getAttribute('aria-label') || ''));
    return entries([...(dlg || document.body).querySelectorAll('*')]);
  };
  const viaSettings = async () => {
    let ops = settingsBtns();
    if (!ops.length) { await wake(); ops = settingsBtns(); }
    for (const op of ops) {
      const before = new Set(document.getElementsByTagName('*'));
      let row = openRow(), added = [];
      if (!row) {
        click(op);
        await wait(700);
        added = [...document.getElementsByTagName('*')].filter(e => !before.has(e));
        row = sourceRow(added);
      }
      let list = [];
      if (row) { click(row); await wait(700); list = sourceList(); }
      const names = list.map(firstText), marks = list.map(isOn);
      closeMenu(added, op);
      if (list.length >= 2) return names.slice(0, 24).map((n, i) => ({ label: n, on: marks[i], settings: true }));
    }
    return [];
  };

  const press = async it => {
    if (it.el && document.contains(it.el)) { click(it.el); return; }
    if (it.el) {
      const fresh = headed()[it.kind === 'q' ? 'q' : 's'].find(x => x.label === it.label);
      if (fresh) { click(fresh.el); return; }
    }
    if (it.settings) {
      let op = settingsBtns()[0];
      if (!op) { await wake(); op = settingsBtns()[0]; }
      if (!op) return;
      const before = new Set(document.getElementsByTagName('*'));
      let row = openRow();
      if (!row) {
        click(op);
        await wait(700);
        row = sourceRow([...document.getElementsByTagName('*')].filter(e => !before.has(e)));
      }
      if (!row) return;
      click(row);
      await wait(700);
      const t = sourceList().find(e => firstText(e) === it.label);
      if (t) click(t);
      return;
    }
    if (!it.menu) return;
    let op = openers()[0];
    if (!op) { await wake(); op = openers()[0]; }
    if (!op) return;
    click(op);
    await wait(700);
    const t = [...document.querySelectorAll(optSel)].find(e => leaf(e) && label(e) === it.label);
    if (t) click(t);
  };

  const report = (url, dash) => {
    try {
      const u = new URL(url, location.href);
      window.FMHY && FMHY.stream(u.href, !!dash, location.href, u.origin !== location.origin ? u.origin : '');
    } catch (e) { }
  };
  const sniff = (url, head) => {
    if (/^\s*#EXTM3U/.test(head)) report(url, false);
    else if (/^\s*(<\?xml[^>]*>\s*)?<MPD[\s>]/.test(head)) report(url, true);
  };
  try {
    const xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      this.addEventListener('load', () => {
        try {
          const t = this.responseType;
          if (t === '' || t === 'text') sniff(this.responseURL, String(this.responseText).slice(0, 64));
          else if (t === 'arraybuffer' && this.response && this.response.byteLength < 4e6) sniff(this.responseURL, new TextDecoder().decode(new Uint8Array(this.response, 0, 32)));
        } catch (e) { }
      });
      return xo.apply(this, arguments);
    };
    const fo = window.fetch;
    window.fetch = function () {
      const p = fo.apply(this, arguments);
      p.then(r => {
        const ct = r.headers.get('content-type') || '', len = +(r.headers.get('content-length') || 0);
        if (/video|audio|image|font|css|javascript/i.test(ct) || len > 4e6 || !r.body) return;
        const rd = r.clone().body.getReader();
        rd.read().then(c => { rd.cancel(); if (c.value) sniff(r.url, new TextDecoder().decode(c.value.slice(0, 32))); }).catch(() => { });
      }).catch(() => { });
      return p;
    };
  } catch (e) { }

  const up = m => window === top ? (window.FMHY && FMHY.servers(JSON.stringify(m.items))) : parent.postMessage(m, '*');
  const down = m => { for (let i = 0; i < frames.length; i++) try { frames[i].postMessage(m, '*'); } catch (x) { } };
  addEventListener('message', async e => {
    const d = e.data;
    if (!d || typeof d !== 'object' || !d.fp) return;
    if (d.fp === 'pause') { document.querySelectorAll('video,audio').forEach(m => m.pause()); down(d); }
    else if (d.fp === 'servers') {
      down(d);
      const h = headed();
      let sv = markOdd(onScreen());
      if (sv.length < 2) sv = h.s;
      if (sv.length < 2) sv = await viaMenu();
      if (sv.length < 2) sv = await viaSettings();
      items = sv.map(x => Object.assign(x, { kind: 's' })).concat(h.q.map(x => Object.assign(x, { kind: 'q' })));
      if (items.length) up({ fp: 'reply', items: items.map((it, i) => ({ k: fid + ':' + i, label: it.label, on: it.on, kind: it.kind })) });
      if (window === top && window.FMHY) FMHY.scanDone();
    } else if (d.fp === 'reply') up(d);
    else if (d.fp === 'click') {
      const i = items.findIndex((_, j) => fid + ':' + j === d.k);
      if (i >= 0) press(items[i]);
      down(d);
    }
  });
})();
