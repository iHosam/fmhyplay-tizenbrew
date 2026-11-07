// autosearch.js: Finds the site's search box, types the title, and submits.
window.__fpAutoSearch = (q => {
  if (!q || window.__fpQ === q) return;
  window.__fpQ = q;
  const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 30 && r.height > 12 && s.visibility != 'hidden' && s.display != 'none'; };
  const label = e => [e.placeholder, e.name, e.id, e.getAttribute('aria-label'), e.title, typeof e.className == 'string' ? e.className : (e.className && e.className.baseVal) || ''].join(' ');
  const field = () => [...document.querySelectorAll('input')].find(i => !/^(hidden|checkbox|radio|button|submit|file|password|email|number|date)$/.test(i.type) && visible(i) && (i.type == 'search' || /search|find|title|movie|show|query|\bq\b/i.test(label(i))));
  const type = i => {
    i.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, q);
    i.dispatchEvent(new Event('input', {bubbles: true}));
    i.dispatchEvent(new Event('change', {bubbles: true}));
    ['keydown', 'keypress', 'keyup'].forEach(t => i.dispatchEvent(new KeyboardEvent(t, {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true})));
    if (i.form && i.form.requestSubmit) try { i.form.requestSubmit(); } catch (e) { }
    if (window.FMHY && FMHY.searched) FMHY.searched();
  };
  let n = 0, opened = false;
  const timer = setInterval(() => {
    const i = field();
    if (i) { clearInterval(timer); type(i); return; }
    if (n++ > 2 && !opened) {
      const b = [...document.querySelectorAll('button,a,[role=button],svg,div,span')].find(e => /search/i.test(label(e)) && e.children.length < 6 && (() => { const t = e.closest('button,a,[role=button]') || e, r = t.getBoundingClientRect(); return r.width > 14 && r.height > 14; })());
      if (b) { opened = true; (b.closest('button,a,[role=button]') || b).click(); }
    }
    if (n > 40) { clearInterval(timer); window.__fpQ = null; }
  }, 300);
});
