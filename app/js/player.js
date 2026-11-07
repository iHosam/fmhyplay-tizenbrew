"use strict";

/**
 * FMHYPlay Native TV Player for TizenBrew
 * Ports PlayerActivity.java: HLS.js + DASH.js + HTML5 Video, Header Proxy Fallback,
 * Quality/Audio/Server selection, OpenSubtitles live search & SRT/VTT cue renderer
 * with Size/Position/Timing (+/- 0.1s) controls, Zoom modes, Speed, Resume & Simkl scrobbling.
 */

window.FMHYPlayer = (function () {
  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  var ZOOMS = ["Fit", "Fill", "Stretch", "16:9", "4:3"];
  var resumeMap = {};

  var state = {
    open: false,
    url: "",
    dash: false,
    headers: {},
    title: "",
    pageTitle: "",
    pageUrl: "",
    site: "",
    imdb: "",
    series: false,
    season: 0,
    episode: 0,
    isIptv: false,
    subUrls: [],
    loadedSubTracks: [], // { label, lang, cues: [{start, end, text}] }
    activeSubIdx: -1,
    hls: null,
    dashPlayer: null,
    zoomIdx: 0,
    inChipRow: false,
    focusedChipIdx: 0,
    hideTimer: null,
    noticeTimer: null,
    seekCommitTimer: null,
    pendingSeekSec: -1,
    triedProxy: false,
    scrobbledStart: false,
    scrobbledStop: false,
    onCloseCallback: null,
    onSwitchServerCallback: null,
    pageServers: [],
    pageQualities: []
  };

  function el(id) { return document.getElementById(id); }

  function formatClock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var s = Math.floor(sec);
    var hrs = Math.floor(s / 3600);
    var mins = Math.floor((s % 3600) / 60);
    var rem = s % 60;
    if (hrs > 0) {
      return hrs + ":" + (mins < 10 ? "0" : "") + mins + ":" + (rem < 10 ? "0" : "") + rem;
    }
    return mins + ":" + (rem < 10 ? "0" : "") + rem;
  }

  function say(msg) {
    var n = el("player-notice");
    if (!n) return;
    n.textContent = msg;
    n.style.display = "block";
    if (state.noticeTimer) clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(function () {
      n.style.display = "none";
    }, 1400);
  }

  // Parse SRT or WebVTT into array of { start: seconds, end: seconds, text: string }
  function parseSubCues(rawText) {
    var cues = [];
    var text = String(rawText || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var blocks = text.split(/\n\s*\n/);
    var timeRe = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})/;
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].trim().split("\n");
      var tIdx = -1;
      var match = null;
      for (var j = 0; j < Math.min(3, lines.length); j++) {
        match = timeRe.exec(lines[j]);
        if (match) { tIdx = j; break; }
      }
      if (tIdx < 0 || !match) continue;
      var start = (Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (Number(match[4]) / 1000);
      var end = (Number(match[5] || 0) * 3600) + (Number(match[6]) * 60) + Number(match[7]) + (Number(match[8]) / 1000);
      var cueText = lines.slice(tIdx + 1).join("\n").replace(/<[^>]+>/g, "").trim();
      if (cueText) {
        cues.push({ start: start, end: end, text: cueText });
      }
    }
    return cues;
  }

  function applySubtitleStyle() {
    var box = el("player-subtitle-box");
    var txt = el("player-subtitle-text");
    if (!box || !txt) return;
    var sz = FMHYData.Subs.size();
    var off = FMHYData.Subs.offset();
    txt.style.fontSize = Math.round(26 * sz / 100) + "px";
    box.style.bottom = Math.max(16, 100 + off) + "px";
  }

  function updateSubtitleDisplay() {
    var txt = el("player-subtitle-text");
    var video = el("player-video");
    if (!txt || !video) return;
    if (state.activeSubIdx < 0 || !state.loadedSubTracks[state.activeSubIdx]) {
      txt.style.display = "none";
      return;
    }
    var track = state.loadedSubTracks[state.activeSubIdx];
    var nowSec = video.currentTime - (FMHYData.Subs.delayMs / 1000);
    var activeLines = [];
    for (var i = 0; i < track.cues.length; i++) {
      var c = track.cues[i];
      if (nowSec >= c.start && nowSec <= c.end) {
        activeLines.push(c.text);
      }
    }
    if (activeLines.length > 0) {
      txt.textContent = activeLines.join("\n");
      txt.style.display = "inline-block";
    } else {
      txt.style.display = "none";
    }
  }

  function applyZoom() {
    var video = el("player-video");
    if (!video) return;
    var mode = ZOOMS[state.zoomIdx] || "Fit";
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.aspectRatio = "";
    if (mode === "Fit") {
      video.style.objectFit = "contain";
    } else if (mode === "Fill") {
      video.style.objectFit = "cover";
    } else if (mode === "Stretch") {
      video.style.objectFit = "fill";
    } else if (mode === "16:9") {
      video.style.objectFit = "fill";
      video.style.width = "100vw";
      video.style.height = "56.25vw";
    } else if (mode === "4:3") {
      video.style.objectFit = "fill";
      video.style.height = "100vh";
      video.style.width = "133.33vh";
    }
  }

  function visibleChips() {
    var row = el("player-chip-row");
    if (!row) return [];
    return Array.prototype.slice.call(row.querySelectorAll(".player-chip")).filter(function (c) {
      return c.style.display !== "none";
    });
  }

  function setChipRowFocus(on) {
    state.inChipRow = !!on;
    var chips = visibleChips();
    chips.forEach(function (c) { c.classList.remove("focused"); });
    if (state.inChipRow && chips.length > 0) {
      state.focusedChipIdx = Math.max(0, Math.min(state.focusedChipIdx, chips.length - 1));
      chips[state.focusedChipIdx].classList.add("focused");
      showControls();
    }
  }

  function refreshChips() {
    var video = el("player-video");
    if (!video) return;
    var chipServers = el("pchip-servers");
    var chipQuality = el("pchip-quality");
    var chipAudio = el("pchip-audio");
    var chipSubs = el("pchip-subs");
    var chipSpeed = el("pchip-speed");
    var chipZoom = el("pchip-zoom");

    // Servers
    var hasServers = state.pageServers && state.pageServers.length > 0;
    if (chipServers) {
      chipServers.style.display = hasServers ? "inline-flex" : "none";
      var curSrv = "";
      for (var i = 0; i < state.pageServers.length; i++) {
        if (state.pageServers[i].on) curSrv = state.pageServers[i].label;
      }
      chipServers.querySelector(".pchip-val").textContent = curSrv ? curSrv.slice(0, 10) : "Servers";
    }

    // Quality
    var levels = (state.hls && state.hls.levels) || [];
    var hasQualities = levels.length > 1 || (state.pageQualities && state.pageQualities.length > 0);
    if (chipQuality) {
      chipQuality.style.display = hasQualities ? "inline-flex" : "none";
      var qLabel = "Auto";
      var qChanged = false;
      if (state.hls && levels.length > 1) {
        var curLvl = state.hls.currentLevel;
        var activeLvl = state.hls.loadLevel >= 0 ? levels[state.hls.loadLevel] : null;
        var h = activeLvl && activeLvl.height ? (activeLvl.height >= 2160 ? "4K" : activeLvl.height + "p") : (video.videoHeight ? video.videoHeight + "p" : "");
        if (curLvl >= 0 && levels[curLvl]) {
          qLabel = levels[curLvl].height ? (levels[curLvl].height + "p") : "Manual";
          qChanged = true;
        } else {
          qLabel = h ? ("Auto " + h) : "Auto";
        }
      }
      chipQuality.querySelector(".pchip-val").textContent = qLabel;
      chipQuality.classList.toggle("changed", qChanged);
    }

    // Audio
    var audioTracks = (state.hls && state.hls.audioTracks) || [];
    if (chipAudio) {
      chipAudio.style.display = audioTracks.length > 1 ? "inline-flex" : "none";
      var curAudio = audioTracks[state.hls ? state.hls.audioTrack : 0];
      var aCode = curAudio ? String(curAudio.lang || curAudio.name || "Audio").slice(0, 3).toUpperCase() : "AUD";
      chipAudio.querySelector(".pchip-val").textContent = aCode;
    }

    // Subtitles
    var canSubs = state.loadedSubTracks.length > 0 || !state.isIptv;
    if (chipSubs) {
      chipSubs.style.display = canSubs ? "inline-flex" : "none";
      var subOn = state.activeSubIdx >= 0 && state.loadedSubTracks[state.activeSubIdx];
      chipSubs.querySelector(".pchip-val").textContent = subOn ? String(subOn.lang || "CC").slice(0, 3).toUpperCase() : "Off";
      chipSubs.classList.toggle("changed", !!subOn);
    }

    // Speed
    if (chipSpeed) {
      var sp = video.playbackRate || 1;
      chipSpeed.querySelector(".pchip-val").textContent = sp + "x";
      chipSpeed.classList.toggle("changed", sp !== 1);
    }

    // Zoom
    if (chipZoom) {
      var zm = ZOOMS[state.zoomIdx] || "Fit";
      chipZoom.querySelector(".pchip-val").textContent = zm;
      chipZoom.classList.toggle("changed", state.zoomIdx !== 0);
    }
  }

  function showControls() {
    var ctrl = el("player-controls");
    if (!ctrl) return;
    ctrl.classList.remove("hidden");
    refreshChips();
    if (state.hideTimer) clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(function () {
      var video = el("player-video");
      if (video && !video.paused && ! document.getElementById("modal-backdrop").classList.contains("open")) {
        setChipRowFocus(false);
        ctrl.classList.add("hidden");
      }
    }, state.inChipRow ? 8000 : 3800);
  }

  function hideControls() {
    var ctrl = el("player-controls");
    if (!ctrl) return;
    setChipRowFocus(false);
    ctrl.classList.add("hidden");
  }

  function updateProgressUi() {
    var video = el("player-video");
    if (!video) return;
    var playBtn = el("player-play-btn");
    if (playBtn) {
      playBtn.innerHTML = video.paused ? "&#9654;" : "&#10074;&#10074;";
    }
    var dur = video.duration;
    var isLive = !isFinite(dur) || dur <= 0 || state.isIptv;
    var pos = state.pendingSeekSec >= 0 ? state.pendingSeekSec : video.currentTime;
    var timeCur = el("player-time-cur");
    var timeTot = el("player-time-tot");
    var seekFill = el("player-seek-fill");
    var seekTrack = el("player-seek-track");

    if (isLive) {
      if (timeCur) timeCur.textContent = "LIVE";
      if (timeTot) timeTot.textContent = "";
      if (seekTrack) seekTrack.style.visibility = "hidden";
    } else {
      if (timeCur) timeCur.textContent = formatClock(pos);
      if (timeTot) timeTot.textContent = formatClock(dur);
      if (seekTrack) seekTrack.style.visibility = "visible";
      if (seekFill) seekFill.style.width = Math.min(100, Math.max(0, (pos / dur) * 100)) + "%";
    }
    updateSubtitleDisplay();
  }

  function destroyEngines() {
    if (state.hls) {
      try { state.hls.destroy(); } catch (e) {}
      state.hls = null;
    }
    if (state.dashPlayer) {
      try { state.dashPlayer.reset(); } catch (e) {}
      state.dashPlayer = null;
    }
  }

  function scrobbleNow(action) {
    var video = el("player-video");
    if (!video || state.isIptv || state.scrobbledStop || !state.imdb) return;
    var dur = video.duration;
    if (!isFinite(dur) || dur <= 0) return;
    var epArr = state.series && state.season > 0 && state.episode > 0 ? [state.season, state.episode] : null;
    if (state.series && !epArr) return;
    if (action === "stop") state.scrobbledStop = true;
    var pct = video.ended ? 100 : (video.currentTime * 100 / dur);
    FMHYData.Simkl.scrobble(action, state.imdb, epArr, pct, function (msg) {
      if (window.FMHYApp && FMHYApp.toast) FMHYApp.toast(msg);
    });
  }

  function loadSubtitleUrl(subUrl, label, lang, activateNow) {
    var proxied = FMHYData.proxyStreamUrl(subUrl, state.headers, true);
    FMHYData.fetchText(proxied || subUrl)
      .then(function (txt) {
        var cues = parseSubCues(txt);
        if (cues.length === 0) return;
        state.loadedSubTracks.push({
          label: label || ("Subtitles " + (state.loadedSubTracks.length + 1)),
          lang: lang || "CC",
          cues: cues
        });
        if (activateNow) {
          state.activeSubIdx = state.loadedSubTracks.length - 1;
          say("Subtitles: " + (label || lang));
        }
        refreshChips();
      })
      .catch(function () {});
  }

  function attachStream(streamUrl, useProxy) {
    var video = el("player-video");
    if (!video) return;
    destroyEngines();
    var finalUrl = useProxy ? FMHYData.proxyStreamUrl(streamUrl, state.headers, false) : streamUrl;
    var spinner = el("player-spinner");
    if (spinner) spinner.style.display = "block";

    var cleanPath = streamUrl.split("?")[0].split("#")[0].toLowerCase();
    var isDash = state.dash || cleanPath.slice(-4) === ".mpd";
    var isDirectFile = /\.(mp4|mkv|webm|mov|avi)$/i.test(cleanPath);

    if (isDash && window.dashjs) {
      var dp = dashjs.MediaPlayer().create();
      dp.initialize(video, finalUrl, true);
      state.dashPlayer = dp;
      return;
    }

    if (!isDirectFile && window.Hls && Hls.isSupported()) {
      var hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60
      });
      state.hls = hls;
      hls.loadSource(finalUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        var resumeKey = streamUrl.split("?")[0];
        if (resumeMap[resumeKey] && resumeMap[resumeKey] > 10 && !state.isIptv) {
          video.currentTime = resumeMap[resumeKey];
        }
        video.play().catch(function () {});
        refreshChips();
      });
      hls.on(Hls.Events.ERROR, function (ev, data) {
        if (data && data.fatal) {
          if (!state.triedProxy && FMHYData.isServiceOnline()) {
            state.triedProxy = true;
            say("Routing stream through proxy…");
            attachStream(streamUrl, true);
          } else {
            if (state.isIptv) {
              FMHYData.Iptv.mark(state.url, false);
            }
            if (window.FMHYApp && FMHYApp.toast) {
              FMHYApp.toast(state.isIptv ? "Channel is offline" : "Stream error, try another server");
            }
          }
        }
      });
    } else {
      video.src = finalUrl;
      video.play().catch(function () {
        if (!state.triedProxy && FMHYData.isServiceOnline()) {
          state.triedProxy = true;
          attachStream(streamUrl, true);
        }
      });
    }
  }

  function open(opts) {
    opts = opts || {};
    if (!opts.url) return;
    state.open = true;
    state.url = opts.url;
    state.dash = !!opts.dash;
    state.headers = opts.headers || {};
    state.title = opts.title || "Playing";
    state.pageTitle = opts.pageTitle || opts.title || "";
    state.pageUrl = opts.pageUrl || "";
    state.site = opts.site || "";
    state.imdb = opts.imdb || "";
    state.series = !!opts.series;
    state.season = Number(opts.season || 0);
    state.episode = Number(opts.episode || 0);
    state.isIptv = !!opts.isIptv;
    state.subUrls = opts.subs || [];
    state.loadedSubTracks = [];
    state.activeSubIdx = -1;
    state.zoomIdx = 0;
    state.inChipRow = false;
    state.pendingSeekSec = -1;
    state.scrobbledStart = false;
    state.scrobbledStop = false;
    state.onCloseCallback = opts.onClose || null;
    state.onSwitchServerCallback = opts.onSwitchServer || null;
    state.pageServers = opts.servers || [];
    state.pageQualities = opts.qualities || [];
    FMHYData.Subs.delayMs = 0;

    var layer = el("player-layer");
    if (layer) layer.classList.add("open");

    var titleEl = el("player-title");
    if (titleEl) {
      var clean = state.pageTitle ? FMHYData.History.cleanTitle(state.pageTitle, state.site) : state.title;
      titleEl.textContent = clean || state.title;
    }

    var epEl = el("player-ep-line");
    if (epEl) {
      if (state.season > 0 || state.episode > 0) {
        epEl.textContent = (state.season > 0 ? "Season " + state.season + "  ·  " : "") + "Episode " + state.episode;
        epEl.style.display = "block";
      } else {
        var epStr = FMHYData.History.episode(state.pageUrl, state.pageTitle);
        epEl.textContent = epStr;
        epEl.style.display = epStr ? "block" : "none";
      }
    }

    applySubtitleStyle();
    applyZoom();

    // Preload any sniffed subtitles
    for (var i = 0; i < state.subUrls.length; i++) {
      var su = state.subUrls[i];
      var fn = su.split("?")[0].split("/").pop() || ("Sub " + (i + 1));
      loadSubtitleUrl(su, "Subtitles " + (i + 1) + " (" + fn + ")", "CC", false);
    }

    // Use service proxy automatically if custom Referer/Origin/User-Agent headers are present
    var needsHeaderReplay = !!(state.headers["Referer"] || state.headers["Origin"] || state.headers["User-Agent"]);
    var useProxyFirst = needsHeaderReplay && FMHYData.isServiceOnline();
    state.triedProxy = useProxyFirst;
    attachStream(state.url, useProxyFirst);
    showControls();
  }

  function close() {
    if (!state.open) return;
    var video = el("player-video");
    if (video) {
      var dur = video.duration;
      var pos = video.currentTime;
      var resumeKey = state.url.split("?")[0];
      if (isFinite(dur) && dur > 0 && !state.isIptv && pos < dur - 30) {
        resumeMap[resumeKey] = pos;
      } else {
        delete resumeMap[resumeKey];
      }
      scrobbleNow("stop");
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    destroyEngines();
    state.open = false;
    if (state.hideTimer) clearTimeout(state.hideTimer);
    var layer = el("player-layer");
    if (layer) layer.classList.remove("open");
    if (state.onCloseCallback) {
      var cb = state.onCloseCallback;
      state.onCloseCallback = null;
      cb();
    }
  }

  function togglePlay() {
    var video = el("player-video");
    if (!video) return;
    if (video.paused) video.play().catch(function () {});
    else video.pause();
    showControls();
  }

  function seekBy(deltaSec) {
    var video = el("player-video");
    if (!video || state.isIptv || !isFinite(video.duration) || video.duration <= 0) return;
    var base = state.pendingSeekSec >= 0 ? state.pendingSeekSec : video.currentTime;
    var target = Math.max(0, Math.min(video.duration - 1, base + deltaSec));
    state.pendingSeekSec = target;
    say(formatClock(target));
    showControls();
    updateProgressUi();
    if (state.seekCommitTimer) clearTimeout(state.seekCommitTimer);
    state.seekCommitTimer = setTimeout(function () {
      if (state.pendingSeekSec >= 0 && video) {
        video.currentTime = state.pendingSeekSec;
      }
      state.pendingSeekSec = -1;
      updateProgressUi();
    }, 400);
  }

  // ---- Action Chip Menus ----
  function pickServer() {
    if (!state.pageServers || state.pageServers.length === 0) {
      say("No server list found");
      return;
    }
    var items = state.pageServers.map(function (s) {
      return {
        label: s.label + (s.on ? "  ✓" : ""),
        action: function () {
          var video = el("player-video");
          if (video && isFinite(video.currentTime) && video.currentTime > 5) {
            resumeMap[state.url.split("?")[0]] = video.currentTime;
          }
          var switchCb = state.onSwitchServerCallback;
          close();
          if (switchCb) switchCb(s);
        }
      };
    });
    window.FMHYApp.showListModal("Servers", items);
  }

  function pickQuality() {
    var levels = (state.hls && state.hls.levels) || [];
    if (levels.length > 1) {
      var items = [{
        label: "Auto" + (state.hls.currentLevel === -1 ? "  ✓" : ""),
        action: function () {
          state.hls.currentLevel = -1;
          say("Quality: Auto");
          refreshChips();
        }
      }];
      var seenHeights = {};
      for (var i = levels.length - 1; i >= 0; i--) {
        (function (idx, lvl) {
          var h = lvl.height || 0;
          if (h > 0 && seenHeights[h]) return;
          if (h > 0) seenHeights[h] = true;
          var lbl = h >= 2160 ? "4K" : (h > 0 ? h + "p" : "Level " + idx);
          if (lvl.frameRate && lvl.frameRate > 30) lbl += Math.round(lvl.frameRate);
          items.push({
            label: lbl + (state.hls.currentLevel === idx ? "  ✓" : ""),
            action: function () {
              state.hls.currentLevel = idx;
              say("Quality: " + lbl);
              refreshChips();
            }
          });
        })(i, levels[i]);
      }
      window.FMHYApp.showListModal("Quality", items);
      return;
    }
    if (state.pageQualities && state.pageQualities.length > 0) {
      var qItems = state.pageQualities.map(function (q) {
        return {
          label: q.label + (q.on ? "  ✓" : ""),
          action: function () {
            var switchCb = state.onSwitchServerCallback;
            close();
            if (switchCb) switchCb(q);
          }
        };
      });
      window.FMHYApp.showListModal("Quality", qItems);
    }
  }

  function pickAudio() {
    var tracks = (state.hls && state.hls.audioTracks) || [];
    if (tracks.length <= 1) {
      say("Single audio track");
      return;
    }
    var items = tracks.map(function (t, idx) {
      var lbl = t.name || t.lang || ("Audio " + (idx + 1));
      return {
        label: lbl + (state.hls.audioTrack === idx ? "  ✓" : ""),
        action: function () {
          state.hls.audioTrack = idx;
          say("Audio: " + lbl);
          refreshChips();
        }
      };
    });
    window.FMHYApp.showListModal("Audio", items);
  }

  function pickSubtitles() {
    var items = [{
      label: "Off" + (state.activeSubIdx === -1 ? "  ✓" : ""),
      action: function () {
        state.activeSubIdx = -1;
        updateSubtitleDisplay();
        refreshChips();
        say("Subtitles: Off");
      }
    }];
    state.loadedSubTracks.forEach(function (tr, idx) {
      items.push({
        label: tr.label + (state.activeSubIdx === idx ? "  ✓" : ""),
        action: function () {
          state.activeSubIdx = idx;
          updateSubtitleDisplay();
          refreshChips();
          say("Subtitles: " + tr.label);
        }
      });
    });
    if (!state.isIptv) {
      items.push({
        label: "🔍  Search OpenSubtitles…",
        action: function () { searchOpenSubtitles(); }
      });
    }
    items.push({
      label: "Aa  Size, position, timing  (" + FMHYData.Subs.sizeLabel() + " · " + FMHYData.Subs.offsetLabel() + " · " + FMHYData.Subs.delayLabel() + ")",
      action: function () {
        window.FMHYApp.openSubtitleStyleModal(true, function () {
          applySubtitleStyle();
          updateSubtitleDisplay();
        });
      }
    });
    window.FMHYApp.showListModal("Subtitles", items);
  }

  function searchOpenSubtitles() {
    say("Searching OpenSubtitles…");
    var titleClean = FMHYData.History.cleanTitle(state.pageTitle || state.title, state.site);
    var s = state.season;
    var e = state.episode;
    if (!s && !e) {
      var epMatch = /S(\d+)\s*E(\d+)/i.exec(FMHYData.History.episode(state.pageUrl, state.pageTitle));
      if (epMatch) {
        s = parseInt(epMatch[1], 10);
        e = parseInt(epMatch[2], 10);
      }
    }
    var resolveImdb = state.imdb
      ? Promise.resolve(state.imdb)
      : FMHYData.Catalog.list(s > 0 ? "series" : "movie", "search=" + encodeURIComponent(titleClean)).then(function (list) {
          return (list && list.length > 0) ? list[0].id : "";
        });

    resolveImdb.then(function (imdbId) {
      if (!imdbId) {
        say("Can't find title on OpenSubtitles");
        return;
      }
      return FMHYData.Subs.find(imdbId, s, e).then(function (subs) {
        if (!subs || subs.length === 0) {
          say("No subtitles found for this title");
          return;
        }
        var grouped = FMHYData.Subs.byLanguage(subs);
        var langCodes = Object.keys(grouped);
        var langItems = langCodes.map(function (code) {
          var langName = FMHYData.Subs.languageName(code);
          var files = grouped[code];
          return {
            label: langName + "  ·  " + files.length,
            action: function () {
              var fileItems = files.slice(0, 35).map(function (f) {
                return {
                  label: f.release,
                  action: function () {
                    say("Loading " + langName + " subtitles…");
                    loadSubtitleUrl(f.url, langName + " (" + f.release.slice(0, 28) + ")", code, true);
                  }
                };
              });
              window.FMHYApp.showListModal(langName + ": pick a release", fileItems);
            }
          };
        });
        window.FMHYApp.showListModal("Subtitle language", langItems);
      });
    });
  }

  function pickSpeed() {
    var video = el("player-video");
    var cur = video ? video.playbackRate : 1;
    var items = SPEEDS.map(function (s) {
      return {
        label: s + "x" + (cur === s ? "  ✓" : ""),
        action: function () {
          if (video) video.playbackRate = s;
          say("Speed: " + s + "x");
          refreshChips();
        }
      };
    });
    window.FMHYApp.showListModal("Speed", items);
  }

  function cycleZoom() {
    state.zoomIdx = (state.zoomIdx + 1) % ZOOMS.length;
    applyZoom();
    say("Zoom: " + ZOOMS[state.zoomIdx]);
    refreshChips();
  }

  function handleKeyDown(e) {
    if (!state.open) return false;
    var k = e.keyCode;
    var key = e.key;

    // Back / Return key
    if (k === 10009 || k === 27 || k === 8 || key === "Escape" || key === "Backspace") {
      e.preventDefault();
      if (state.inChipRow) {
        setChipRowFocus(false);
        return true;
      }
      close();
      return true;
    }

    // Media Play / Pause / FastForward / Rewind / Stop
    if (k === 415 || key === "MediaPlay") {
      e.preventDefault();
      var v1 = el("player-video");
      if (v1) v1.play().catch(function () {});
      showControls();
      return true;
    }
    if (k === 19 || key === "MediaPause") {
      e.preventDefault();
      var v2 = el("player-video");
      if (v2) v2.pause();
      showControls();
      return true;
    }
    if (k === 10252 || key === "MediaPlayPause" || key === " ") {
      e.preventDefault();
      togglePlay();
      return true;
    }
    if (k === 413 || key === "MediaStop") {
      e.preventDefault();
      close();
      return true;
    }
    if (k === 412 || key === "MediaRewind") {
      e.preventDefault();
      seekBy(-10);
      return true;
    }
    if (k === 417 || key === "MediaFastForward") {
      e.preventDefault();
      seekBy(10);
      return true;
    }

    // When focus is inside the bottom action chip row
    if (state.inChipRow) {
      var chips = visibleChips();
      if (k === 37 || key === "ArrowLeft") {
        e.preventDefault();
        state.focusedChipIdx = Math.max(0, state.focusedChipIdx - 1);
        setChipRowFocus(true);
        return true;
      }
      if (k === 39 || key === "ArrowRight") {
        e.preventDefault();
        state.focusedChipIdx = Math.min(chips.length - 1, state.focusedChipIdx + 1);
        setChipRowFocus(true);
        return true;
      }
      if (k === 38 || key === "ArrowUp") {
        e.preventDefault();
        setChipRowFocus(false);
        return true;
      }
      if (k === 13 || key === "Enter") {
        e.preventDefault();
        if (chips[state.focusedChipIdx]) chips[state.focusedChipIdx].click();
        return true;
      }
      return true;
    }

    // Normal player remote controls
    if (k === 13 || key === "Enter") {
      e.preventDefault();
      togglePlay();
      return true;
    }
    if (k === 37 || key === "ArrowLeft") {
      e.preventDefault();
      seekBy(-10);
      return true;
    }
    if (k === 39 || key === "ArrowRight") {
      e.preventDefault();
      seekBy(10);
      return true;
    }
    if (k === 38 || key === "ArrowUp") {
      e.preventDefault();
      showControls();
      return true;
    }
    if (k === 40 || key === "ArrowDown" || k === 18 || k === 406) {
      e.preventDefault();
      setChipRowFocus(true);
      return true;
    }

    return false;
  }

  function initDomEvents() {
    var video = el("player-video");
    if (!video) return;

    video.addEventListener("waiting", function () {
      var sp = el("player-spinner");
      if (sp) sp.style.display = "block";
    });
    video.addEventListener("playing", function () {
      var sp = el("player-spinner");
      if (sp) sp.style.display = "none";
      if (state.isIptv) FMHYData.Iptv.played(state.url);
      if (!state.scrobbledStart) {
        state.scrobbledStart = true;
        scrobbleNow("start");
      } else {
        scrobbleNow("start");
      }
      showControls();
    });
    video.addEventListener("pause", function () {
      if (state.scrobbledStart && !video.ended) scrobbleNow("pause");
      updateProgressUi();
      showControls();
    });
    video.addEventListener("timeupdate", updateProgressUi);
    video.addEventListener("ended", function () {
      delete resumeMap[state.url.split("?")[0]];
      scrobbleNow("stop");
      close();
    });

    el("player-back-btn").addEventListener("click", close);
    el("player-rew-btn").addEventListener("click", function () { seekBy(-10); });
    el("player-play-btn").addEventListener("click", togglePlay);
    el("player-fwd-btn").addEventListener("click", function () { seekBy(10); });

    el("pchip-servers").addEventListener("click", pickServer);
    el("pchip-quality").addEventListener("click", pickQuality);
    el("pchip-audio").addEventListener("click", pickAudio);
    el("pchip-subs").addEventListener("click", pickSubtitles);
    el("pchip-speed").addEventListener("click", pickSpeed);
    el("pchip-zoom").addEventListener("click", cycleZoom);
  }

  return {
    init: initDomEvents,
    open: open,
    close: close,
    isOpen: function () { return state.open; },
    handleKeyDown: handleKeyDown,
    applySubtitleStyle: applySubtitleStyle
  };
})();
