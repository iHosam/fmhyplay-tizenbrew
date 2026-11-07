// roles.js: decides what an element on a streaming site IS (close, accept, play, servers, quality, tile, etc.)
(() => {
  if (window.__fpRoles) return;

  const NO = /playlist|watchlist|watch ?part|multi|trailer|my list|list\b/i;
  const ICON = (names, re) => re.test(names);
  const rules = [
    ['close', s => {
      if (s.iconOnly && s.small && ICON(s.icons, /(^|[-_:,])(x|close|times|cross|xmark|x-circle|circle-x|clear)([-_:,]|$)/i)) return 9;
      if (/^(close|dismiss)(\b|$)/i.test(s.label) || /^(close|dismiss)(\b|$)/i.test(s.text)) return 10;
      if (/^(×|✕|✖|x|cancel|not now|no,? thanks|maybe later|later|skip|no thanks|close)$/i.test(s.text)) return 9;
      if (s.small && /(^|[^a-z])(close|dismiss|tf-x|modal-x|btn-x)([^a-z]|$)/i.test(s.cls)) return 7;
      return 0;
    }],
    ['accept', s => (/^(got it!?|ok(ay)?|accept( all| cookies)?|i agree|agree|allow|understood|confirm|yes)\b/i.test(s.text) || /^(accept|agree)\b/i.test(s.label) ? 9 : 0)],
    ['play', s => {
      if (NO.test(s.label) || NO.test(s.text)) return 0;
      if (/^(▶\s*)?(play|watch|watch now|play now|resume|continue watching|start watching|watch free|play movie|play episode( \d+)?)$/i.test(s.text)) return 10;
      if (/^(play|watch now|resume)$/i.test(s.label)) return 10;
      if (/^play\s+\S/i.test(s.label) && !/play ?list/i.test(s.label)) return 6;
      if (ICON(s.icons, /(^|[-_:,])play(-circle|-fill|-icon|-button)?([-_:,]|$)/i) && !ICON(s.icons, /pause/i)) return 8;
      if (/(hero-play|play-btn|btn-play|big-play|play-button|group\/play)/i.test(s.cls)) return 7;
      return 0;
    }],
    ['playpause', s => (/^play ?\/ ?pause$|^toggle play/i.test((s.label || s.text).trim()) ? 10 : 0)],
    ['enter', s => (/^(enter( site)?|enter here|proceed|i am (18|over 18)|i'm (18|over 18)|continue to (site|website)|agree (and|&) enter)$/i.test((s.text || s.label).trim()) ? 9 : 0)],
    ['back', s => (/^(go back|back|return|back to .{0,20})$/i.test(s.label || s.text) ? 8 : 0)],
    ['pause', s => (/^pause$/i.test(s.label) || ICON(s.icons, /(^|[-_:,])pause([-_:,]|$)/i) ? 9 : 0)],
    ['fullscreen', s => (/full ?screen|enter full|expand/i.test(s.label + ' ' + s.text) || ICON(s.icons, /(maximi[sz]e|fullscreen|expand)/i) ? 9 : 0)],
    ['subtitles', s => (/subtitle|caption|\bcc\b/i.test(s.label + ' ' + s.text) || ICON(s.icons, /(captions|subtitles|closed-caption)/i) ? 9 : 0)],
    ['servers', s => (/^(servers?|sources?)$/i.test(s.text) || /^(servers?|sources?)\b/i.test(s.label) || ICON(s.icons, /(server|database)/i) ? 8 : 0)],
    ['settings', s => (/^settings?$/i.test(s.text) || /^settings?\b/i.test(s.label) || ICON(s.icons, /(settings|gear|cog|sliders)/i) ? 8 : 0)],
    ['episodes', s => (/^s ?\d+ ?e ?\d+/i.test(s.text) || /^(episodes?|seasons?)$/i.test(s.text) || /^episodes?\b/i.test(s.label) || ICON(s.icons, /(list-video|layers|episodes)/i) ? 8 : 0)],
    ['quality', s => (/^(\d{3,4}p|hd|4k|auto|quality)$/i.test(s.text) ? 8 : 0)],
    ['seek-back', s => (/(back|rewind|replay|previous).{0,12}\d+|^-\s?\d+/i.test(s.label) || ICON(s.icons, /(rotate-ccw|undo|replay|rewind|skip-back)/i) ? 8 : 0)],
    ['seek-fwd', s => (/(forward|skip|next).{0,12}\d+|^\+\s?\d+/i.test(s.label) || ICON(s.icons, /(rotate-cw|redo|forward|skip-forward)/i) ? 8 : 0)],
    ['next', s => (/^(next|next episode)\b/i.test(s.label + ' ' + s.text) ? 7 : 0)],
    ['prev', s => (/^(prev|previous)\b/i.test(s.label + ' ' + s.text) ? 7 : 0)],
    ['mute', s => (/^(mute|unmute|volume)\b/i.test(s.label) || ICON(s.icons, /(volume|speaker)/i) ? 7 : 0)],
    ['field', s => (s.tag === 'input' || s.tag === 'textarea' || s.tag === 'select' ? 9 : 0)],
    ['search', s => (/^(open )?search\b/i.test(s.label) || /^search$/i.test(s.text) || ICON(s.icons, /(^|[-_:,])search([-_:,]|$)/i) ? 9 : 0)],
    ['menu', s => (/^(open )?(menu|more|account|profile|filter|guest)\b/i.test(s.label) || /^(menu|more|guest)$/i.test(s.text) || ICON(s.icons, /(^|[-_:,])(menu|ellipsis|more-|user|hamburger|filter)/i) ? 7 : 0)],
    ['dot', s => (s.role === 'tab' && s.w <= 40 && s.h <= 40 && !s.text ? 9 : 0)],
    ['tab', s => (s.role === 'tab' || s.inNav ? 6 : 0)],
    ['tile', s => (s.hasImg && s.w >= 80 && s.w <= 460 && s.h >= 80 && s.h <= 640 && s.h / s.w >= 0.5 && s.h / s.w <= 2 && (s.tag === 'a' || s.inRail) ? 6 : 0)],
  ];

  function classify(s) {
    let best = '', top = 0;
    for (const [role, test] of rules) { const w = test(s); if (w > top) { top = w; best = role; } }
    return best || (s.tag === 'a' ? 'link' : s.tag === 'button' || s.role === 'button' ? 'button' : 'link');
  }

  const iconNames = e => {
    const out = new Set();
    const add = n => {
      const m = ((n.getAttribute('class') || '') + ' ' + (n.getAttribute('href') || n.getAttribute('xlink:href') || ''))
        .match(/(?:lucide|fa|bi|ri|ph|tabler|mdi|icon|material|heroicon|feather|ti)[-_a-z0-9]*/gi);
      if (m) m.forEach(t => out.add(t.toLowerCase()));
    };
    add(e);
    e.querySelectorAll('svg,i,use,span[class*=icon],span.material-icons').forEach(n => {
      add(n);
      if (/material/.test(n.className || '') && n.textContent.trim().length < 24) out.add('mi:' + n.textContent.trim().toLowerCase().replace(/_/g, '-'));
    });
    return [...out].slice(0, 6).join(',');
  };

  const cache = new WeakMap();
  const signals = e => {
    const r = e.getBoundingClientRect();
    const text = (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return {
      tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '',
      label: (e.getAttribute('aria-label') || e.title || e.getAttribute('alt') || '').trim().slice(0, 40), text,
      icons: iconNames(e), cls: ((typeof e.className === 'string' ? e.className : e.getAttribute('class')) || '').slice(0, 120),
      w: r.width, h: r.height, small: r.width <= 72 && r.height <= 72, iconOnly: !text,
      hasImg: !!e.querySelector('img,picture,[style*=background]'), inNav: !!e.closest('nav,header,[role=navigation]'),
      inRail: !!e.parentElement && e.parentElement.children.length >= 5 && /(auto|scroll)/.test(getComputedStyle(e.parentElement).overflowX),
    };
  };

  const roleOf = (e, fresh) => {
    if (!fresh && cache.has(e)) return cache.get(e);
    const role = classify(signals(e));
    cache.set(e, role);
    return role;
  };

  const dialogs = () => {
    const out = [];
    const W = innerWidth, H = innerHeight;
    for (const e of document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],body *')) {
      const s = getComputedStyle(e);
      const explicit = e.matches('[role=dialog],[role=alertdialog],[aria-modal=true]');
      if (!explicit && s.position !== 'fixed') continue;
      const r = e.getBoundingClientRect();
      const vis = e.checkVisibility ? e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : (s.visibility !== 'hidden' && +s.opacity > 0.05);
      if (r.width < 120 || r.height < 80 || r.bottom <= 0 || r.top >= H || !vis) continue;
      if (!explicit) {
        const bar = (r.width > W * 0.6 && r.height < H * 0.35 && (r.top < 4 || r.bottom > H - 4)) || (r.height > H * 0.8 && r.width < W * 0.35 && (r.left < 4 || r.right > W - 4));
        if (bar || r.width * r.height > W * H * 0.97 && !e.querySelector('button,a[href]')) continue;
      }
      if (!out.some(o => o.contains(e))) out.push(e);
    }
    return out.filter((e, i) => !out.some((o, j) => j !== i && e.contains(o) && o !== e));
  };

  window.__fpRoles = { classify, roleOf, signals, iconNames, dialogs };
})();
