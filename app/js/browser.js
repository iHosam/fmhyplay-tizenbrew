/**
 * FMHYPlay TizenBrew - Site Browser, Stream Sniffer & Virtual TV Pointer
 * Ports WebActivity.java, Sniffer.java, and Pointer.java to Samsung Tizen TV
 */
window.FMHYBrowser = (function () {
  "use strict";

  var state = {
    open: false,
    url: "",
    rawUrl: "",
    siteName: "",
    query: "",
    imdb: "",
    type: "movie",
    season: 0,
    episode: 0,
    title: "",
    useProxy: true,
    pointerMode: false,
    pointerX: 960,
    pointerY: 540,
    pointerStep: 0,
    lastMoveTime: 0,
    topbarFocusedIdx: -1,
    pollTimer: null,
    autoLaunchedStream: "",
    streams: [],     // [{ url, referer, origin, ua, time }]
    subs: [],        // [{ url, lang }]
    servers: [],     // [{ id, label, on }]
    qualities: [],   // [{ id, label, on }]
    embedOptions: [] // [{ label, url, direct }]
  };

  function el(id) {
    return document.getElementById(id);
  }

  function topbarButtons() {
    var bar = el("browser-topbar");
    if (!bar) return [];
    return Array.prototype.slice.call(bar.querySelectorAll(".browser-btn"));
  }

  function setTopbarFocus(idx) {
    var btns = topbarButtons();
    btns.forEach(function (b) { b.classList.remove("focused"); });
    if (idx < 0 || idx >= btns.length) {
      state.topbarFocusedIdx = -1;
      return;
    }
    state.topbarFocusedIdx = idx;
    btns[idx].classList.add("focused");
  }

  function setPointerMode(enabled) {
    state.pointerMode = !!enabled;
    var dot = el("virtual-pointer");
    var btn = el("browser-pointer-btn");
    if (dot) {
      dot.style.display = (state.open && state.pointerMode) ? "block" : "none";
      dot.style.left = state.pointerX + "px";
      dot.style.top = state.pointerY + "px";
    }
    if (btn) {
      btn.textContent = state.pointerMode ? "🖱 Pointer: ON (Green)" : "🖱 Pointer: OFF (Green)";
      btn.classList.toggle("accent", state.pointerMode);
    }
  }

  function updatePlayButtonUi() {
    var btn = el("browser-play-btn");
    if (!btn) return;
    if (state.streams.length > 0) {
      btn.style.display = "inline-flex";
      btn.textContent = "▶ Native Player (" + state.streams.length + ")";
      btn.classList.add("accent");
    } else {
      btn.style.display = "inline-flex";
      btn.textContent = "▶ Sniffing Stream…";
      btn.classList.remove("accent");
    }
  }

  function clearSnifferData() {
    state.streams = [];
    state.subs = [];
    state.servers = [];
    state.qualities = [];
    state.autoLaunchedStream = "";
    updatePlayButtonUi();
    fetch(FMHYData.SERVICE_URL + "/api/sniffer/clear", { method: "POST" }).catch(function () {});
  }

  function loadUrlIntoFrame(rawUrl, useProxy) {
    state.rawUrl = rawUrl;
    state.useProxy = useProxy !== false;
    var badge = el("browser-url-badge");
    if (badge) badge.textContent = rawUrl;

    var modeBtn = el("browser-mode-btn");
    if (modeBtn) {
      modeBtn.textContent = state.useProxy ? "🛡 Proxy: ON" : "🌐 Direct Frame";
    }

    var iframe = el("browser-iframe");
    if (!iframe) return;

    if (state.useProxy) {
      iframe.src = FMHYData.proxyPageUrl(rawUrl, state.query);
    } else {
      iframe.src = rawUrl;
    }
  }

  function open(opts) {
    opts = opts || {};
    state.open = true;
    state.rawUrl = opts.url || "https://fmhy.net";
    state.siteName = opts.siteName || FMHYData.History.hostLabel(state.rawUrl);
    state.query = opts.query || "";
    state.imdb = opts.imdb || "";
    state.type = opts.type || "movie";
    state.season = opts.season || 0;
    state.episode = opts.episode || 0;
    state.title = opts.title || state.query || state.siteName;
    state.useProxy = opts.useProxy !== false;
    state.pointerX = Math.round(window.innerWidth / 2);
    state.pointerY = Math.round(window.innerHeight / 2);

    // Build embed / alternative server list if catalog item is present
    state.embedOptions = [];
    if (state.imdb) {
      var embeds = FMHYData.Sites.embedUrlsForTitle(state.type, state.imdb, state.season, state.episode);
      embeds.forEach(function (em) {
        state.embedOptions.push({
          label: "🎬 " + em.label + " (Embed)",
          url: em.url,
          useProxy: true
        });
      });
    }
    if (opts.siteObj && opts.siteObj.urls && opts.siteObj.urls.length > 1) {
      opts.siteObj.urls.forEach(function (mirrorUrl, idx) {
        state.embedOptions.push({
          label: "🌐 Mirror " + (idx + 1) + ": " + mirrorUrl.replace(/^https?:\/\//, ""),
          url: state.query ? FMHYData.Sites.deeplink(mirrorUrl, state.query) : mirrorUrl,
          useProxy: true
        });
      });
    }

    var titleEl = el("browser-site-title");
    if (titleEl) {
      titleEl.textContent = state.siteName + (state.title && state.title !== state.siteName ? " · " + state.title : "");
    }

    var layer = el("browser-layer");
    if (layer) layer.classList.add("open");

    clearSnifferData();
    setPointerMode(true);
    setTopbarFocus(-1);

    // Record to Continue Watching history
    FMHYData.History.record(
      state.rawUrl,
      state.title || state.siteName,
      state.siteName,
      state.season > 0 ? ("S" + state.season + " E" + state.episode) : ""
    );

    loadUrlIntoFrame(state.rawUrl, state.useProxy);
    startSnifferPolling();

    window.FMHYApp.toast("Sniffing video streams… Use D-pad pointer or Top Bar");
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    stopSnifferPolling();
    setPointerMode(false);
    var iframe = el("browser-iframe");
    if (iframe) iframe.src = "about:blank";
    var layer = el("browser-layer");
    if (layer) layer.classList.remove("open");
    if (window.FMHYApp && window.FMHYApp.onBrowserClosed) {
      window.FMHYApp.onBrowserClosed();
    }
  }

  function startSnifferPolling() {
    stopSnifferPolling();
    state.pollTimer = setInterval(function () {
      if (!state.open || window.FMHYPlayer.isOpen()) return;
      fetch(FMHYData.SERVICE_URL + "/api/sniffer/poll")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !state.open) return;
          ingestSnifferSnapshot(data);
        })
        .catch(function () {});
    }, 1100);
  }

  function stopSnifferPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function isRealStreamUrl(u) {
    if (!u || typeof u !== "string") return false;
    var low = u.toLowerCase();
    if (low.indexOf(".vtt") !== -1 || low.indexOf(".srt") !== -1) return false;
    if (low.indexOf("doubleclick") !== -1 || low.indexOf("googlesyndication") !== -1) return false;
    return /\.(m3u8|mpd|mp4|webm|mkv)(\?|$)/i.test(low) ||
           /(master|index|playlist|manifest|hls|dash)\.(m3u8|mpd|txt)/i.test(low) ||
           /\/(hls|m3u8|manifest)\//i.test(low);
  }

  function ingestSnifferSnapshot(data) {
    var addedNewStream = false;

    if (Array.isArray(data.subs)) {
      data.subs.forEach(function (s) {
        if (!s || !s.url) return;
        var exists = state.subs.some(function (x) { return x.url === s.url; });
        if (!exists) state.subs.push({ url: s.url, lang: s.lang || "Sub" });
      });
    }

    if (Array.isArray(data.servers) && data.servers.length > 0) {
      state.servers = data.servers;
    }
    if (Array.isArray(data.qualities) && data.qualities.length > 0) {
      state.qualities = data.qualities;
    }

    if (Array.isArray(data.streams)) {
      data.streams.forEach(function (st) {
        if (!st || !st.url || !isRealStreamUrl(st.url)) return;
        var exists = state.streams.some(function (x) { return x.url === st.url; });
        if (!exists) {
          state.streams.unshift({
            url: st.url,
            referer: st.referer || state.rawUrl,
            origin: st.origin || "",
            ua: st.ua || navigator.userAgent,
            time: st.time || Date.now()
          });
          addedNewStream = true;
        }
      });
    }

    updatePlayButtonUi();

    // Auto-handoff to native player if 'native' setting is enabled (matches Sniffer.java)
    if (addedNewStream && state.streams.length > 0 && FMHYData.Store.getBool("native", true)) {
      var best = pickBestStream(state.streams);
      if (best && state.autoLaunchedStream !== best.url && !window.FMHYPlayer.isOpen()) {
        state.autoLaunchedStream = best.url;
        launchNativePlayer(best);
      }
    }
  }

  function pickBestStream(streams) {
    if (!streams || streams.length === 0) return null;
    // Prefer master/index .m3u8 or .mpd over single segments
    for (var i = 0; i < streams.length; i++) {
      if (/\.(m3u8|mpd)(\?|$)/i.test(streams[i].url)) return streams[i];
    }
    return streams[0];
  }

  function launchNativePlayer(streamObj) {
    var st = streamObj || pickBestStream(state.streams);
    if (!st) {
      if (state.streams.length === 0) {
        window.FMHYApp.toast("No video stream detected yet — click play inside the page or switch server");
      }
      return;
    }

    var subUrls = state.subs.map(function (s) { return s.url; });
    var subLangs = state.subs.map(function (s) { return s.lang || "Sub"; });

    window.FMHYPlayer.open({
      url: st.url,
      referer: st.referer || state.rawUrl,
      origin: st.origin || "",
      ua: st.ua || navigator.userAgent,
      title: state.title || state.siteName,
      pageTitle: state.title || state.siteName,
      pageUrl: state.rawUrl,
      site: state.siteName,
      imdb: state.imdb,
      season: state.season,
      episode: state.episode,
      isIptv: false,
      useProxy: true,
      subUrls: subUrls,
      subLangs: subLangs,
      pageServers: state.servers,
      pageQualities: state.qualities,
      onSwitchServer: function (item) {
        if (item && item.id) {
          sendClickToPage(item.id);
          clearSnifferData();
          window.FMHYApp.toast("Switching to " + item.label + "…");
        }
      }
    });
  }

  function sendClickToPage(roleId) {
    fetch(FMHYData.SERVICE_URL + "/api/sniffer/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: roleId })
    }).catch(function () {});

    var iframe = el("browser-iframe");
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ __fmhyClickRole: roleId }, "*");
      } catch (e) {}
    }
  }

  function openServerOrStreamPicker() {
    var items = [];

    // 1. Sniffed video streams
    state.streams.forEach(function (st, idx) {
      var shortUrl = st.url.length > 68 ? st.url.slice(0, 65) + "…" : st.url;
      var ext = /\.m3u8/i.test(st.url) ? "HLS" : (/\.mpd/i.test(st.url) ? "DASH" : "MP4");
      items.push({
        label: "▶ Play Stream " + (idx + 1) + " [" + ext + "] — " + shortUrl,
        action: function () { launchNativePlayer(st); }
      });
    });

    // 2. Discovered in-page servers from roles.js
    state.servers.forEach(function (srv) {
      items.push({
        label: "🖥 Page Server: " + srv.label + (srv.on ? "  ✓" : ""),
        action: function () {
          sendClickToPage(srv.id);
          clearSnifferData();
          window.FMHYApp.toast("Switched page server to " + srv.label);
        }
      });
    });

    // 3. Multi-server embed options / site mirrors
    state.embedOptions.forEach(function (em) {
      items.push({
        label: em.label + (state.rawUrl === em.url ? "  ✓" : ""),
        action: function () {
          clearSnifferData();
          loadUrlIntoFrame(em.url, em.useProxy);
        }
      });
    });

    // 4. All starred/top FMHY sites if user wants to try another site with same query
    if (state.query || state.title) {
      var q = state.query || state.title;
      var otherSites = FMHYData.Sites.starred();
      if (otherSites.length === 0) otherSites = FMHYData.Sites.all().slice(0, 8);
      otherSites.forEach(function (s) {
        items.push({
          label: "🔎 Try on " + s.name + " (" + q + ")",
          action: function () {
            state.siteName = s.name;
            var dl = FMHYData.Sites.deeplink(s.url(), q);
            var titleEl = el("browser-site-title");
            if (titleEl) titleEl.textContent = s.name + " · " + q;
            clearSnifferData();
            loadUrlIntoFrame(dl, true);
          }
        });
      });
    }

    if (items.length === 0) {
      window.FMHYApp.toast("No streams or alternative servers available yet");
      return;
    }
    window.FMHYApp.showListModal("Streams & Servers", items);
  }

  function movePointer(dx, dy) {
    var now = Date.now();
    if (now - state.lastMoveTime < 220) {
      state.pointerStep = Math.min(44, state.pointerStep + 4);
    } else {
      state.pointerStep = 18;
    }
    state.lastMoveTime = now;

    state.pointerX = Math.max(8, Math.min(window.innerWidth - 8, state.pointerX + dx * state.pointerStep));
    state.pointerY = Math.max(8, Math.min(window.innerHeight - 8, state.pointerY + dy * state.pointerStep));

    var dot = el("virtual-pointer");
    if (dot) {
      dot.style.left = state.pointerX + "px";
      dot.style.top = state.pointerY + "px";
    }

    // If pointer enters topbar area, highlight topbar buttons
    if (state.pointerY <= 48) {
      var btns = topbarButtons();
      for (var i = 0; i < btns.length; i++) {
        var r = btns[i].getBoundingClientRect();
        if (state.pointerX >= r.left && state.pointerX <= r.right) {
          setTopbarFocus(i);
          break;
        }
      }
    } else if (state.topbarFocusedIdx !== -1) {
      setTopbarFocus(-1);
    }
  }

  function clickPointerAtCurrentPos() {
    var dot = el("virtual-pointer");
    if (dot) {
      dot.classList.add("pulse");
      setTimeout(function () { dot.classList.remove("pulse"); }, 140);
    }

    // Check if clicking a topbar button
    var btns = topbarButtons();
    for (var i = 0; i < btns.length; i++) {
      var r = btns[i].getBoundingClientRect();
      if (state.pointerX >= r.left && state.pointerX <= r.right &&
          state.pointerY >= r.top && state.pointerY <= r.bottom) {
        btns[i].click();
        return;
      }
    }

    // Otherwise click inside the iframe at (pointerX, pointerY - topbarHeight)
    var iframe = el("browser-iframe");
    if (!iframe) return;
    var rect = iframe.getBoundingClientRect();
    var ix = state.pointerX - rect.left;
    var iy = state.pointerY - rect.top;

    try {
      var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (doc) {
        var target = doc.elementFromPoint(ix, iy);
        if (target) {
          target.click();
          var ev = doc.createEvent("MouseEvents");
          ev.initMouseEvent("click", true, true, iframe.contentWindow, 1, ix, iy, ix, iy, false, false, false, false, 0, null);
          target.dispatchEvent(ev);
        }
      }
      window.focus();
    } catch (e) {}
  }

  function handleKeyDown(e) {
    if (!state.open) return false;
    var k = e.keyCode;
    var key = e.key;

    // Back / Return
    if (k === 10009 || k === 27 || k === 8 || key === "Escape" || key === "Backspace") {
      e.preventDefault();
      if (state.topbarFocusedIdx !== -1) {
        setTopbarFocus(-1);
        return true;
      }
      close();
      return true;
    }

    // Green button (404) toggles Pointer Mode vs Topbar Focus Mode
    if (k === 404) {
      e.preventDefault();
      setPointerMode(!state.pointerMode);
      if (!state.pointerMode) setTopbarFocus(0);
      return true;
    }

    // Red button (403) launches Native Player if stream is ready
    if (k === 403) {
      e.preventDefault();
      launchNativePlayer();
      return true;
    }

    // Yellow button (405) opens Servers / Streams picker
    if (k === 405) {
      e.preventDefault();
      openServerOrStreamPicker();
      return true;
    }

    // If topbar has D-pad focus
    if (state.topbarFocusedIdx !== -1) {
      var btns = topbarButtons();
      if (k === 37 || key === "ArrowLeft") {
        e.preventDefault();
        setTopbarFocus(Math.max(0, state.topbarFocusedIdx - 1));
        return true;
      }
      if (k === 39 || key === "ArrowRight") {
        e.preventDefault();
        setTopbarFocus(Math.min(btns.length - 1, state.topbarFocusedIdx + 1));
        return true;
      }
      if (k === 40 || key === "ArrowDown") {
        e.preventDefault();
        setTopbarFocus(-1);
        setPointerMode(true);
        return true;
      }
      if (k === 13 || key === "Enter") {
        e.preventDefault();
        if (btns[state.topbarFocusedIdx]) btns[state.topbarFocusedIdx].click();
        return true;
      }
      return true;
    }

    // Virtual Pointer D-Pad navigation
    if (state.pointerMode) {
      if (k === 37 || key === "ArrowLeft") {
        e.preventDefault();
        movePointer(-1, 0);
        return true;
      }
      if (k === 39 || key === "ArrowRight") {
        e.preventDefault();
        movePointer(1, 0);
        return true;
      }
      if (k === 38 || key === "ArrowUp") {
        e.preventDefault();
        if (state.pointerY <= 52) {
          setPointerMode(false);
          setTopbarFocus(1);
        } else {
          movePointer(0, -1);
        }
        return true;
      }
      if (k === 40 || key === "ArrowDown") {
        e.preventDefault();
        movePointer(0, 1);
        return true;
      }
      if (k === 13 || key === "Enter") {
        e.preventDefault();
        clickPointerAtCurrentPos();
        return true;
      }
    } else {
      // Topbar focus entry when pointer is off
      if (k === 38 || key === "ArrowUp") {
        e.preventDefault();
        setTopbarFocus(0);
        return true;
      }
      if (k === 13 || key === "Enter") {
        e.preventDefault();
        launchNativePlayer();
        return true;
      }
    }

    return false;
  }

  function initDomEvents() {
    window.addEventListener("message", function (ev) {
      if (!ev || !ev.data || !ev.data.__fmhySniff) return;
      var msg = ev.data;
      if (msg.type === "play" && msg.payload && msg.payload.url) {
        ingestSnifferSnapshot({
          streams: [{ url: msg.payload.url, referer: msg.payload.page || state.rawUrl }]
        });
      } else if (msg.type === "sub" && msg.payload && msg.payload.url) {
        ingestSnifferSnapshot({
          subs: [{ url: msg.payload.url, lang: msg.payload.lang || "Sub" }]
        });
      } else if (msg.type === "servers" && msg.payload) {
        try {
          var arr = typeof msg.payload.json === "string" ? JSON.parse(msg.payload.json) : msg.payload.json;
          ingestSnifferSnapshot({ servers: arr });
        } catch (e) {}
      } else if (msg.type === "qualities" && msg.payload) {
        try {
          var qArr = typeof msg.payload.json === "string" ? JSON.parse(msg.payload.json) : msg.payload.json;
          ingestSnifferSnapshot({ qualities: qArr });
        } catch (e) {}
      }
    });

    el("browser-back-btn").addEventListener("click", close);
    el("browser-play-btn").addEventListener("click", function () {
      if (state.streams.length > 0) {
        launchNativePlayer();
      } else {
        openServerOrStreamPicker();
      }
    });
    el("browser-servers-btn").addEventListener("click", openServerOrStreamPicker);
    el("browser-pointer-btn").addEventListener("click", function () {
      setPointerMode(!state.pointerMode);
    });
    el("browser-mode-btn").addEventListener("click", function () {
      loadUrlIntoFrame(state.rawUrl, !state.useProxy);
    });
    el("browser-reload-btn").addEventListener("click", function () {
      clearSnifferData();
      loadUrlIntoFrame(state.rawUrl, state.useProxy);
    });
  }

  return {
    init: initDomEvents,
    open: open,
    close: close,
    isOpen: function () { return state.open; },
    handleKeyDown: handleKeyDown
  };
})();
