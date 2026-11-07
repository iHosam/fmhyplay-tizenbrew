/**
 * FMHYPlay TizenBrew - Main TV Application Controller
 * Ports Home.java, TitleActivity.java, SearchActivity.java, CategoryActivity.java,
 * and IptvActivity.java with 2D Spatial D-Pad Navigation & Hold-OK Context Menus.
 */
window.FMHYApp = (function () {
  "use strict";

  var TABS = ["Home", "Movies", "Series", "Live TV", "Browse", "Settings"];

  var state = {
    currentTab: 0,
    screenStack: [], // Stack of sub-screens: { type, renderFn, focusRestoreEl }
    focusedEl: null,
    lastPageFocusEl: null,
    modalOpen: false,
    modalFocusEl: null,
    preModalFocusEl: null,
    okDownTime: 0,
    okHoldTimer: null,
    okHoldFired: false,
    toastTimer: null,
    catalogCache: {},
    iptvProbeAbort: null,
    tabState: {
      movie: { genre: "All", skip: 0, items: [] },
      series: { genre: "All", skip: 0, items: [] },
      browse: { cat: "all" }
    }
  };

  function el(id) {
    return document.getElementById(id);
  }

  function clearNode(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function make(tag, className, text) {
    var d = document.createElement(tag);
    if (className) d.className = className;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }

  function toast(msg, durationMs) {
    var box = el("toast-box");
    if (!box) return;
    box.textContent = msg;
    box.style.display = "block";
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      box.style.display = "none";
    }, durationMs || 2800);
  }

  // =========================================================================
  // Focusable & 2D Spatial Navigation System
  // =========================================================================

  function makeFocusable(node, onClick, onLongPress) {
    node.classList.add("focusable");
    node.tabIndex = 0;
    if (onClick) {
      node._onClick = onClick;
      node.addEventListener("click", function (e) {
        e.stopPropagation();
        onClick(node);
      });
    }
    if (onLongPress) {
      node._onLongPress = onLongPress;
      node.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        onLongPress(node);
      });
    }
    node.addEventListener("mouseenter", function () {
      setFocus(node, false);
    });
    return node;
  }

  function isConnectedNode(node) {
    if (!node) return false;
    if (typeof node.isConnected === "boolean") return node.isConnected;
    var root = el("app-root") || document.body;
    return root ? root.contains(node) : true;
  }

  function isVisible(node) {
    if (!node || !isConnectedNode(node)) return false;
    if (node.style && node.style.display === "none") return false;
    var r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function setFocus(node, scrollIntoView) {
    if (!node || !isVisible(node)) return false;

    if (state.modalOpen) {
      if (state.modalFocusEl && state.modalFocusEl !== node) {
        state.modalFocusEl.classList.remove("focused");
      }
      state.modalFocusEl = node;
      node.classList.add("focused");
      try { node.focus({ preventScroll: true }); } catch (e) {}
      if (scrollIntoView !== false) {
        try { node.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
      }
      return true;
    }

    if (state.focusedEl && state.focusedEl !== node) {
      state.focusedEl.classList.remove("focused");
    }
    state.focusedEl = node;
    node.classList.add("focused");

    var pageScroll = el("page-scroll");
    if (pageScroll && pageScroll.contains(node)) {
      state.lastPageFocusEl = node;
    }

    try { node.focus({ preventScroll: true }); } catch (e) {}

    if (scrollIntoView !== false) {
      scrollNodeIntoComfortableView(node);
    }
    return true;
  }

  function scrollNodeIntoComfortableView(node) {
    // Horizontal row scroll if inside .h-row
    var hRow = node.closest ? node.closest(".h-row") : null;
    if (hRow) {
      var nr = node.getBoundingClientRect();
      var rr = hRow.getBoundingClientRect();
      if (nr.left < rr.left + 36) {
        hRow.scrollLeft -= (rr.left + 36 - nr.left);
      } else if (nr.right > rr.right - 36) {
        hRow.scrollLeft += (nr.right - (rr.right - 36));
      }
    }

    // Vertical page scroll if inside #page-scroll
    var page = el("page-scroll");
    if (page && page.contains(node)) {
      var rect = node.getBoundingClientRect();
      var pRect = page.getBoundingClientRect();
      if (rect.top < pRect.top + 60) {
        page.scrollTop -= (pRect.top + 60 - rect.top);
      } else if (rect.bottom > pRect.bottom - 60) {
        page.scrollTop += (rect.bottom - (pRect.bottom - 60));
      }
    }
  }

  function activeFocusableCandidates() {
    if (state.modalOpen) {
      var modal = el("modal-backdrop");
      return modal ? Array.prototype.slice.call(modal.querySelectorAll(".focusable")).filter(isVisible) : [];
    }
    var root = el("app-root");
    return root ? Array.prototype.slice.call(root.querySelectorAll(".focusable")).filter(isVisible) : [];
  }

  function moveFocusSpatial(dir) {
    var current = state.modalOpen ? state.modalFocusEl : state.focusedEl;
    var candidates = activeFocusableCandidates();
    if (candidates.length === 0) return false;
    if (!current || !isVisible(current)) {
      return setFocus(candidates[0], true);
    }

    // Special handling when focused on the top Tab Bar
    var tabBar = el("tab-bar");
    if (!state.modalOpen && tabBar && tabBar.contains(current)) {
      var tabItems = Array.prototype.slice.call(tabBar.querySelectorAll(".focusable")).filter(isVisible);
      var idx = tabItems.indexOf(current);
      if (dir === "left") {
        if (idx > 0) {
          var prevTab = tabItems[idx - 1];
          setFocus(prevTab, true);
          if (prevTab.dataset.tabIdx !== undefined) selectTab(parseInt(prevTab.dataset.tabIdx, 10), true);
        }
        return true;
      }
      if (dir === "right") {
        if (idx < tabItems.length - 1) {
          var nextTab = tabItems[idx + 1];
          setFocus(nextTab, true);
          if (nextTab.dataset.tabIdx !== undefined) selectTab(parseInt(nextTab.dataset.tabIdx, 10), true);
        }
        return true;
      }
      if (dir === "down") {
        var page = el("page-scroll");
        if (state.lastPageFocusEl && isVisible(state.lastPageFocusEl) && page.contains(state.lastPageFocusEl)) {
          return setFocus(state.lastPageFocusEl, true);
        }
        var firstInPage = page ? page.querySelector(".focusable") : null;
        if (firstInPage && isVisible(firstInPage)) return setFocus(firstInPage, true);
      }
      if (dir === "up") return true;
    }

    // Special handling inside horizontal rows (.h-row) for Left / Right
    var hRow = current.closest ? current.closest(".h-row") : null;
    if (hRow && (dir === "left" || dir === "right")) {
      var rowItems = Array.prototype.slice.call(hRow.querySelectorAll(".focusable")).filter(isVisible);
      var rIdx = rowItems.indexOf(current);
      if (dir === "left" && rIdx > 0) return setFocus(rowItems[rIdx - 1], true);
      if (dir === "right" && rIdx < rowItems.length - 1) return setFocus(rowItems[rIdx + 1], true);
      if (dir === "left" || dir === "right") return true;
    }

    // General 2D geometric nearest-neighbor search
    var cr = current.getBoundingClientRect();
    var cx = cr.left + cr.width / 2;
    var cy = cr.top + cr.height / 2;

    var best = null;
    var bestScore = Infinity;

    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      if (cand === current) continue;
      var r = cand.getBoundingClientRect();
      var x = r.left + r.width / 2;
      var y = r.top + r.height / 2;
      var dx = x - cx;
      var dy = y - cy;

      if (dir === "left" && dx >= -6) continue;
      if (dir === "right" && dx <= 6) continue;
      if (dir === "up" && dy >= -6) continue;
      if (dir === "down" && dy <= 6) continue;

      var primary = (dir === "left" || dir === "right") ? Math.abs(dx) : Math.abs(dy);
      var cross = (dir === "left" || dir === "right") ? Math.abs(dy) : Math.abs(dx);

      // Weight cross-axis distance more heavily so D-pad stays in columns/rows naturally
      var score = primary + cross * 2.6;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    if (best) {
      return setFocus(best, true);
    }

    // If pressing UP near the top of the page and nothing found, focus the active tab pill
    if (!state.modalOpen && dir === "up" && tabBar) {
      var activePill = tabBar.querySelector('.tab-pill[data-tab-idx="' + state.currentTab + '"]') ||
                       tabBar.querySelector(".focusable");
      if (activePill) return setFocus(activePill, true);
    }

    return false;
  }

  // =========================================================================
  // Modal / Dialog System (List, Confirm, Input, Subtitle Style, Simkl, IPTV)
  // =========================================================================

  function closeModal() {
    var backdrop = el("modal-backdrop");
    if (!backdrop) return;
    backdrop.classList.remove("open", "top-aligned");
    clearNode(backdrop);
    state.modalOpen = false;
    state.modalFocusEl = null;
    if (state.preModalFocusEl && isVisible(state.preModalFocusEl)) {
      setFocus(state.preModalFocusEl, false);
    }
  }

  function openModalBox(topAligned) {
    state.preModalFocusEl = state.focusedEl;
    state.modalOpen = true;
    var backdrop = el("modal-backdrop");
    clearNode(backdrop);
    backdrop.classList.add("open");
    backdrop.classList.toggle("top-aligned", !!topAligned);
    var box = make("div", "modal-box");
    backdrop.appendChild(box);
    return box;
  }

  function showListModal(title, items) {
    var box = openModalBox(false);
    box.appendChild(make("div", "modal-title", title));

    var list = make("div", "modal-list");
    var firstItemEl = null;
    items.forEach(function (it) {
      var row = make("div", "modal-item", it.label);
      makeFocusable(row, function () {
        closeModal();
        if (it.action) it.action();
      });
      if (!firstItemEl) firstItemEl = row;
      list.appendChild(row);
    });
    box.appendChild(list);

    var actions = make("div", "modal-actions");
    var closeBtn = make("div", "modal-btn", "Close");
    makeFocusable(closeBtn, closeModal);
    actions.appendChild(closeBtn);
    box.appendChild(actions);

    setTimeout(function () {
      setFocus(firstItemEl || closeBtn, false);
    }, 20);
  }

  function showConfirmModal(title, message, positiveLabel, onConfirm) {
    var box = openModalBox(false);
    box.appendChild(make("div", "modal-title", title));
    if (message) box.appendChild(make("div", "modal-msg", message));

    var actions = make("div", "modal-actions");
    var cancelBtn = make("div", "modal-btn", "Cancel");
    makeFocusable(cancelBtn, closeModal);

    var okBtn = make("div", "modal-btn primary", positiveLabel || "OK");
    makeFocusable(okBtn, function () {
      closeModal();
      if (onConfirm) onConfirm();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(actions);

    setTimeout(function () { setFocus(okBtn, false); }, 20);
  }

  function showInputModal(title, fields, positiveLabel, onSubmit) {
    // fields: [{ key, placeholder, value, type }]
    var box = openModalBox(false);
    box.appendChild(make("div", "modal-title", title));

    var inputs = {};
    var firstInput = null;
    fields.forEach(function (f) {
      var inp = document.createElement("input");
      inp.type = f.type || "text";
      inp.className = "tv-input focusable";
      inp.placeholder = f.placeholder || "";
      inp.value = f.value || "";
      inp.style.marginBottom = "8px";
      makeFocusable(inp, function () { inp.focus(); });
      inputs[f.key] = inp;
      if (!firstInput) firstInput = inp;
      box.appendChild(inp);
    });

    var actions = make("div", "modal-actions");
    var cancelBtn = make("div", "modal-btn", "Cancel");
    makeFocusable(cancelBtn, closeModal);

    var okBtn = make("div", "modal-btn primary", positiveLabel || "Save");
    makeFocusable(okBtn, function () {
      var values = {};
      Object.keys(inputs).forEach(function (k) {
        values[k] = inputs[k].value.trim();
      });
      closeModal();
      if (onSubmit) onSubmit(values);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(actions);

    setTimeout(function () {
      if (firstInput) {
        setFocus(firstInput, false);
        firstInput.focus();
      }
    }, 20);
  }

  function openSubtitleStyleModal(topAligned, onChange) {
    var box = openModalBox(!!topAligned);
    box.appendChild(make("div", "modal-title", "Subtitle style"));

    function notifyChange() {
      if (onChange) onChange();
    }

    function addStepper(label, readFn, stepFn) {
      var row = make("div", "sub-stepper-row");
      row.appendChild(make("div", "setting-title", label));

      var ctrls = make("div", "sub-stepper-controls");
      var valEl = make("div", "sub-step-val", readFn());

      var minus = make("div", "sub-step-btn", "−");
      makeFocusable(minus, function () {
        stepFn(-1);
        valEl.textContent = readFn();
        notifyChange();
      });

      var plus = make("div", "sub-step-btn", "+");
      makeFocusable(plus, function () {
        stepFn(1);
        valEl.textContent = readFn();
        notifyChange();
      });

      ctrls.appendChild(minus);
      ctrls.appendChild(valEl);
      ctrls.appendChild(plus);
      row.appendChild(ctrls);
      box.appendChild(row);
      return minus;
    }

    var firstBtn = addStepper("Size", function () { return FMHYData.Subs.sizeLabel(); }, function (d) {
      FMHYData.Subs.setSize(FMHYData.Subs.size() + d);
    });

    addStepper("Position", function () { return FMHYData.Subs.offsetLabel(); }, function (d) {
      FMHYData.Subs.setOffset(FMHYData.Subs.offset() + d);
    });

    addStepper("Timing", function () { return FMHYData.Subs.delayLabel(); }, function (d) {
      FMHYData.Subs.stepDelay(d * 100);
    });

    var actions = make("div", "modal-actions");
    var resetBtn = make("div", "modal-btn", "Reset");
    makeFocusable(resetBtn, function () {
      FMHYData.Subs.setSize(1);
      FMHYData.Subs.setOffset(1);
      FMHYData.Subs.resetDelay();
      notifyChange();
      closeModal();
    });

    var doneBtn = make("div", "modal-btn primary", "Done");
    makeFocusable(doneBtn, closeModal);

    actions.appendChild(resetBtn);
    actions.appendChild(doneBtn);
    box.appendChild(actions);

    setTimeout(function () { setFocus(firstBtn || doneBtn, false); }, 20);
  }

  // =========================================================================
  // Top Navigation Bar & Screen Stack
  // =========================================================================

  function buildTabBar() {
    var bar = el("tab-bar");
    clearNode(bar);

    var brand = make("div", "brand-title", "FMHYPlay");
    bar.appendChild(brand);

    TABS.forEach(function (name, idx) {
      var pill = make("div", "tab-pill" + (idx === state.currentTab ? " active" : ""), name);
      pill.dataset.tabIdx = String(idx);
      makeFocusable(pill, function () {
        selectTab(idx, false);
      });
      bar.appendChild(pill);
    });

    var spacer = make("div", "tab-spacer");
    bar.appendChild(spacer);

    var searchBtn = make("div", "search-pill", "🔍  Search");
    makeFocusable(searchBtn, function () {
      openSearchScreen("");
    });
    bar.appendChild(searchBtn);
  }

  function updateTabBarActiveState() {
    var bar = el("tab-bar");
    if (!bar) return;
    var pills = bar.querySelectorAll(".tab-pill");
    for (var i = 0; i < pills.length; i++) {
      pills[i].classList.toggle("active", i === state.currentTab && state.screenStack.length === 0);
    }
  }

  function selectTab(idx, keepFocusOnTab) {
    state.currentTab = idx;
    state.screenStack = [];
    updateTabBarActiveState();
    renderCurrentView(keepFocusOnTab);
  }

  function pushScreen(screenObj) {
    screenObj.restoreFocus = state.focusedEl;
    state.screenStack.push(screenObj);
    updateTabBarActiveState();
    renderCurrentView(false);
  }

  function popScreen() {
    if (state.screenStack.length === 0) return false;
    var popped = state.screenStack.pop();
    updateTabBarActiveState();
    renderCurrentView(false);
    if (popped && popped.restoreFocus && isVisible(popped.restoreFocus)) {
      setFocus(popped.restoreFocus, true);
    }
    return true;
  }

  function renderCurrentView(keepFocusOnTab) {
    var container = el("page-content");
    var scrollWrap = el("page-scroll");
    if (!container || !scrollWrap) return;

    clearNode(container);
    scrollWrap.scrollTop = 0;

    if (state.screenStack.length > 0) {
      var topScreen = state.screenStack[state.screenStack.length - 1];
      topScreen.render(container);
      setTimeout(function () {
        var first = container.querySelector(".focusable");
        if (first) setFocus(first, false);
      }, 20);
      return;
    }

    if (state.currentTab === 0) buildHome(container);
    else if (state.currentTab === 1) buildCatalogPage(container, "movie");
    else if (state.currentTab === 2) buildCatalogPage(container, "series");
    else if (state.currentTab === 3) buildLiveTvPage(container);
    else if (state.currentTab === 4) buildBrowsePage(container);
    else if (state.currentTab === 5) buildSettingsPage(container);

    if (!keepFocusOnTab) {
      setTimeout(function () {
        var first = container.querySelector(".focusable");
        if (first) setFocus(first, false);
      }, 20);
    }
  }

  // =========================================================================
  // Reusable UI Card Builders (Matching Home.java)
  // =========================================================================

  function addSectionHeader(container, title) {
    var h = make("div", "section-header", title);
    container.appendChild(h);
    return h;
  }

  function addHorizontalRow(container) {
    var row = make("div", "h-row");
    container.appendChild(row);
    return row;
  }

  function createSiteCard(site) {
    var card = make("div", "site-card");
    var top = make("div", "site-card-top");

    var favBox = make("div", "site-favicon-box");
    favBox.style.background = FMHYData.colorHash(site.name);
    favBox.textContent = (site.name || "?").charAt(0).toUpperCase();

    var favUrl = site.faviconUrl();
    if (favUrl) {
      var img = document.createElement("img");
      img.src = favUrl;
      img.onerror = function () { img.style.display = "none"; };
      favBox.appendChild(img);
    }
    top.appendChild(favBox);

    var nameEl = make("div", "site-name");
    if (FMHYData.Sites.isStarred(site.id)) {
      var sMark = make("span", "star-mark", "★");
      nameEl.appendChild(sMark);
    } else if (site.star) {
      var pMark = make("span", "pick-mark", "✦");
      nameEl.appendChild(pMark);
    }
    nameEl.appendChild(document.createTextNode(site.name));
    top.appendChild(nameEl);
    card.appendChild(top);

    var subText = FMHYData.Cats.label(site.cat) + (site.tags ? " · " + site.tags : "");
    card.appendChild(make("div", "site-tags", subText));

    makeFocusable(card, function () {
      openSite(site, site.url(), "");
    }, function () {
      openSiteContextMenu(site);
    });
    return card;
  }

  function openSite(site, url, query, meta) {
    meta = meta || {};
    FMHYBrowser.open({
      url: url || (site ? site.url() : "https://fmhy.net"),
      siteName: site ? site.name : FMHYData.History.hostLabel(url),
      siteObj: site || null,
      query: query || "",
      imdb: meta.imdb || "",
      type: meta.type || "movie",
      season: meta.season || 0,
      episode: meta.episode || 0,
      title: meta.title || query || (site ? site.name : "")
    });
  }

  function openSiteContextMenu(site) {
    var starred = FMHYData.Sites.isStarred(site.id);
    var items = [{
      label: starred ? "Remove from My Sites" : "★ Add to My Sites",
      action: function () {
        var nowStarred = FMHYData.Sites.toggleStar(site.id);
        toast(nowStarred ? ("Added " + site.name + " to My Sites") : ("Removed " + site.name));
        renderCurrentView(false);
      }
    }];
    if (site.urls && site.urls.length > 1) {
      site.urls.forEach(function (u, i) {
        items.push({
          label: "Open Mirror " + (i + 1) + " · " + u.replace(/^https?:\/\//, ""),
          action: function () { openSite(site, u, ""); }
        });
      });
    }
    showListModal(site.name, items);
  }

  function createPosterCard(item) {
    var card = make("div", "poster-card");
    card.style.background = FMHYData.colorHash(item.name);

    var letter = make("div", "poster-letter", (item.name || "?").charAt(0).toUpperCase());
    card.appendChild(letter);

    var img = document.createElement("img");
    if (item.poster && item.poster.indexOf("http") === 0) {
      img.src = item.poster;
    } else {
      img.style.display = "none";
      FMHYData.Catalog.posterFor(item.name).then(function (u) {
        if (u) {
          img.src = u;
          img.style.display = "block";
        }
      });
    }
    img.onerror = function () { img.style.display = "none"; };
    card.appendChild(img);

    card.appendChild(make("div", "poster-shade"));

    var info = make("div", "poster-info");
    var saved = FMHYData.Catalog.isFavorite(item.type, item.id);
    info.appendChild(make("div", "poster-title", (saved ? "★ " : "") + item.name));

    var metaParts = [];
    if (item.year) metaParts.push(item.year);
    if (item.rating) metaParts.push("★ " + item.rating);
    if (metaParts.length > 0) {
      info.appendChild(make("div", "poster-meta", metaParts.join(" · ")));
    }
    card.appendChild(info);

    makeFocusable(card, function () {
      openTitleScreen(item.type, item.id, item.name);
    }, function () {
      var nowFav = FMHYData.Catalog.toggleFavorite(item);
      toast(nowFav ? "Saved to Home" : "Removed from Saved");
      renderCurrentView(false);
    });
    return card;
  }

  function createHistoryCard(entry) {
    var card = make("div", "history-card");
    card.style.background = FMHYData.colorHash(entry.title);

    card.appendChild(make("div", "history-letter", (entry.title || "?").charAt(0).toUpperCase()));

    var img = document.createElement("img");
    img.style.display = "none";
    card.appendChild(img);
    FMHYData.Catalog.posterFor(entry.title).then(function (u) {
      if (u) {
        img.src = u;
        img.style.display = "block";
      }
    });

    card.appendChild(make("div", "history-shade"));
    var info = make("div", "history-info");
    info.appendChild(make("div", "history-title", entry.title));
    var sub = (entry.ep ? entry.ep + " · " : "") + entry.site;
    info.appendChild(make("div", "history-sub", sub));
    card.appendChild(info);

    makeFocusable(card, function () {
      openSite(null, entry.url, "", { title: entry.title });
    }, function () {
      showConfirmModal(entry.title, "Remove from Continue Watching?", "Remove", function () {
        FMHYData.History.remove(entry.url);
        renderCurrentView(false);
      });
    });
    return card;
  }

  function createChannelCard(ch, inRow) {
    var card = make("div", "channel-tile" + (inRow ? " row-item" : ""));
    var logoBox = make("div", "channel-logo-box");
    logoBox.style.background = FMHYData.colorHash(ch.name);
    logoBox.appendChild(make("div", "ch-letter", (ch.name || "?").charAt(0).toUpperCase()));

    if (ch.logo && ch.logo.indexOf("http") === 0) {
      var img = document.createElement("img");
      img.src = ch.logo;
      img.onerror = function () { img.style.display = "none"; };
      logoBox.appendChild(img);
    }
    card.appendChild(logoBox);

    var info = make("div", "channel-info-box");
    var isFav = FMHYData.Iptv.isFavorite(ch.url);
    info.appendChild(make("div", "channel-name", (isFav ? "★ " : "") + ch.name));
    if (ch.group) {
      info.appendChild(make("div", "channel-sub", ch.group));
    }
    card.appendChild(info);

    makeFocusable(card, function () {
      FMHYPlayer.open({
        url: ch.url,
        title: ch.name,
        isIptv: true,
        useProxy: false
      });
    }, function () {
      var nowFav = FMHYData.Iptv.toggleFavorite(ch);
      toast(nowFav ? ("Added " + ch.name + " to Favorites") : "Removed from Favorites");
      renderCurrentView(false);
    });
    return card;
  }

  function createIptvTile(icon, name, sub, inRow, onClick, onLongPress) {
    var tile = make("div", "iptv-tile" + (inRow ? " row-item" : ""));
    tile.appendChild(make("div", "iptv-tile-icon", icon));
    tile.appendChild(make("div", "iptv-tile-name", name));
    if (sub) tile.appendChild(make("div", "iptv-tile-sub", sub));
    makeFocusable(tile, onClick, onLongPress);
    return tile;
  }

  // =========================================================================
  // Tab 0: Home Screen (Matches Home.buildHome)
  // =========================================================================

  function buildHome(container) {
    // 1. Continue Watching
    var hist = FMHYData.History.all();
    if (hist.length > 0) {
      addSectionHeader(container, "Continue Watching");
      var hRow = addHorizontalRow(container);
      hist.forEach(function (h) {
        hRow.appendChild(createHistoryCard(h));
      });
    }

    // 2. My Sites
    addSectionHeader(container, "My Sites");
    var sitesRow = addHorizontalRow(container);
    FMHYData.Sites.starred().forEach(function (s) {
      sitesRow.appendChild(createSiteCard(s));
    });
    var openUrlCard = make("div", "action-card", "+  Open URL");
    makeFocusable(openUrlCard, function () {
      showInputModal("Open URL or Search", [
        { key: "url", placeholder: "https://example.com or movie title" }
      ], "Open", function (vals) {
        if (!vals.url) return;
        if (/^https?:\/\//i.test(vals.url) || vals.url.indexOf(".") !== -1) {
          var target = /^https?:\/\//i.test(vals.url) ? vals.url : ("https://" + vals.url);
          openSite(null, target, "");
        } else {
          openSearchScreen(vals.url);
        }
      });
    });
    sitesRow.appendChild(openUrlCard);

    // 3. Saved Movies & Series
    var savedMedia = FMHYData.Catalog.favorites();
    if (savedMedia.length > 0) {
      addSectionHeader(container, "Saved Movies & Series");
      var savedRow = addHorizontalRow(container);
      savedMedia.forEach(function (it) {
        savedRow.appendChild(createPosterCard(it));
      });
    }

    // 4. Favorite Channels
    var favCh = FMHYData.Iptv.favorites();
    if (favCh.length > 0) {
      addSectionHeader(container, "Favorite Channels");
      var chRow = addHorizontalRow(container);
      favCh.forEach(function (ch) {
        chRow.appendChild(createChannelCard(ch, true));
      });
    }

    // 5. Trending Movies
    addSectionHeader(container, "Trending Movies");
    var movRow = addHorizontalRow(container);
    populateCatalogRow(movRow, "movie");

    // 6. Trending Series
    addSectionHeader(container, "Trending Series");
    var serRow = addHorizontalRow(container);
    populateCatalogRow(serRow, "series");

    // 7. Recommended Sites
    addSectionHeader(container, "Recommended Sites");
    var featRow = addHorizontalRow(container);
    FMHYData.Sites.featured().forEach(function (s) {
      featRow.appendChild(createSiteCard(s));
    });

    // 8. Live TV Quick Entry Tiles
    addSectionHeader(container, "Live TV");
    var tvRow = addHorizontalRow(container);
    tvRow.appendChild(createIptvTile("⭐", "Favorites", "Starred channels", true, function () {
      openIptvScreen("favorites", "", "Favorite Channels");
    }));
    tvRow.appendChild(createIptvTile("📂", "Categories", "Sports, News, Movies…", true, function () {
      openIptvScreen("categories", "", "Live TV Categories");
    }));
    tvRow.appendChild(createIptvTile("🌍", "Countries", "50+ countries", true, function () {
      openIptvScreen("countries", "", "Live TV by Country");
    }));
    tvRow.appendChild(createIptvTile("📺", "All Channels", "10,000+ free streams", true, function () {
      openIptvScreen("channels", "https://iptv-org.github.io/iptv/index.m3u", "All Channels");
    }));
    tvRow.appendChild(createIptvTile("🔍", "Search", "Find any channel", true, function () {
      openIptvScreen("search", "", "Search Live TV");
    }));
  }

  function populateCatalogRow(rowEl, type) {
    var cacheKey = type + ":trending";
    if (state.catalogCache[cacheKey]) {
      state.catalogCache[cacheKey].slice(0, 18).forEach(function (it) {
        rowEl.appendChild(createPosterCard(it));
      });
      return;
    }
    var loading = make("div", "setting-help", "Loading " + type + "…");
    loading.style.padding = "20px";
    rowEl.appendChild(loading);

    FMHYData.Catalog.trending(type).then(function (items) {
      if (!isConnectedNode(rowEl)) return;
      clearNode(rowEl);
      state.catalogCache[cacheKey] = items || [];
      (items || []).slice(0, 18).forEach(function (it) {
        rowEl.appendChild(createPosterCard(it));
      });
    });
  }

  // =========================================================================
  // Tabs 1 & 2: Movies & Series Catalog Pages
  // =========================================================================

  function buildCatalogPage(container, type) {
    var st = state.tabState[type];
    addSectionHeader(container, type === "movie" ? "Movies" : "Series");

    var genreRow = addHorizontalRow(container);
    FMHYData.Catalog.GENRES.forEach(function (g) {
      var chip = make("div", "chip" + (st.genre === g ? " active" : ""), g);
      makeFocusable(chip, function () {
        st.genre = g;
        st.skip = 0;
        st.items = [];
        renderCurrentView(false);
      });
      genreRow.appendChild(chip);
    });

    var moreChip = make("div", "chip", "Load more ›");
    makeFocusable(moreChip, function () {
      st.skip += 50;
      loadCatalogGrid(grid, type, st, true);
    });
    genreRow.appendChild(moreChip);

    var grid = make("div", "poster-grid");
    container.appendChild(grid);

    loadCatalogGrid(grid, type, st, false);
  }

  function loadCatalogGrid(grid, type, st, append) {
    if (!append && st.items && st.items.length > 0) {
      clearNode(grid);
      st.items.forEach(function (it) { grid.appendChild(createPosterCard(it)); });
      return;
    }

    var p;
    if (st.genre === "All") p = FMHYData.Catalog.trending(type, st.skip);
    else if (st.genre === "Top IMDb") p = FMHYData.Catalog.topRated(type, st.skip);
    else p = FMHYData.Catalog.byGenre(type, st.genre, st.skip);

    p.then(function (list) {
      if (!isConnectedNode(grid)) return;
      if (!append) {
        clearNode(grid);
        st.items = [];
      }
      (list || []).forEach(function (it) {
        st.items.push(it);
        grid.appendChild(createPosterCard(it));
      });
    });
  }

  // =========================================================================
  // Tab 3: Live TV Page & Fullscreen IPTV Sub-Screens
  // =========================================================================

  function buildLiveTvPage(container) {
    var favs = FMHYData.Iptv.favorites();
    if (favs.length > 0) {
      addSectionHeader(container, "Favorite Channels");
      var fRow = addHorizontalRow(container);
      favs.forEach(function (ch) { fRow.appendChild(createChannelCard(ch, true)); });
    }

    var rec = FMHYData.Iptv.recent();
    if (rec.length > 0) {
      addSectionHeader(container, "Recent Channels");
      var rRow = addHorizontalRow(container);
      rec.forEach(function (ch) { rRow.appendChild(createChannelCard(ch, true)); });
    }

    addSectionHeader(container, "Browse by Category");
    var catRow = addHorizontalRow(container);
    FMHYData.Iptv.CATEGORIES.forEach(function (c) {
      catRow.appendChild(createIptvTile(c[2], c[0], "", true, function () {
        openIptvScreen("channels", FMHYData.Iptv.categoryUrl(c[1]), c[0]);
      }));
    });

    addSectionHeader(container, "Browse by Country");
    var countryRow = addHorizontalRow(container);
    FMHYData.Iptv.COUNTRIES.forEach(function (c) {
      countryRow.appendChild(createIptvTile(c[2], c[0], c[1].toUpperCase(), true, function () {
        openIptvScreen("channels", FMHYData.Iptv.countryUrl(c[1]), c[0]);
      }));
    });

    addSectionHeader(container, "Playlists");
    var plRow = addHorizontalRow(container);
    plRow.appendChild(createIptvTile("➕", "Add M3U URL", "Custom playlist", true, openAddPlaylistModal));
    plRow.appendChild(createIptvTile("🔑", "Xtream Codes", "Server + login", true, openXtreamModal));

    FMHYData.Iptv.playlists().forEach(function (pl) {
      plRow.appendChild(createIptvTile("📋", pl.name, "Custom playlist", true, function () {
        openIptvScreen("channels", pl.url, pl.name);
      }, function () {
        showConfirmModal(pl.name, "Remove this playlist?", "Remove", function () {
          FMHYData.Iptv.removePlaylist(pl.url);
          renderCurrentView(false);
        });
      }));
    });
  }

  function openIptvScreen(mode, urlOrVal, title) {
    pushScreen({
      type: "iptv",
      render: function (container) {
        var topBar = make("div", "search-bar-wrap");
        var backBtn = make("div", "chip", "← Back");
        makeFocusable(backBtn, popScreen);
        topBar.appendChild(backBtn);

        var header = make("div", "section-header", title || "Live TV");
        header.style.margin = "0 16px";
        topBar.appendChild(header);

        var statusEl = make("div", "setting-help", "");
        topBar.appendChild(statusEl);
        container.appendChild(topBar);

        if (mode === "categories") {
          var cGrid = make("div", "iptv-grid");
          FMHYData.Iptv.CATEGORIES.forEach(function (c) {
            cGrid.appendChild(createIptvTile(c[2], c[0], "", false, function () {
              openIptvScreen("channels", FMHYData.Iptv.categoryUrl(c[1]), c[0]);
            }));
          });
          container.appendChild(cGrid);
          return;
        }

        if (mode === "countries") {
          var coGrid = make("div", "iptv-grid");
          FMHYData.Iptv.COUNTRIES.forEach(function (c) {
            coGrid.appendChild(createIptvTile(c[2], c[0], c[1].toUpperCase(), false, function () {
              openIptvScreen("channels", FMHYData.Iptv.countryUrl(c[1]), c[0]);
            }));
          });
          container.appendChild(coGrid);
          return;
        }

        // Filter / Search bar for channels
        var filterWrap = make("div", "search-bar-wrap");
        var inp = document.createElement("input");
        inp.type = "text";
        inp.className = "tv-input focusable";
        inp.placeholder = mode === "search" ? "Type channel name and press Enter…" : "Filter channels…";
        filterWrap.appendChild(inp);

        var liveToggle = make("div", "chip active", "⚡ Live Health Filter: ON");
        var useLiveFilter = true;
        filterWrap.appendChild(liveToggle);
        container.appendChild(filterWrap);

        var grid = make("div", "iptv-grid");
        container.appendChild(grid);

        var allLoaded = [];
        var abortSignal = { aborted: false };
        if (state.iptvProbeAbort) state.iptvProbeAbort.aborted = true;
        state.iptvProbeAbort = abortSignal;

        function renderChannelList(channels) {
          clearNode(grid);
          var q = inp.value.trim().toLowerCase();
          var count = 0;
          channels.forEach(function (ch) {
            if (q && ch.name.toLowerCase().indexOf(q) === -1 && (ch.group || "").toLowerCase().indexOf(q) === -1) {
              return;
            }
            if (count < 240) {
              grid.appendChild(createChannelCard(ch, false));
              count++;
            }
          });
          statusEl.textContent = count + " channels shown";
        }

        function loadAndDisplay() {
          clearNode(grid);
          statusEl.textContent = "Loading channels…";
          var srcPromise;
          if (mode === "favorites") {
            srcPromise = Promise.resolve(FMHYData.Iptv.favorites());
          } else if (mode === "recent") {
            srcPromise = Promise.resolve(FMHYData.Iptv.recent());
          } else if (mode === "search") {
            var sq = inp.value.trim();
            if (!sq) {
              statusEl.textContent = "Enter a channel name above";
              return;
            }
            srcPromise = FMHYData.Iptv.search(sq);
          } else {
            srcPromise = FMHYData.Iptv.fetchPlaylist(urlOrVal, false);
          }

          srcPromise.then(function (list) {
            if (!isConnectedNode(grid)) return;
            allLoaded = list || [];
            if (!useLiveFilter || mode === "favorites" || mode === "recent") {
              renderChannelList(allLoaded);
              return;
            }
            // Probe live streams in batches and append as they respond
            clearNode(grid);
            var liveList = [];
            statusEl.textContent = "Probing " + Math.min(allLoaded.length, 160) + " streams…";
            FMHYData.Iptv.filterLive(allLoaded.slice(0, 160), function (liveBatch, checked, total) {
              if (!isConnectedNode(grid) || abortSignal.aborted) return;
              liveBatch.forEach(function (ch) {
                liveList.push(ch);
                var q = inp.value.trim().toLowerCase();
                if (!q || ch.name.toLowerCase().indexOf(q) !== -1) {
                  grid.appendChild(createChannelCard(ch, false));
                }
              });
              statusEl.textContent = liveList.length + " live (" + checked + "/" + total + " checked)";
            }, abortSignal).then(function () {
              if (!isConnectedNode(grid) || abortSignal.aborted) return;
              allLoaded = liveList;
              statusEl.textContent = liveList.length + " live channels ready";
            });
          });
        }

        makeFocusable(inp, function () { inp.focus(); });
        inp.addEventListener("input", function () {
          if (mode !== "search") renderChannelList(allLoaded);
        });
        inp.addEventListener("keydown", function (e) {
          if (e.keyCode === 13 || e.key === "Enter") {
            if (mode === "search") loadAndDisplay();
            else renderChannelList(allLoaded);
          }
        });

        makeFocusable(liveToggle, function () {
          useLiveFilter = !useLiveFilter;
          liveToggle.classList.toggle("active", useLiveFilter);
          liveToggle.textContent = useLiveFilter ? "⚡ Live Health Filter: ON" : "⚡ Live Health Filter: OFF";
          loadAndDisplay();
        });

        loadAndDisplay();
      }
    });
  }

  function openAddPlaylistModal() {
    showInputModal("Add M3U Playlist", [
      { key: "name", placeholder: "Playlist name (optional)" },
      { key: "url", placeholder: "https://example.com/playlist.m3u" }
    ], "Add", function (vals) {
      if (!vals.url) return;
      FMHYData.Iptv.addPlaylist(vals.name, vals.url);
      toast("Added playlist");
      renderCurrentView(false);
    });
  }

  function openXtreamModal() {
    showInputModal("Add Xtream Codes Login", [
      { key: "name", placeholder: "Label (e.g. My Provider)" },
      { key: "server", placeholder: "http://server.example.com:8080" },
      { key: "user", placeholder: "Username" },
      { key: "pass", placeholder: "Password", type: "password" }
    ], "Add", function (vals) {
      if (!vals.server || !vals.user || !vals.pass) return;
      FMHYData.Iptv.addXtream(vals.name, vals.server, vals.user, vals.pass);
      toast("Added Xtream Codes playlist");
      renderCurrentView(false);
    });
  }

  // =========================================================================
  // Tab 4: Browse All FMHY Sites Page
  // =========================================================================

  function buildBrowsePage(container) {
    var st = state.tabState.browse;
    addSectionHeader(container, "Browse Sites (" + FMHYData.Sites.all().length + ")");

    var chipRow = addHorizontalRow(container);
    var cats = [
      { id: "all", label: "All (" + FMHYData.Sites.all().length + ")" },
      { id: "starred", label: "★ My Sites (" + FMHYData.Sites.starred().length + ")" }
    ];
    FMHYData.Cats.ORDER.forEach(function (c) {
      cats.push({
        id: c,
        label: FMHYData.Cats.label(c) + " (" + FMHYData.Sites.byCategory(c).length + ")"
      });
    });

    cats.forEach(function (c) {
      var chip = make("div", "chip" + (st.cat === c.id ? " active" : ""), c.label);
      makeFocusable(chip, function () {
        st.cat = c.id;
        renderCurrentView(false);
      });
      chipRow.appendChild(chip);
    });

    var sites;
    if (st.cat === "all") sites = FMHYData.Sites.all();
    else if (st.cat === "starred") sites = FMHYData.Sites.starred();
    else sites = FMHYData.Sites.byCategory(st.cat);

    var grid = make("div", "site-grid");
    sites.forEach(function (s) {
      grid.appendChild(createSiteCard(s));
    });
    container.appendChild(grid);
  }

  // =========================================================================
  // Tab 5: Settings Page (Matches Home.buildSettings)
  // =========================================================================

  function buildSettingsPage(container) {
    addSectionHeader(container, "Playback & Browsing");

    addToggleSetting(container, "Ad blocker",
      "Block ads, popups, and trackers inside streaming sites", "adblock", true);
    addToggleSetting(container, "Auto-open in native player",
      "Hand off to hardware HLS/DASH player as soon as a stream is sniffed", "native", true);

    addActionSetting(container, "Subtitle language",
      "Preferred language when auto-fetching from OpenSubtitles",
      FMHYData.Subs.languageName(FMHYData.Subs.preferredLang()),
      function () {
        var items = FMHYData.Subs.LANGS.map(function (pair) {
          return {
            label: pair[1] + (pair[0] === FMHYData.Subs.preferredLang() ? "  ✓" : ""),
            action: function () {
              FMHYData.Subs.setPreferredLang(pair[0]);
              renderCurrentView(false);
            }
          };
        });
        showListModal("Subtitle language", items);
      });

    addActionSetting(container, "Subtitle appearance & timing",
      "Text size, vertical position, and sync offset",
      FMHYData.Subs.sizeLabel() + " · " + FMHYData.Subs.offsetLabel(),
      function () {
        openSubtitleStyleModal(false, function () { renderCurrentView(false); });
      });

    addSectionHeader(container, "Accounts & Lists");

    addActionSetting(container, "Simkl sync",
      "Auto-scrobble movies, series, and anime you watch",
      FMHYData.Simkl.isConnected() ? "Connected" : "Not connected",
      openSimklDialog);

    addActionSetting(container, "Add IPTV playlist (M3U URL)",
      "Import your own .m3u / .m3u8 channel list", "Add ›", openAddPlaylistModal);

    addActionSetting(container, "Add Xtream Codes login",
      "Connect an IPTV provider with server + username + password", "Add ›", openXtreamModal);

    addSectionHeader(container, "Data");

    addActionSetting(container, "Clear watch history",
      "Remove all Continue Watching items from Home", "Clear", function () {
        showConfirmModal("Clear watch history?",
          "This removes all Continue Watching items from the Home tab.", "Clear", function () {
            FMHYData.History.clear();
            toast("History cleared");
            renderCurrentView(false);
          });
      });

    var ver = FMHYData.Sites.remoteVersion();
    var ageMin = Math.floor((Date.now() - FMHYData.Sites.lastCheck()) / 60000);
    var statusVal = ver ? ("v" + ver + " · " + (ageMin < 1 ? "just now" : ageMin + "m ago")) : "Built-in list";

    addActionSetting(container, "Update site list now",
      "Pull latest sites from github.com/fmhyplay/sources (" + FMHYData.Sites.all().length + " sites loaded)",
      statusVal, function () {
        toast("Checking for updates…");
        Promise.all([FMHYData.Sites.refresh(), FMHYData.Iptv.refresh()]).then(function () {
          toast("Site & IPTV lists updated (" + FMHYData.Sites.all().length + " sites)");
          renderCurrentView(false);
        });
      });
  }

  function addToggleSetting(container, title, help, key, defVal) {
    var row = make("div", "setting-row");
    var left = make("div", "setting-left");
    left.appendChild(make("div", "setting-title", title));
    left.appendChild(make("div", "setting-help", help));
    row.appendChild(left);

    var val = FMHYData.Store.getBool(key, defVal);
    var right = make("div", "setting-val", val ? "ON" : "OFF");
    right.style.color = val ? "var(--accent)" : "var(--muted)";
    row.appendChild(right);

    makeFocusable(row, function () {
      var next = !FMHYData.Store.getBool(key, defVal);
      FMHYData.Store.setBool(key, next);
      right.textContent = next ? "ON" : "OFF";
      right.style.color = next ? "var(--accent)" : "var(--muted)";
    });
    container.appendChild(row);
  }

  function addActionSetting(container, title, help, valText, onClick) {
    var row = make("div", "setting-row");
    var left = make("div", "setting-left");
    left.appendChild(make("div", "setting-title", title));
    left.appendChild(make("div", "setting-help", help));
    row.appendChild(left);

    var right = make("div", "setting-val", valText);
    right.style.color = "var(--accent)";
    row.appendChild(right);

    makeFocusable(row, onClick);
    container.appendChild(row);
  }

  function openSimklDialog() {
    if (FMHYData.Simkl.isConnected()) {
      showConfirmModal("Simkl connected",
        "Watch progress is syncing automatically to your Simkl account.",
        "Disconnect", function () {
          FMHYData.Simkl.disconnect();
          toast("Simkl disconnected");
          renderCurrentView(false);
        });
      return;
    }

    toast("Requesting Simkl PIN…");
    FMHYData.Simkl.startAuth().then(function (pin) {
      if (!pin || !pin.user_code) {
        toast("Couldn't reach Simkl");
        return;
      }
      var stopPoll = { stopped: false };
      var box = openModalBox(false);
      box.appendChild(make("div", "modal-title", "Connect Simkl"));
      box.appendChild(make("div", "modal-msg",
        "1. On your phone or PC, open:\n     " + pin.verification_url +
        "\n\n2. Enter this code:\n     " + pin.user_code +
        "\n\nWaiting for confirmation…"));

      var actions = make("div", "modal-actions");
      var cancelBtn = make("div", "modal-btn", "Cancel");
      makeFocusable(cancelBtn, function () {
        stopPoll.stopped = true;
        closeModal();
      });
      actions.appendChild(cancelBtn);
      box.appendChild(actions);
      setTimeout(function () { setFocus(cancelBtn, false); }, 20);

      var pollTimer = setInterval(function () {
        if (stopPoll.stopped || !state.modalOpen) {
          clearInterval(pollTimer);
          return;
        }
        FMHYData.Simkl.pollCode(pin.user_code).then(function (res) {
          if (res === "ok") {
            clearInterval(pollTimer);
            closeModal();
            toast("Simkl connected!");
            renderCurrentView(false);
          }
        });
      }, 5000);
    });
  }

  // =========================================================================
  // Title Detail Screen (Ports TitleActivity.java)
  // =========================================================================

  function openTitleScreen(type, imdbId, fallbackName) {
    pushScreen({
      type: "title",
      render: function (container) {
        var backRow = make("div", "search-bar-wrap");
        var backBtn = make("div", "chip", "← Back");
        makeFocusable(backBtn, popScreen);
        backRow.appendChild(backBtn);
        container.appendChild(backRow);

        var loading = make("div", "setting-help", "Loading " + (fallbackName || imdbId) + "…");
        container.appendChild(loading);

        FMHYData.Catalog.get(type, imdbId).then(function (detail) {
          if (!isConnectedNode(container)) return;
          clearNode(container);
          container.appendChild(backRow);

          if (!detail) {
            container.appendChild(make("div", "setting-title", "Couldn't load details for " + (fallbackName || imdbId)));
            return;
          }

          var hero = make("div", "title-hero");
          var posterBox = make("div", "title-hero-poster");
          posterBox.style.background = FMHYData.colorHash(detail.name);
          if (detail.poster) {
            var pImg = document.createElement("img");
            pImg.src = detail.poster;
            posterBox.appendChild(pImg);
          }
          hero.appendChild(posterBox);

          var info = make("div", "title-hero-info");
          info.appendChild(make("div", "title-hero-name", detail.name));

          var metaBits = [];
          if (detail.year) metaBits.push(detail.year);
          if (detail.rating) metaBits.push("★ " + detail.rating);
          if (detail.runtime) metaBits.push(detail.runtime);
          if (metaBits.length > 0) info.appendChild(make("div", "title-hero-meta", metaBits.join("  ·  ")));
          if (detail.genres && detail.genres.length > 0) {
            info.appendChild(make("div", "title-hero-genres", detail.genres.slice(0, 5).join(" · ")));
          }
          if (detail.overview) {
            info.appendChild(make("div", "title-hero-overview", detail.overview));
          }
          hero.appendChild(info);
          container.appendChild(hero);

          // Action Row: Play on Multi-Embed, Top Starred Sites, Save, Pick Site
          addSectionHeader(container, type === "movie" ? "Watch Movie" : "Watch Series");
          var actRow = addHorizontalRow(container);

          // 1. Instant Embed Player (VidSrc / VidLink / SuperEmbed)
          var embeds = FMHYData.Sites.embedUrlsForTitle(type, detail.id, 1, 1);
          if (embeds.length > 0) {
            var embedChip = make("div", "chip active", "▶  Instant Embed (" + embeds[0].label + ")");
            makeFocusable(embedChip, function () {
              openSite(null, embeds[0].url, detail.name, {
                imdb: detail.id,
                type: type,
                season: type === "series" ? 1 : 0,
                episode: type === "series" ? 1 : 0,
                title: detail.name
              });
            });
            actRow.appendChild(embedChip);
          }

          // 2. Top 3 Starred Sites (matches TitleActivity.topPlaySites)
          var catKey = type === "series" ? "streaming" : "streaming";
          var topSites = FMHYData.Sites.starred().slice(0, 3);
          if (topSites.length === 0) topSites = FMHYData.Sites.byCategory(catKey).slice(0, 3);
          topSites.forEach(function (s, idx) {
            var playChip = make("div", "chip" + (idx === 0 && embeds.length === 0 ? " active" : ""), "▶  " + s.name);
            makeFocusable(playChip, function () {
              var dl = FMHYData.Sites.deeplink(s.url(), detail.name);
              openSite(s, dl, detail.name, {
                imdb: detail.id,
                type: type,
                season: type === "series" ? 1 : 0,
                episode: type === "series" ? 1 : 0,
                title: detail.name
              });
            });
            actRow.appendChild(playChip);
          });

          // 3. Save / Favorite Chip
          var itemSummary = {
            id: detail.id,
            type: type,
            name: detail.name,
            poster: detail.poster,
            year: detail.year,
            rating: detail.rating
          };
          var saveChip = make("div", "chip", FMHYData.Catalog.isFavorite(type, detail.id) ? "★  Saved" : "☆  Save");
          makeFocusable(saveChip, function () {
            var on = FMHYData.Catalog.toggleFavorite(itemSummary);
            saveChip.textContent = on ? "★  Saved" : "☆  Save";
            toast(on ? "Saved to Home" : "Removed from Saved");
          });
          actRow.appendChild(saveChip);

          // 4. Pick any site modal
          var pickChip = make("div", "chip", "Pick site…");
          makeFocusable(pickChip, function () {
            openSitePickerForQuery(detail.name, {
              imdb: detail.id,
              type: type,
              season: type === "series" ? 1 : 0,
              episode: type === "series" ? 1 : 0,
              title: detail.name
            });
          });
          actRow.appendChild(pickChip);

          // Series Seasons & Episodes
          var seasons = Object.keys(detail.seasons || {}).map(Number).sort(function (a, b) { return a - b; });
          if (seasons.length > 0) {
            addSectionHeader(container, "Episodes");
            var seasonRow = addHorizontalRow(container);
            var epBox = make("div", "");
            var activeSeason = seasons[0];

            function renderSeason(sNum) {
              activeSeason = sNum;
              clearNode(seasonRow);
              seasons.forEach(function (sn) {
                var sChip = make("div", "chip" + (sn === activeSeason ? " active" : ""), "Season " + sn);
                makeFocusable(sChip, function () { renderSeason(sn); });
                seasonRow.appendChild(sChip);
              });

              clearNode(epBox);
              var eps = detail.seasons[sNum] || [];
              eps.forEach(function (ep) {
                var eRow = make("div", "episode-row");
                var thumb = make("div", "episode-thumb");
                thumb.style.background = FMHYData.colorHash(detail.name + ep.episode);
                if (ep.thumb || detail.backdrop || detail.poster) {
                  var eImg = document.createElement("img");
                  eImg.src = ep.thumb || detail.backdrop || detail.poster;
                  thumb.appendChild(eImg);
                }
                eRow.appendChild(thumb);

                var eInfo = make("div", "episode-info");
                var epTitle = "S" + ep.season + " E" + ep.episode + "  ·  " + ep.name + (ep.released ? "  (" + ep.released + ")" : "");
                eInfo.appendChild(make("div", "episode-title", epTitle));
                if (ep.overview) eInfo.appendChild(make("div", "episode-desc", ep.overview));
                eRow.appendChild(eInfo);

                var epQuery = detail.name + " S" + (ep.season < 10 ? "0" + ep.season : ep.season) + "E" + (ep.episode < 10 ? "0" + ep.episode : ep.episode);
                var epMeta = {
                  imdb: detail.id,
                  type: "series",
                  season: ep.season,
                  episode: ep.episode,
                  title: detail.name + " S" + ep.season + "E" + ep.episode
                };

                makeFocusable(eRow, function () {
                  var epEmbeds = FMHYData.Sites.embedUrlsForTitle("series", detail.id, ep.season, ep.episode);
                  if (epEmbeds.length > 0) {
                    openSite(null, epEmbeds[0].url, detail.name, epMeta);
                  } else if (topSites[0]) {
                    openSite(topSites[0], FMHYData.Sites.deeplink(topSites[0].url(), detail.name), detail.name, epMeta);
                  }
                }, function () {
                  openSitePickerForQuery(epQuery, epMeta);
                });
                epBox.appendChild(eRow);
              });
            }

            container.appendChild(epBox);
            renderSeason(activeSeason);
          }

          setTimeout(function () {
            var firstAct = actRow.querySelector(".focusable");
            if (firstAct) setFocus(firstAct, false);
          }, 30);
        });
      }
    });
  }

  function openSitePickerForQuery(query, meta) {
    meta = meta || {};
    var items = [];
    if (meta.imdb) {
      var embeds = FMHYData.Sites.embedUrlsForTitle(meta.type || "movie", meta.imdb, meta.season || 1, meta.episode || 1);
      embeds.forEach(function (em) {
        items.push({
          label: "🎬 " + em.label + " (Multi-Server Embed)",
          action: function () { openSite(null, em.url, query, meta); }
        });
      });
    }
    var starred = FMHYData.Sites.starred();
    var rest = FMHYData.Sites.all().filter(function (s) { return !FMHYData.Sites.isStarred(s.id); });
    starred.concat(rest).forEach(function (s) {
      var prefix = FMHYData.Sites.isStarred(s.id) ? "★ " : (s.star ? "✦ " : "");
      items.push({
        label: prefix + s.name + "  ·  " + FMHYData.Cats.label(s.cat),
        action: function () {
          openSite(s, FMHYData.Sites.deeplink(s.url(), query), query, meta);
        }
      });
    });
    showListModal("Play \"" + query + "\" on…", items);
  }

  // =========================================================================
  // Global Search Screen (Ports SearchActivity.java)
  // =========================================================================

  function openSearchScreen(initialQuery) {
    pushScreen({
      type: "search",
      render: function (container) {
        var bar = make("div", "search-bar-wrap");
        var backBtn = make("div", "chip", "← Back");
        makeFocusable(backBtn, popScreen);
        bar.appendChild(backBtn);

        var inp = document.createElement("input");
        inp.type = "text";
        inp.className = "tv-input focusable";
        inp.placeholder = "Search movies, series, anime, live TV, or paste a URL…";
        inp.value = initialQuery || "";
        bar.appendChild(inp);

        var goBtn = make("div", "chip active", "Search");
        bar.appendChild(goBtn);
        container.appendChild(bar);

        var resultsBox = make("div", "");
        container.appendChild(resultsBox);

        function runSearch() {
          var q = inp.value.trim();
          clearNode(resultsBox);
          if (!q) return;

          // Quick action to search on any FMHY site or open direct URL
          var quickRow = addHorizontalRow(resultsBox);
          if (/^https?:\/\//i.test(q) || (q.indexOf(".") !== -1 && q.indexOf(" ") === -1)) {
            var directUrl = /^https?:\/\//i.test(q) ? q : ("https://" + q);
            var openBtn = make("div", "chip active", "🌐 Open URL: " + directUrl);
            makeFocusable(openBtn, function () { openSite(null, directUrl, ""); });
            quickRow.appendChild(openBtn);
          }

          var pickSiteBtn = make("div", "chip", "🔎 Search \"" + q + "\" on an FMHY site…");
          makeFocusable(pickSiteBtn, function () {
            openSitePickerForQuery(q, { title: q });
          });
          quickRow.appendChild(pickSiteBtn);

          // 1. Matching FMHY Sites
          var siteMatches = FMHYData.Sites.search(q);
          if (siteMatches.length > 0) {
            addSectionHeader(resultsBox, "Matching Sites (" + siteMatches.length + ")");
            var sRow = addHorizontalRow(resultsBox);
            siteMatches.slice(0, 15).forEach(function (s) {
              sRow.appendChild(createSiteCard(s));
            });
          }

          // 2. Movies from Cinemeta
          addSectionHeader(resultsBox, "Movies");
          var mRow = addHorizontalRow(resultsBox);
          FMHYData.Catalog.list("movie", "search=" + encodeURIComponent(q)).then(function (list) {
            if (!isConnectedNode(mRow)) return;
            if (!list || list.length === 0) {
              mRow.appendChild(make("div", "setting-help", "No movies found"));
              return;
            }
            list.slice(0, 15).forEach(function (it) { mRow.appendChild(createPosterCard(it)); });
          });

          // 3. Series from Cinemeta
          addSectionHeader(resultsBox, "Series & Anime");
          var serRow = addHorizontalRow(resultsBox);
          FMHYData.Catalog.list("series", "search=" + encodeURIComponent(q)).then(function (list) {
            if (!isConnectedNode(serRow)) return;
            if (!list || list.length === 0) {
              serRow.appendChild(make("div", "setting-help", "No series found"));
              return;
            }
            list.slice(0, 15).forEach(function (it) { serRow.appendChild(createPosterCard(it)); });
          });

          // 4. Live TV Channels
          addSectionHeader(resultsBox, "Live TV Channels");
          var chRow = addHorizontalRow(resultsBox);
          FMHYData.Iptv.search(q).then(function (chs) {
            if (!isConnectedNode(chRow)) return;
            if (!chs || chs.length === 0) {
              chRow.appendChild(make("div", "setting-help", "No channels found"));
              return;
            }
            chs.slice(0, 18).forEach(function (c) { chRow.appendChild(createChannelCard(c, true)); });
          });
        }

        makeFocusable(inp, function () { inp.focus(); });
        makeFocusable(goBtn, runSearch);
        inp.addEventListener("keydown", function (e) {
          if (e.keyCode === 13 || e.key === "Enter") {
            e.preventDefault();
            runSearch();
          }
        });

        if (initialQuery) {
          runSearch();
        } else {
          setTimeout(function () {
            setFocus(inp, false);
            inp.focus();
          }, 30);
        }
      }
    });
  }

  // =========================================================================
  // Global Remote Control & Keyboard Dispatcher (Tizen TV Remote + PC Keys)
  // =========================================================================

  function registerTizenRemoteKeys() {
    if (typeof window.tizen !== "undefined" && window.tizen.tvinputdevice) {
      var keys = [
        "MediaPlay", "MediaPause", "MediaPlayPause", "MediaStop",
        "MediaFastForward", "MediaRewind", "MediaTrackPrevious", "MediaTrackNext",
        "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
        "Info", "Caption", "Search", "ChannelUp", "ChannelDown"
      ];
      keys.forEach(function (k) {
        try { window.tizen.tvinputdevice.registerKey(k); } catch (e) {}
      });
    }
  }

  function initGlobalKeyListeners() {
    window.addEventListener("keydown", function (e) {
      var k = e.keyCode;
      var key = e.key;

      // 1. If a Modal is open, route keys to modal first
      if (state.modalOpen) {
        if (k === 10009 || k === 27 || key === "Escape") {
          e.preventDefault();
          closeModal();
          return;
        }
        var activeTag = document.activeElement ? document.activeElement.tagName : "";
        if (activeTag === "INPUT" && (k === 8 || key === "Backspace" || k === 37 || k === 39)) {
          return; // allow normal text editing inside modal input
        }
        if (k === 10009 || k === 8 || key === "Backspace") {
          e.preventDefault();
          closeModal();
          return;
        }
        if (k === 37 || key === "ArrowLeft") { e.preventDefault(); moveFocusSpatial("left"); return; }
        if (k === 39 || key === "ArrowRight") { e.preventDefault(); moveFocusSpatial("right"); return; }
        if (k === 38 || key === "ArrowUp") { e.preventDefault(); moveFocusSpatial("up"); return; }
        if (k === 40 || key === "ArrowDown") { e.preventDefault(); moveFocusSpatial("down"); return; }
        if (k === 13 || key === "Enter") {
          if (activeTag !== "INPUT") {
            e.preventDefault();
            if (state.modalFocusEl && state.modalFocusEl._onClick) {
              state.modalFocusEl._onClick(state.modalFocusEl);
            }
          }
          return;
        }
        return;
      }

      // 2. If Native Video Player is open, route keys to FMHYPlayer
      if (window.FMHYPlayer && window.FMHYPlayer.isOpen()) {
        if (window.FMHYPlayer.handleKeyDown(e)) return;
      }

      // 3. If Site Browser is open, route keys to FMHYBrowser
      if (window.FMHYBrowser && window.FMHYBrowser.isOpen()) {
        if (window.FMHYBrowser.handleKeyDown(e)) return;
      }

      // 4. If user is typing inside a search/filter <input>
      var focusedInput = (document.activeElement && document.activeElement.tagName === "INPUT") ? document.activeElement : null;
      if (focusedInput) {
        if (k === 40 || key === "ArrowDown") {
          e.preventDefault();
          focusedInput.blur();
          moveFocusSpatial("down");
          return;
        }
        if (k === 38 || key === "ArrowUp") {
          e.preventDefault();
          focusedInput.blur();
          moveFocusSpatial("up");
          return;
        }
        if (k === 10009 || k === 27 || key === "Escape") {
          e.preventDefault();
          focusedInput.blur();
          popScreen();
          return;
        }
        return;
      }

      // 5. Color Shortcut Buttons on Samsung TV Remote
      if (k === 403) { // Red: Search
        e.preventDefault();
        openSearchScreen("");
        return;
      }
      if (k === 405) { // Yellow: Context menu / Long-press action on focused card
        e.preventDefault();
        if (state.focusedEl && state.focusedEl._onLongPress) {
          state.focusedEl._onLongPress(state.focusedEl);
        }
        return;
      }
      if (k === 406) { // Blue: Live TV tab
        e.preventDefault();
        selectTab(3, false);
        return;
      }

      // 6. Back / Return Key
      if (k === 10009 || k === 27 || k === 8 || key === "Escape" || key === "Backspace") {
        e.preventDefault();
        if (popScreen()) return;

        var tabBar = el("tab-bar");
        if (tabBar && state.focusedEl && !tabBar.contains(state.focusedEl)) {
          var activePill = tabBar.querySelector('.tab-pill[data-tab-idx="' + state.currentTab + '"]');
          if (activePill) {
            setFocus(activePill, true);
            return;
          }
        }
        if (state.currentTab !== 0) {
          selectTab(0, true);
          var homePill = tabBar ? tabBar.querySelector('.tab-pill[data-tab-idx="0"]') : null;
          if (homePill) setFocus(homePill, true);
          return;
        }
        // On Home tab pill: confirm exit on Tizen TV
        showConfirmModal("Exit FMHYPlay?", "Return to TizenBrew / TV Home?", "Exit", function () {
          try {
            if (window.tizen && window.tizen.application) {
              window.tizen.application.getCurrentApplication().exit();
            } else {
              window.history.back();
            }
          } catch (err) {}
        });
        return;
      }

      // 7. Directional D-Pad Navigation
      if (k === 37 || key === "ArrowLeft") { e.preventDefault(); moveFocusSpatial("left"); return; }
      if (k === 39 || key === "ArrowRight") { e.preventDefault(); moveFocusSpatial("right"); return; }
      if (k === 38 || key === "ArrowUp") { e.preventDefault(); moveFocusSpatial("up"); return; }
      if (k === 40 || key === "ArrowDown") { e.preventDefault(); moveFocusSpatial("down"); return; }

      // 8. OK / Enter with Hold-OK Long-Press Detection (500ms)
      if (k === 13 || key === "Enter") {
        e.preventDefault();
        if (e.repeat) return;
        state.okDownTime = Date.now();
        state.okHoldFired = false;
        if (state.okHoldTimer) clearTimeout(state.okHoldTimer);
        state.okHoldTimer = setTimeout(function () {
          state.okHoldFired = true;
          if (state.focusedEl && state.focusedEl._onLongPress) {
            state.focusedEl._onLongPress(state.focusedEl);
          }
        }, 520);
      }
    });

    window.addEventListener("keyup", function (e) {
      var k = e.keyCode;
      var key = e.key;
      if (k === 13 || key === "Enter") {
        if (state.okHoldTimer) {
          clearTimeout(state.okHoldTimer);
          state.okHoldTimer = null;
        }
        if (!state.okHoldFired && !state.modalOpen &&
            (!window.FMHYPlayer || !window.FMHYPlayer.isOpen()) &&
            (!window.FMHYBrowser || !window.FMHYBrowser.isOpen())) {
          if (state.focusedEl && state.focusedEl._onClick) {
            state.focusedEl._onClick(state.focusedEl);
          }
        }
        state.okHoldFired = false;
      }
    });
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  function init() {
    if (state.initialized) return;
    state.initialized = true;

    registerTizenRemoteKeys();
    FMHYPlayer.init();
    FMHYBrowser.init();
    initGlobalKeyListeners();

    // Render UI immediately so the TV screen is never blank while service/network initializes
    buildTabBar();
    renderCurrentView(false);
    var bar = el("tab-bar");
    var homePill = bar ? bar.querySelector('.tab-pill[data-tab-idx="0"]') : null;
    if (homePill) setFocus(homePill, false);

    FMHYData.init().then(function () {
      if (state.currentTab === 0 && state.screenStack.length === 0 && !FMHYBrowser.isOpen() && !FMHYPlayer.isOpen()) {
        renderCurrentView(true);
      }
    });
  }

  return {
    init: init,
    toast: toast,
    showListModal: showListModal,
    showConfirmModal: showConfirmModal,
    showInputModal: showInputModal,
    openSubtitleStyleModal: openSubtitleStyleModal,
    onBrowserClosed: function () {
      if (state.currentTab === 0 && state.screenStack.length === 0) {
        renderCurrentView(false);
      }
    },
    onPlayerClosed: function () {
      if (!FMHYBrowser.isOpen() && state.currentTab === 0 && state.screenStack.length === 0) {
        renderCurrentView(false);
      }
    }
  };
})();

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", function () {
    window.FMHYApp.init();
  });
} else {
  window.FMHYApp.init();
}
