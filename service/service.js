"use strict";

/**
 * FMHYPlay Background Service for TizenBrew
 * Compatible with Node.js v4.4.3+ (Tizen 3.0+) through modern Node.js.
 * Provides:
 *  1. Persistent TV storage (/home/owner/share/fmhyplayData.json)
 *  2. CORS-free HTTP/HTTPS fetcher & Simkl/Xtream/Cinemeta/FMHY helper (/api/fetch)
 *  3. Concurrent IPTV stream health prober (/api/probe, /api/probe-batch)
 *  4. Header-replaying HLS (.m3u8) / DASH (.mpd) / Segment / Subtitle stream proxy (/proxy/stream)
 *  5. Ad-blocking, X-Frame-Options-stripping Web Page & Embed Proxy with Stream Sniffer (/proxy/page)
 */

var http = require('http');
var https = require('https');
var urlModule = require('url');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var PORT = 8087;
var DEFAULT_UA = "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 TV Safari/537.36";
var CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

var STATE_PATHS = [
    '/home/owner/share/fmhyplayData.json',
    path.join(process.cwd ? process.cwd() : '.', 'fmhyplayData.json')
];

function getStateFilePath() {
    try {
        if (fs.existsSync('/home/owner/share')) {
            return STATE_PATHS[0];
        }
    } catch (e) {}
    return STATE_PATHS[1];
}

function readState() {
    var p = getStateFilePath();
    try {
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function writeState(data) {
    var p = getStateFilePath();
    try {
        var current = readState();
        var keys = Object.keys(data || {});
        for (var i = 0; i < keys.length; i++) {
            current[keys[i]] = data[keys[i]];
        }
        fs.writeFileSync(p, JSON.stringify(current, null, 2), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

// ---- AdBlock Domain List (Core + Dynamic additions from client/HaGeZi) ----
var blockedDomains = {
    "doubleclick.net": 1, "googlesyndication.com": 1, "googleadservices.com": 1,
    "adnxs.com": 1, "popads.net": 1, "popcash.net": 1, "propellerads.com": 1,
    "exoclick.com": 1, "juicyads.com": 1, "trafficjunky.net": 1, "adsterra.com": 1,
    "hilltopads.net": 1, "clickadu.com": 1, "adcash.com": 1, "bidvertiser.com": 1,
    "revcontent.com": 1, "mgid.com": 1, "taboola.com": 1, "outbrain.com": 1,
    "yandex.ru": 1, "mc.yandex.ru": 1, "histats.com": 1, "statcounter.com": 1,
    " clarity.ms": 1, "hotjar.com": 1, "acscdn.com": 1, "usrpubtrk.com": 1,
    "onclkds.com": 1, "afcdn.net": 1, "tsyndicate.com": 1, "realsrv.com": 1,
    "bidgear.com": 1, "a-ads.com": 1, "admaven.com": 1, "galaksion.com": 1
};

function isDomainBlocked(host) {
    if (!host) return false;
    var h = String(host).toLowerCase().trim();
    while (h) {
        if (blockedDomains[h]) return true;
        var dot = h.indexOf('.');
        if (dot < 0) break;
        h = h.substring(dot + 1);
    }
    return false;
}

// ---- Sniffer State (shared between proxied pages and TV Player) ----
var snifferState = {
    manifests: [],
    subtitles: [],
    servers: [],
    qualities: [],
    poster: "",
    pageTitle: "",
    pageUrl: "",
    pendingClickKey: null,
    updatedAt: 0
};

function resetSniffer() {
    snifferState.manifests = [];
    snifferState.subtitles = [];
    snifferState.servers = [];
    snifferState.qualities = [];
    snifferState.updatedAt = Date.now();
}

function recordManifest(streamUrl, isDash, headers) {
    if (!streamUrl || typeof streamUrl !== 'string') return;
    if (streamUrl.indexOf('http') !== 0) return;
    var parsed = urlModule.parse(streamUrl);
    if (parsed.hostname && isDomainBlocked(parsed.hostname)) return;
    for (var i = 0; i < snifferState.manifests.length; i++) {
        if (snifferState.manifests[i].url === streamUrl) return;
    }
    if (snifferState.manifests.length >= 25) return;
    var cleanPath = (parsed.pathname || '').toLowerCase();
    var isMaster = !isDash && cleanPath.indexOf('master') >= 0;
    snifferState.manifests.push({
        url: streamUrl,
        dash: !!isDash,
        master: isMaster,
        headers: headers || {},
        time: Date.now()
    });
    snifferState.updatedAt = Date.now();
}

function recordSubtitle(subUrl) {
    if (!subUrl || typeof subUrl !== 'string') return;
    if (subUrl.indexOf('http') !== 0) return;
    if (snifferState.subtitles.length >= 12) return;
    if (snifferState.subtitles.indexOf(subUrl) >= 0) return;
    snifferState.subtitles.push(subUrl);
    snifferState.updatedAt = Date.now();
}

// ---- Low-level HTTP/HTTPS Request Helper with Redirect & Gzip Support ----
function requestRaw(targetUrl, options, callback, redirectCount) {
    redirectCount = redirectCount || 0;
    if (redirectCount > 6) {
        return callback(new Error("Too many redirects"));
    }
    var parsed;
    try {
        parsed = urlModule.parse(targetUrl);
    } catch (e) {
        return callback(e);
    }
    if (!parsed.protocol || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        return callback(new Error("Unsupported protocol: " + parsed.protocol));
    }

    var isHttps = parsed.protocol === 'https:';
    var lib = isHttps ? https : http;
    var reqHeaders = {};
    var srcHeaders = (options && options.headers) || {};
    var hKeys = Object.keys(srcHeaders);
    for (var i = 0; i < hKeys.length; i++) {
        var k = hKeys[i];
        if (srcHeaders[k] !== undefined && srcHeaders[k] !== null && srcHeaders[k] !== '') {
            reqHeaders[k] = srcHeaders[k];
        }
    }
    if (!reqHeaders['User-Agent'] && !reqHeaders['user-agent']) {
        reqHeaders['User-Agent'] = CHROME_UA;
    }
    if (!reqHeaders['Accept'] && !reqHeaders['accept']) {
        reqHeaders['Accept'] = '*/*';
    }

    var reqOpts = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.path || '/',
        method: (options && options.method) || 'GET',
        headers: reqHeaders,
        rejectUnauthorized: false
    };

    var done = false;
    function finish(err, res, stream) {
        if (done) return;
        done = true;
        callback(err, res, stream, targetUrl);
    }

    var req = lib.request(reqOpts, function (res) {
        var code = res.statusCode || 0;
        if ((code === 301 || code === 302 || code === 303 || code === 307 || code === 308) && res.headers.location) {
            res.resume();
            var nextUrl = urlModule.resolve(targetUrl, res.headers.location);
            return requestRaw(nextUrl, options, callback, redirectCount + 1);
        }
        var encoding = (res.headers['content-encoding'] || '').toLowerCase();
        var stream = res;
        if (options && options.decompress !== false) {
            if (encoding === 'gzip') {
                stream = res.pipe(zlib.createGunzip());
            } else if (encoding === 'deflate') {
                stream = res.pipe(zlib.createInflate());
            }
        }
        finish(null, res, stream);
    });

    req.setTimeout((options && options.timeout) || 20000, function () {
        req.abort();
        finish(new Error("Request timeout"));
    });

    req.on('error', function (err) {
        finish(err);
    });

    if (options && options.body) {
        req.write(options.body);
    }
    req.end();
}

function fetchBuffer(targetUrl, options, callback) {
    requestRaw(targetUrl, options, function (err, res, stream, finalUrl) {
        if (err) return callback(err);
        var chunks = [];
        var total = 0;
        var maxBytes = (options && options.maxBytes) || (25 * 1024 * 1024);
        stream.on('data', function (chunk) {
            total += chunk.length;
            if (total <= maxBytes) {
                chunks.push(chunk);
            } else {
                res.destroy();
            }
        });
        stream.on('end', function () {
            var buf = Buffer.concat(chunks);
            callback(null, res, buf, finalUrl);
        });
        stream.on('error', function (e) {
            callback(e);
        });
    });
}

// ---- SRT to WebVTT Converter ----
function srtToVtt(srtText) {
    var text = String(srtText || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (text.trim().indexOf('WEBVTT') === 0) return text;
    var lines = text.split('\n');
    var out = ['WEBVTT', ''];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        // Match SRT timestamp line: 00:01:23,456 --> 00:01:25,789
        if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(line.trim())) {
            out.push(line.replace(/,/g, '.'));
        } else {
            out.push(line);
        }
    }
    return out.join('\n');
}

// ---- M3U8 Playlist Rewriter (routes segments, variant playlists & keys through local proxy) ----
function rewriteM3u8(m3u8Text, baseUrl, ref, origin, ua) {
    var lines = String(m3u8Text || '').split(/\r?\n/);
    var out = [];

    function wrapUrl(rawUri) {
        var resolved = urlModule.resolve(baseUrl, rawUri.trim());
        var q = 'url=' + encodeURIComponent(resolved);
        if (ref) q += '&ref=' + encodeURIComponent(ref);
        if (origin) q += '&origin=' + encodeURIComponent(origin);
        if (ua) q += '&ua=' + encodeURIComponent(ua);
        return 'http://127.0.0.1:' + PORT + '/proxy/stream?' + q;
    }

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var trimmed = line.trim();
        if (!trimmed) {
            out.push(line);
            continue;
        }
        if (trimmed.charAt(0) === '#') {
            // Rewrite URI="..." inside #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA
            if (trimmed.indexOf('URI="') >= 0) {
                line = line.replace(/URI="([^"]+)"/g, function (_, uriVal) {
                    return 'URI="' + wrapUrl(uriVal) + '"';
                });
            }
            out.push(line);
        } else {
            out.push(wrapUrl(trimmed));
        }
    }
    return out.join('\n');
}

// ---- Injected Client Script for Proxied Streaming Sites ----
function buildInjectedPageScript(pageUrl, autoSearchQuery) {
    var safeUrl = JSON.stringify(pageUrl || '');
    var safeQuery = JSON.stringify(autoSearchQuery || '');
    return [
        "<script>",
        "(function(){",
        "  if (window.__fmhyProxyInit) return;",
        "  window.__fmhyProxyInit = true;",
        "  var PAGE_URL = " + safeUrl + ";",
        "  var AUTO_Q = " + safeQuery + ";",
        "  var SERVICE_BASE = 'http://127.0.0.1:" + PORT + "';",
        "  function postService(path, data) {",
        "    try {",
        "      var x = new XMLHttpRequest();",
        "      x.open('POST', SERVICE_BASE + path, true);",
        "      x.setRequestHeader('Content-Type', 'application/json');",
        "      x.send(JSON.stringify(data));",
        "    } catch(e) {}",
        "    try {",
        "      if (window.top && window.top !== window) {",
        "        window.top.postMessage({ __fmhy_event: path, data: data }, '*');",
        "      }",
        "    } catch(e) {}",
        "  }",
        "  window.FMHY = {",
        "    stream: function(url, dash, referer, origin) {",
        "      postService('/api/sniffer/report', { type: 'stream', url: url, dash: !!dash, referer: referer || PAGE_URL, origin: origin || '' });",
        "    },",
        "    servers: function(jsonStr) {",
        "      try { postService('/api/sniffer/report', { type: 'servers', items: JSON.parse(jsonStr) }); } catch(e) {}",
        "    },",
        "    scanDone: function() {",
        "      postService('/api/sniffer/report', { type: 'scanDone' });",
        "    },",
        "    openNative: function() {",
        "      postService('/api/sniffer/report', { type: 'openNative' });",
        "    },",
        "    searched: function() {",
        "      postService('/api/sniffer/report', { type: 'searched' });",
        "    },",
        "    poster: function(src) {",
        "      postService('/api/sniffer/report', { type: 'poster', poster: src });",
        "    },",
        "    cleanVideo: function() { return true; },",
        "    pointer: function() { return !!window.__fmhyPointerOn; },",
        "    clicked: function(href) { window.__fmhyLastClicked = href; }",
        "  };",
        "  // Block popup windows",
        "  window.open = function(u) { return null; };",
        "  // Watch URLs for .m3u8 / .mpd / .vtt / .srt",
        "  function checkUrl(u) {",
        "    if (!u || typeof u !== 'string') return;",
        "    try {",
        "      var full = new URL(u, PAGE_URL).href;",
        "      var clean = full.split('?')[0].split('#')[0].toLowerCase();",
        "      if (clean.slice(-5) === '.m3u8') window.FMHY.stream(full, false, PAGE_URL, '');",
        "      else if (clean.slice(-4) === '.mpd') window.FMHY.stream(full, true, PAGE_URL, '');",
        "      else if (clean.slice(-4) === '.vtt' || clean.slice(-4) === '.srt') postService('/api/sniffer/report', { type: 'sub', url: full });",
        "    } catch(e) {}",
        "  }",
        "  var origOpen = XMLHttpRequest.prototype.open;",
        "  XMLHttpRequest.prototype.open = function(method, url) {",
        "    checkUrl(url);",
        "    this.addEventListener('load', function() {",
        "      try {",
        "        var rt = this.responseType;",
        "        if (rt === '' || rt === 'text') {",
        "          var head = String(this.responseText || '').slice(0, 64);",
        "          if (/^\\s*#EXTM3U/.test(head)) window.FMHY.stream(this.responseURL || url, false, PAGE_URL, '');",
        "          else if (/^\\s*(<\\?xml[^>]*>\\s*)?<MPD[\\s>]/.test(head)) window.FMHY.stream(this.responseURL || url, true, PAGE_URL, '');",
        "        }",
        "      } catch(e) {}",
        "    });",
        "    return origOpen.apply(this, arguments);",
        "  };",
        "  if (window.fetch) {",
        "    var origFetch = window.fetch;",
        "    window.fetch = function(input) {",
        "      var u = typeof input === 'string' ? input : (input && input.url) || '';",
        "      checkUrl(u);",
        "      var p = origFetch.apply(this, arguments);",
        "      p.then(function(r) {",
        "        try {",
        "          checkUrl(r.url);",
        "          var ct = (r.headers && r.headers.get('content-type')) || '';",
        "          if (/mpegurl|dash\\+xml/i.test(ct)) window.FMHY.stream(r.url || u, /dash/i.test(ct), PAGE_URL, '');",
        "        } catch(e) {}",
        "      }).catch(function(){});",
        "      return p;",
        "    };",
        "  }",
        "  // Watch <video> and <source> elements",
        "  setInterval(function() {",
        "    var vids = document.querySelectorAll('video, source');",
        "    for (var i = 0; i < vids.length; i++) {",
        "      var s = vids[i].currentSrc || vids[i].src;",
        "      if (s && s.indexOf('blob:') !== 0) checkUrl(s);",
        "    }",
        "  }, 1000);",
        "  // Auto-search title if AUTO_Q is set",
        "  if (AUTO_Q) {",
        "    var tries = 0, openedSearch = false;",
        "    var searchTimer = setInterval(function() {",
        "      var inputs = document.querySelectorAll('input');",
        "      var targetInput = null;",
        "      for (var k = 0; k < inputs.length; k++) {",
        "        var inp = inputs[k];",
        "        if (/^(hidden|checkbox|radio|button|submit|file|password|email|number|date)$/i.test(inp.type)) continue;",
        "        var rect = inp.getBoundingClientRect();",
        "        if (rect.width > 30 && rect.height > 12) {",
        "          var lbl = [inp.placeholder, inp.name, inp.id, inp.getAttribute('aria-label'), inp.className].join(' ');",
        "          if (inp.type === 'search' || /search|find|title|movie|show|query|\\bq\\b/i.test(lbl)) { targetInput = inp; break; }",
        "        }",
        "      }",
        "      if (targetInput) {",
        "        clearInterval(searchTimer);",
        "        targetInput.focus();",
        "        targetInput.value = AUTO_Q;",
        "        targetInput.dispatchEvent(new Event('input', { bubbles: true }));",
        "        targetInput.dispatchEvent(new Event('change', { bubbles: true }));",
        "        ['keydown', 'keypress', 'keyup'].forEach(function(t) {",
        "          targetInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));",
        "        });",
        "        if (targetInput.form && targetInput.form.submit) { try { targetInput.form.submit(); } catch(e) {} }",
        "        window.FMHY.searched();",
        "        return;",
        "      }",
        "      if (++tries > 3 && !openedSearch) {",
        "        var btns = document.querySelectorAll('button,a,[role=button]');",
        "        for (var b = 0; b < btns.length; b++) {",
        "          var bl = [btns[b].getAttribute('aria-label'), btns[b].title, btns[b].className, btns[b].innerText].join(' ');",
        "          if (/search/i.test(bl)) { openedSearch = true; btns[b].click(); break; }",
        "        }",
        "      }",
        "      if (tries > 25) clearInterval(searchTimer);",
        "    }, 350);",
        "  }",
        "})();",
        "</script>"
    ].join('\n');
}

// ---- Probe a single IPTV stream ----
function probeChannel(channelUrl, ua, ref, callback) {
    var headers = {
        'User-Agent': ua || DEFAULT_UA
    };
    if (ref) headers['Referer'] = ref;

    var done = false;
    function finish(ok) {
        if (done) return;
        done = true;
        callback(ok);
    }

    requestRaw(channelUrl, { headers: headers, timeout: 6000 }, function (err, res, stream) {
        if (err || !res) return finish(false);
        var code = res.statusCode || 0;
        if (code >= 300 && code < 400) {
            res.resume();
            return finish(true);
        }
        if (code >= 400) {
            res.resume();
            return finish(false);
        }
        var chunks = [];
        var total = 0;
        stream.on('data', function (chunk) {
            total += chunk.length;
            chunks.push(chunk);
            if (total >= 256) {
                res.destroy();
                var head = Buffer.concat(chunks).toString('utf8', 0, Math.min(total, 256)).trim().toLowerCase();
                finish(head.length > 0 && head.indexOf('<!doctype') !== 0 && head.indexOf('<html') !== 0);
            }
        });
        stream.on('end', function () {
            if (total === 0) return finish(false);
            var head = Buffer.concat(chunks).toString('utf8', 0, Math.min(total, 256)).trim().toLowerCase();
            finish(head.length > 0 && head.indexOf('<!doctype') !== 0 && head.indexOf('<html') !== 0);
        });
        stream.on('error', function () {
            finish(total > 0);
        });
    });
}

// ---- Read JSON Body Helper ----
function readJsonBody(req, callback) {
    var body = '';
    req.on('data', function (chunk) {
        body += chunk.toString();
        if (body.length > 10 * 1024 * 1024) req.destroy();
    });
    req.on('end', function () {
        if (!body) return callback(null, {});
        try {
            callback(null, JSON.parse(body));
        } catch (e) {
            callback(e);
        }
    });
}

function sendJson(res, statusCode, obj) {
    var payload = JSON.stringify(obj);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'no-store'
    });
    res.end(payload);
}

// ---- HTTP Server ----
var server = http.createServer(function (req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    var parsedReq = urlModule.parse(req.url, true);
    var pathname = parsedReq.pathname || '/';
    var query = parsedReq.query || {};

    // 1. Health / Ping
    if (pathname === '/api/ping') {
        return sendJson(res, 200, {
            ok: true,
            service: 'fmhyplay-tizen-service',
            version: '1.0.0',
            node: process.version
        });
    }

    // 2. Persistent State Read/Write
    if (pathname === '/api/state') {
        if (req.method === 'GET') {
            return sendJson(res, 200, readState());
        }
        if (req.method === 'POST') {
            return readJsonBody(req, function (err, data) {
                if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
                var saved = writeState(data);
                return sendJson(res, 200, { ok: saved });
            });
        }
    }

    // 3. Sniffer API
    if (pathname === '/api/sniffer/poll') {
        var clickKey = snifferState.pendingClickKey;
        snifferState.pendingClickKey = null;
        return sendJson(res, 200, {
            manifests: snifferState.manifests,
            subtitles: snifferState.subtitles,
            servers: snifferState.servers,
            qualities: snifferState.qualities,
            poster: snifferState.poster,
            pageTitle: snifferState.pageTitle,
            pageUrl: snifferState.pageUrl,
            pendingClickKey: clickKey,
            updatedAt: snifferState.updatedAt
        });
    }

    if (pathname === '/api/sniffer/clear' && req.method === 'POST') {
        resetSniffer();
        return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/sniffer/click' && req.method === 'POST') {
        return readJsonBody(req, function (err, body) {
            if (!err && body && body.key) {
                snifferState.pendingClickKey = body.key;
                snifferState.manifests = [];
                snifferState.updatedAt = Date.now();
            }
            return sendJson(res, 200, { ok: true });
        });
    }

    if (pathname === '/api/sniffer/report' && req.method === 'POST') {
        return readJsonBody(req, function (err, body) {
            if (err || !body) return sendJson(res, 400, { ok: false });
            if (body.type === 'stream' && body.url) {
                recordManifest(body.url, !!body.dash, {
                    Referer: body.referer || '',
                    Origin: body.origin || ''
                });
            } else if (body.type === 'sub' && body.url) {
                recordSubtitle(body.url);
            } else if (body.type === 'servers' && Array.isArray(body.items)) {
                for (var i = 0; i < body.items.length; i++) {
                    var it = body.items[i];
                    if (!it || !it.k || !it.label) continue;
                    var targetList = it.kind === 'q' ? snifferState.qualities : snifferState.servers;
                    var exists = false;
                    for (var j = 0; j < targetList.length; j++) {
                        if (targetList[j].k === it.k) {
                            targetList[j] = it;
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) targetList.push(it);
                }
                snifferState.updatedAt = Date.now();
            } else if (body.type === 'poster' && body.poster) {
                snifferState.poster = body.poster;
                snifferState.updatedAt = Date.now();
            }
            return sendJson(res, 200, { ok: true });
        });
    }

    // 4. Generic CORS-free Fetcher (/api/fetch)
    if (pathname === '/api/fetch') {
        if (req.method === 'GET') {
            var target = query.url;
            if (!target) return sendJson(res, 400, { error: 'Missing url parameter' });
            var customHeaders = {};
            if (query.ua) customHeaders['User-Agent'] = query.ua;
            if (query.ref) customHeaders['Referer'] = query.ref;
            return fetchBuffer(target, { headers: customHeaders }, function (err, uRes, buf, finalUrl) {
                if (err) return sendJson(res, 502, { error: err.message });
                res.writeHead(uRes.statusCode || 200, {
                    'Content-Type': uRes.headers['content-type'] || 'text/plain; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'X-Final-Url': finalUrl || target
                });
                res.end(buf);
            });
        }
        if (req.method === 'POST') {
            return readJsonBody(req, function (err, body) {
                if (err || !body || !body.url) return sendJson(res, 400, { error: 'Missing url in body' });
                fetchBuffer(body.url, {
                    method: body.method || 'GET',
                    headers: body.headers || {},
                    body: body.body || null
                }, function (fErr, uRes, buf, finalUrl) {
                    if (fErr) return sendJson(res, 502, { error: fErr.message });
                    return sendJson(res, 200, {
                        status: uRes.statusCode || 200,
                        finalUrl: finalUrl || body.url,
                        headers: uRes.headers || {},
                        body: buf.toString('utf8')
                    });
                });
            });
        }
    }

    // 5. IPTV Channel Health Probe (/api/probe & /api/probe-batch)
    if (pathname === '/api/probe') {
        var pUrl = query.url;
        if (!pUrl) return sendJson(res, 400, { ok: false });
        return probeChannel(pUrl, query.ua, query.ref, function (works) {
            return sendJson(res, 200, { url: pUrl, ok: works });
        });
    }

    if (pathname === '/api/probe-batch' && req.method === 'POST') {
        return readJsonBody(req, function (err, body) {
            if (err || !body || !Array.isArray(body.channels)) {
                return sendJson(res, 400, { results: {} });
            }
            var list = body.channels.slice(0, 32);
            var results = {};
            var remaining = list.length;
            if (remaining === 0) return sendJson(res, 200, { results: results });

            for (var i = 0; i < list.length; i++) {
                (function (ch) {
                    var u = typeof ch === 'string' ? ch : ch.url;
                    var ua = (ch && ch.ua) || '';
                    var ref = (ch && ch.ref) || '';
                    probeChannel(u, ua, ref, function (works) {
                        results[u] = works;
                        remaining--;
                        if (remaining === 0) {
                            sendJson(res, 200, { results: results });
                        }
                    });
                })(list[i]);
            }
        });
    }

    // 6. Stream Proxy (/proxy/stream) - replays Referer/Origin/User-Agent and rewrites M3U8 manifests
    if (pathname === '/proxy/stream') {
        var streamUrl = query.url;
        if (!streamUrl) {
            res.writeHead(400);
            return res.end('Missing url');
        }
        var ref = query.ref || '';
        var origin = query.origin || '';
        var ua = query.ua || CHROME_UA;
        var forceVtt = query.vtt === '1';

        var sHeaders = {
            'User-Agent': ua
        };
        if (ref) sHeaders['Referer'] = ref;
        if (origin) sHeaders['Origin'] = origin;
        if (req.headers['range']) sHeaders['Range'] = req.headers['range'];

        var cleanStreamPath = streamUrl.split('?')[0].split('#')[0].toLowerCase();
        var looksLikeM3u8 = cleanStreamPath.slice(-5) === '.m3u8' || cleanStreamPath.slice(-4) === '.m3u';
        var looksLikeSrt = forceVtt || cleanStreamPath.slice(-4) === '.srt' || cleanStreamPath.slice(-4) === '.vtt';

        if (looksLikeM3u8 || looksLikeSrt) {
            return fetchBuffer(streamUrl, { headers: sHeaders }, function (err, uRes, buf, finalUrl) {
                if (err || !uRes) {
                    res.writeHead(502);
                    return res.end('Stream proxy error');
                }
                var text = buf.toString('utf8');
                if (looksLikeSrt || (forceVtt && text.indexOf('#EXTM3U') !== 0)) {
                    var vtt = srtToVtt(text);
                    res.writeHead(200, {
                        'Content-Type': 'text/vtt; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    });
                    return res.end(vtt);
                }
                if (text.trim().indexOf('#EXTM3U') === 0) {
                    var rewritten = rewriteM3u8(text, finalUrl || streamUrl, ref, origin, ua);
                    res.writeHead(200, {
                        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'no-cache'
                    });
                    return res.end(rewritten);
                }
                res.writeHead(uRes.statusCode || 200, {
                    'Content-Type': uRes.headers['content-type'] || 'application/octet-stream',
                    'Access-Control-Allow-Origin': '*'
                });
                return res.end(buf);
            });
        }

        // Direct pipe for binary segments (.ts, .m4s, .mp4, etc.), but peek first 16 bytes in case an extensionless URL is actually an #EXTM3U playlist
        return requestRaw(streamUrl, { headers: sHeaders, decompress: false }, function (err, uRes, stream, finalUrl) {
            if (err || !uRes) {
                res.writeHead(502);
                return res.end('Upstream error');
            }
            var ct = (uRes.headers['content-type'] || '').toLowerCase();
            if (ct.indexOf('mpegurl') >= 0) {
                var mChunks = [];
                stream.on('data', function (c) { mChunks.push(c); });
                stream.on('end', function () {
                    var rawM3u = Buffer.concat(mChunks).toString('utf8');
                    var rewritten = rewriteM3u8(rawM3u, finalUrl || streamUrl, ref, origin, ua);
                    res.writeHead(200, {
                        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(rewritten);
                });
                return;
            }

            var outHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': uRes.headers['content-type'] || 'video/mp2t'
            };
            if (uRes.headers['content-length']) outHeaders['Content-Length'] = uRes.headers['content-length'];
            if (uRes.headers['content-range']) outHeaders['Content-Range'] = uRes.headers['content-range'];
            if (uRes.headers['accept-ranges']) outHeaders['Accept-Ranges'] = uRes.headers['accept-ranges'];

            res.writeHead(uRes.statusCode || 200, outHeaders);
            stream.pipe(res);
            req.on('close', function () {
                try { uRes.destroy(); } catch (e) {}
            });
        });
    }

    // 7. Web Page Reverse Proxy (/proxy/page) - strips X-Frame-Options/CSP and injects FMHY sniffer & navigation
    if (pathname === '/proxy/page') {
        var pageUrl = query.url;
        if (!pageUrl) {
            res.writeHead(400);
            return res.end('Missing url');
        }
        var parsedTarget = urlModule.parse(pageUrl);
        if (query.adblock !== '0' && parsedTarget.hostname && isDomainBlocked(parsedTarget.hostname)) {
            res.writeHead(204);
            return res.end();
        }

        return fetchBuffer(pageUrl, {
            headers: {
                'User-Agent': CHROME_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': query.ref || (parsedTarget.protocol + '//' + parsedTarget.host + '/')
            }
        }, function (err, uRes, buf, finalUrl) {
            if (err || !uRes) {
                res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
                return res.end('<html><body style="background:#120e1a;color:#f2edf7;font-family:sans-serif;padding:40px;"><h2>Could not load site</h2><p>' + (err ? err.message : 'Unknown error') + '</p></body></html>');
            }
            var effectiveUrl = finalUrl || pageUrl;
            var ct = (uRes.headers['content-type'] || '').toLowerCase();
            var rawText = buf.toString('utf8');

            if (rawText.trim().indexOf('#EXTM3U') === 0 || ct.indexOf('mpegurl') >= 0) {
                recordManifest(effectiveUrl, false, { Referer: pageUrl });
            } else if (ct.indexOf('dash+xml') >= 0) {
                recordManifest(effectiveUrl, true, { Referer: pageUrl });
            }

            if (ct.indexOf('text/html') >= 0 || rawText.trim().slice(0, 15).toLowerCase().indexOf('<!doctype') === 0 || rawText.trim().slice(0, 6).toLowerCase().indexOf('<html') === 0) {
                snifferState.pageUrl = effectiveUrl;
                var baseTag = '<base href="' + effectiveUrl.replace(/"/g, '&quot;') + '">';
                var injectScript = buildInjectedPageScript(effectiveUrl, query.q || '');
                var modifiedHtml = rawText;
                if (/<head[^>]*>/i.test(modifiedHtml)) {
                    modifiedHtml = modifiedHtml.replace(/<head[^>]*>/i, function (m) {
                        return m + '\n' + baseTag + '\n' + injectScript;
                    });
                } else {
                    modifiedHtml = baseTag + '\n' + injectScript + '\n' + modifiedHtml;
                }
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                });
                return res.end(modifiedHtml);
            }

            res.writeHead(uRes.statusCode || 200, {
                'Content-Type': uRes.headers['content-type'] || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*'
            });
            return res.end(buf);
        });
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.on('error', function (e) {
    console.error('FMHYPlay Service Server Error:', e);
});

server.listen(PORT, '127.0.0.1', function () {
    console.log('FMHYPlay TizenBrew Service listening on http://127.0.0.1:' + PORT);
});
