"use strict";

/**
 * FMHYPlay Core Data Layer for Tizen TV
 * Ports Sites.java, Cats.java, Catalog.java, Iptv.java, Subs.java, Simkl.java, History.java, AdBlock.java
 */

window.FMHYData = (function () {
  var SERVICE_URL = "http://127.0.0.1:8087";
  var serviceOnline = false;

  // Deterministic card color from string (matches Home.colorFor)
  function colorFor(str) {
    var s = String(str || "FMHY");
    var hash = 0;
    for (var i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }
    var hue = Math.abs(hash) % 360;
    return "hsl(" + hue + ", 38%, 24%)";
  }

  // ---- Persistent Storage (localStorage + TizenBrew service disk sync) ----
  var memStore = {};
  try {
    var rawLocal = localStorage.getItem("fmhyplay_store");
    if (rawLocal) memStore = JSON.parse(rawLocal) || {};
  } catch (e) {}

  var Store = {
    get: function (key, defVal) {
      return memStore[key] !== undefined ? memStore[key] : defVal;
    },
    set: function (key, val) {
      memStore[key] = val;
      try {
        localStorage.setItem("fmhyplay_store", JSON.stringify(memStore));
      } catch (e) {}
      if (serviceOnline) {
        var patch = {};
        patch[key] = val;
        fetch(SERVICE_URL + "/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        }).catch(function () {});
      }
    },
    remove: function (key) {
      delete memStore[key];
      try {
        localStorage.setItem("fmhyplay_store", JSON.stringify(memStore));
      } catch (e) {}
      if (serviceOnline) {
        var patch = {};
        patch[key] = null;
        fetch(SERVICE_URL + "/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        }).catch(function () {});
      }
    }
  };

  // Check TizenBrew Node.js background service
  function initService() {
    return fetch(SERVICE_URL + "/api/ping")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          serviceOnline = true;
          return fetch(SERVICE_URL + "/api/state")
            .then(function (r2) { return r2.json(); })
            .then(function (diskState) {
              if (diskState && typeof diskState === "object") {
                var keys = Object.keys(diskState);
                for (var i = 0; i < keys.length; i++) {
                  var k = keys[i];
                  if (diskState[k] !== null && diskState[k] !== undefined && memStore[k] === undefined) {
                    memStore[k] = diskState[k];
                  }
                }
                try {
                  localStorage.setItem("fmhyplay_store", JSON.stringify(memStore));
                } catch (e) {}
              }
              return true;
            });
        }
        return false;
      })
      .catch(function () {
        serviceOnline = false;
        return false;
      });
  }

  // Universal text fetcher (uses TizenBrew service when online or when custom headers/HTTP needed, else direct fetch)
  function fetchText(url, opts) {
    opts = opts || {};
    var needsService = opts.forceService || (url.indexOf("http://") === 0 && location.protocol === "https:") || opts.ua || opts.ref || opts.method === "POST";
    if (serviceOnline && (needsService || opts.useService !== false)) {
      if (opts.method === "POST" || opts.headers || opts.body) {
        return fetch(SERVICE_URL + "/api/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: url,
            method: opts.method || "GET",
            headers: opts.headers || {},
            body: opts.body || null
          })
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.error) throw new Error(res.error);
            return res.body || "";
          });
      }
      var q = SERVICE_URL + "/api/fetch?url=" + encodeURIComponent(url);
      if (opts.ua) q += "&ua=" + encodeURIComponent(opts.ua);
      if (opts.ref) q += "&ref=" + encodeURIComponent(opts.ref);
      return fetch(q).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      });
    }
    var fetchOpts = { method: opts.method || "GET" };
    if (opts.headers) fetchOpts.headers = opts.headers;
    if (opts.body) fetchOpts.body = opts.body;
    return fetch(url, fetchOpts).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  function proxyStreamUrl(url, headers, forceVtt) {
    if (!url) return "";
    if (!serviceOnline) return url;
    var q = SERVICE_URL + "/proxy/stream?url=" + encodeURIComponent(url);
    if (headers) {
      if (headers["Referer"] || headers["referer"]) q += "&ref=" + encodeURIComponent(headers["Referer"] || headers["referer"]);
      if (headers["Origin"] || headers["origin"]) q += "&origin=" + encodeURIComponent(headers["Origin"] || headers["origin"]);
      if (headers["User-Agent"] || headers["user-agent"]) q += "&ua=" + encodeURIComponent(headers["User-Agent"] || headers["user-agent"]);
    }
    if (forceVtt) q += "&vtt=1";
    return q;
  }

  function proxyPageUrl(url, searchQuery) {
    if (!url) return "";
    if (!serviceOnline) return url;
    var adblock = Store.get("adblock", true) ? "1" : "0";
    var q = SERVICE_URL + "/proxy/page?url=" + encodeURIComponent(url) + "&adblock=" + adblock;
    if (searchQuery) q += "&q=" + encodeURIComponent(searchQuery);
    return q;
  }

  // ---- Cats.java Port ----
  var Cats = {
    MOVIES: "Movies",
    TV: "TV",
    SPORTS: "Sports",
    ANIME: "Anime",
    LIVE: "Live TV",
    MORE: "More",
    ORDER: ["Movies", "TV", "Sports", "Anime", "Live TV", "More"],
    of: function (section, tags) {
      var out = [];
      function add(c) {
        if (out.indexOf(c) < 0) out.push(c);
      }
      if (section === "Anime Streaming") return [Cats.ANIME];
      if (section === "Live Sports" || section === "Sports Replays") return [Cats.SPORTS];
      if (section === "Stream Lounges" || section === "Specialty Streaming") return [Cats.MORE];
      if (section === "Live TV") {
        out.push(Cats.LIVE);
        for (var i = 0; i < tags.length; i++) {
          if (/(sport|football|motorsport|mma|wrestling|boxing|basketball|baseball|live event)/i.test(tags[i])) {
            add(Cats.SPORTS);
          }
        }
        return out;
      }
      if (section === "Cartoon Streaming" || section === "Drama Streaming" || section === "TV Streaming") {
        out.push(Cats.TV);
      } else if (
        section !== "Stream Aggregators" &&
        section !== "P-Stream Forks" &&
        section !== "Dedicated-Server" &&
        section !== "Multi-Server" &&
        section !== "Video Streaming" &&
        section !== "Free w/ Ads" &&
        section !== "Classics / Public Domain" &&
        section !== "Film Archives"
      ) {
        return out;
      }
      for (var j = 0; j < tags.length; j++) {
        var t = String(tags[j] || "").toLowerCase();
        if (/(movie|film)/.test(t)) add(Cats.MOVIES);
        if (/(\btv\b|shows?|series|cartoon|drama)/.test(t)) add(Cats.TV);
        if (/(anime|donghua)/.test(t)) add(Cats.ANIME);
        if (/(sport|football|motorsport|mma|wrestling|boxing|basketball|baseball|live event)/.test(t)) add(Cats.SPORTS);
      }
      if (out.length === 0) {
        var isMovieSec = section === "Classics / Public Domain" || section === "Film Archives" || section === "Video Streaming";
        out.push(isMovieSec ? Cats.MOVIES : Cats.MORE);
      }
      return out;
    }
  };

  // ---- Sites.java Port ----
  var SOURCE_VIDEO = "https://raw.githubusercontent.com/fmhy/edit/main/docs/video.md";
  var SOURCE_LANG = "https://raw.githubusercontent.com/fmhy/edit/main/docs/non-english.md";
  var ENTRY_RE = /^\*\s*(⭐|🌟|🌐)?\s*(?:\*\*)?\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(?:\*\*)?(.*)$/;
  var ANY_LINK_RE = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  var LINK_STRIP_RE = /\[[^\]]*\]\([^)]*\)/g;
  var INTERNAL_RE = /^https?:\/\/(?:www\.)?(?:reddit\.com\/r\/freemediaheckyeah|fmhy\.|rentry\.(?:co|org)\/fmhy|github\.com|raw\.githubusercontent\.com|gist\.github\.com|t\.me\/|discord\.gg)/i;

  var DEFAULT_DEEPLINKS = {
    "cinejoy.pk": { "movie": "/movie/{tmdb}", "tv": "/series/{tmdb}" },
    "movy.sx": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "7movies.ac": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "arrowtv.net": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "chillflix.lol": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "popwatch.to": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "kaitotv.com": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "cinebytv.com": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "cineby.app": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "cineby.ru": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "rivestream.org": { "movie": "/watch?type=movie&id={tmdb}", "tv": "/watch?type=tv&id={tmdb}" },
    "rivestream.live": { "movie": "/watch?type=movie&id={tmdb}", "tv": "/watch?type=tv&id={tmdb}" },
    "streamgoblin.cc": { "movie": "/movie/{tmdb}", "tv": "/tv/{tmdb}" },
    "cno.to": { "movie": "/movie/{tmdb}", "tv": "/show/{tmdb}" },
    "consumit.online": { "movie": "/title/{tmdb}", "tv": "/series/{tmdb}" },
    "meowly.qzz.io": { "movie": "/watch/movie/{tmdb}" },
    "nexa.mov": { "movie": "/watch/tmdb-movie/{tmdb}", "tv": "/watch/tmdb-tv/{tmdb}" },
    "cinecat.eu": { "movie": "/media/tmdb-movie-{tmdb}", "tv": "/media/tmdb-tv-{tmdb}" },
    "aether.st": { "movie": "/media/tmdb-movie-{tmdb}", "tv": "/media/tmdb-tv-{tmdb}" },
    "basementx.lol": { "movie": "/media/tmdb-movie-{tmdb}", "tv": "/media/tmdb-tv-{tmdb}" },
    "cinefork.net": { "movie": "/media/tmdb-movie-{tmdb}", "tv": "/media/tmdb-tv-{tmdb}" },
    "streamwatch.online": { "movie": "/media/tmdb-movie-{tmdb}", "tv": "/media/tmdb-tv-{tmdb}" },
    "peestream.in": { "movie": "/media/tmdb-movie-{tmdb}", "tv": "/media/tmdb-tv-{tmdb}" },
    "fmfau.com": { "movie": "/media/tmdb-movie-{tmdb}", "tv": "/media/tmdb-tv-{tmdb}" },
    "kdesa.stream": { "movie": "/media/tmdb-movie-{tmdb}" }
  };

  // Built-in TV Embed Servers for 1-click Catalog Movie/Episode playback
  var EMBED_SERVERS = [
    {
      name: "VidSrc Pro",
      movie: "https://vidsrc.cc/v2/embed/movie/{id}",
      tv: "https://vidsrc.cc/v2/embed/tv/{id}/{s}/{e}"
    },
    {
      name: "VidLink",
      movie: "https://vidlink.pro/movie/{tmdb}?autoplay=true",
      tv: "https://vidlink.pro/tv/{tmdb}/{s}/{e}?autoplay=true"
    },
    {
      name: "AutoEmbed",
      movie: "https://player.autoembed.cc/embed/movie/{id}",
      tv: "https://player.autoembed.cc/embed/tv/{id}/{s}/{e}"
    },
    {
      name: "VidSrc XYZ",
      movie: "https://vidsrc.xyz/embed/movie/{id}",
      tv: "https://vidsrc.xyz/embed/tv/{id}/{s}-{e}"
    },
    {
      name: "MultiEmbed",
      movie: "https://multiembed.mov/?video_id={id}",
      tv: "https://multiembed.mov/?video_id={id}&s={s}&e={e}"
    },
    {
      name: "2Embed",
      movie: "https://www.2embed.cc/embed/{id}",
      tv: "https://www.2embed.cc/embedtv/{id}&s={s}&e={e}"
    }
  ];

  var parsedSitesCache = null;
  var parsedLangsCache = null;

  function parseEntry(line, group) {
    var m = ENTRY_RE.exec(String(line || "").trim());
    if (!m || INTERNAL_RE.test(m[3])) return null;
    var s = {
      index: m[1] === "🌐",
      pick: !!m[1] && m[1] !== "🌐",
      name: m[2].replace(/[\u2060\u200b]/g, "").trim(),
      url: m[3],
      tags: "",
      group: group || "",
      tagList: [],
      mirrors: []
    };
    var rest = m[4] || "";
    var dash = rest.indexOf(" - ");
    var head = dash >= 0 ? rest.substring(0, dash) : rest;
    var tail = dash >= 0 ? rest.substring(dash + 3) : "";

    ANY_LINK_RE.lastIndex = 0;
    var mm;
    while ((mm = ANY_LINK_RE.exec(head)) !== null) {
      if (!INTERNAL_RE.test(mm[1]) && mm[1] !== s.url) {
        s.mirrors.push(mm[1]);
      }
    }
    var rawTags = tail.replace(LINK_STRIP_RE, "").split("/");
    for (var i = 0; i < rawTags.length; i++) {
      var c = rawTags[i].replace(/[*_`]/g, "").trim();
      if (c && c !== "," && c !== "↪️") s.tagList.push(c);
    }
    s.tags = s.tagList.join(" · ");
    return s;
  }

  var Sites = {
    ROW_MAX: 14,
    EMBED_SERVERS: EMBED_SERVERS,
    deeplink: function (siteUrl, titleObj) {
      if (!siteUrl || !titleObj) return null;
      var host = "";
      try {
        host = new URL(siteUrl).hostname.replace(/^www\./, "");
      } catch (e) {
        return null;
      }
      var table = Object.assign({}, DEFAULT_DEEPLINKS, Store.get("deeplinks", {}) || {});
      var site = table[host];
      if (!site) return null;
      var isSeries = titleObj.type === "series";
      var tpl = site[isSeries ? "tv" : "movie"];
      var imdb = String(titleObj.id || "").indexOf("tt") === 0 ? titleObj.id : "";
      var tmdb = String(titleObj.tmdb || "");
      if (!tpl) return null;
      if (tpl.indexOf("{tmdb}") >= 0 && !tmdb) return null;
      if (tpl.indexOf("{imdb}") >= 0 && !imdb) return null;
      try {
        var u = new URL(siteUrl);
        return u.protocol + "//" + u.host + tpl.replace("{tmdb}", tmdb).replace("{imdb}", imdb);
      } catch (e) {
        return null;
      }
    },
    embedUrlsForTitle: function (titleObj, season, episode) {
      var id = titleObj.id || titleObj.tmdb || "";
      var tmdb = titleObj.tmdb || titleObj.id || "";
      var isSeries = titleObj.type === "series";
      var s = season || 1;
      var e = episode || 1;
      return EMBED_SERVERS.map(function (srv) {
        var tpl = isSeries ? srv.tv : srv.movie;
        var url = tpl
          .replace(/\{id\}/g, encodeURIComponent(id))
          .replace(/\{tmdb\}/g, encodeURIComponent(tmdb))
          .replace(/\{s\}/g, String(s))
          .replace(/\{e\}/g, String(e));
        return { name: srv.name, url: url };
      });
    },
    load: function () {
      if (parsedSitesCache) return parsedSitesCache;
      var out = {};
      for (var i = 0; i < Cats.ORDER.length; i++) out[Cats.ORDER[i]] = [];
      var md = Store.get("fmhy_video_md", "");
      if (!md) return out;
      var section = "";
      var lines = md.split("\n");
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (line.indexOf("#") === 0) {
          section = line.replace(/^[#\s►▷]+/, "").trim();
          continue;
        }
        var s = parseEntry(line, section);
        if (!s) continue;
        var cats = Cats.of(section, s.tagList);
        for (var k = 0; k < cats.length; k++) {
          var cat = cats[k];
          if (!Sites.has(out[cat], s.url)) out[cat].push(s);
        }
      }
      var catKeys = Object.keys(out);
      for (var m = 0; m < catKeys.length; m++) {
        var list = out[catKeys[m]];
        var picks = [], rest = [], indexes = [];
        for (var n = 0; n < list.length; n++) {
          var item = list[n];
          if (item.pick) picks.push(item);
          else if (item.index) indexes.push(item);
          else rest.push(item);
        }
        var combined = picks.concat(rest).concat(indexes);
        if (combined.length === 0) delete out[catKeys[m]];
        else out[catKeys[m]] = combined;
      }
      parsedSitesCache = out;
      return out;
    },
    languages: function () {
      if (parsedLangsCache) return parsedLangsCache;
      var out = {};
      var md = Store.get("fmhy_lang_md", "");
      if (!md) return out;
      var lang = null;
      var streaming = false;
      var lines = md.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf("# ") === 0) {
          lang = line.replace(/^[#\s►▷]+/, "").split(" / ")[0].trim();
          streaming = false;
        } else if (line.indexOf("#") === 0) {
          streaming = line.replace(/^[#\s►▷]+/, "").trim().toLowerCase().indexOf("streaming") === 0;
        } else if (lang && streaming) {
          var s = parseEntry(line, lang);
          if (!s) continue;
          if (!out[lang]) out[lang] = [];
          if (!Sites.has(out[lang], s.url)) out[lang].push(s);
        }
      }
      var lKeys = Object.keys(out);
      for (var k = 0; k < lKeys.length; k++) {
        var list = out[lKeys[k]];
        var picks = [], rest = [];
        for (var j = 0; j < list.length; j++) {
          if (list[j].pick) picks.push(list[j]);
          else rest.push(list[j]);
        }
        out[lKeys[k]] = picks.concat(rest);
      }
      parsedLangsCache = out;
      return out;
    },
    all: function () {
      var out = [];
      var byCat = Sites.load();
      Object.keys(byCat).forEach(function (c) {
        byCat[c].forEach(function (s) {
          if (!Sites.has(out, s.url)) out.push(s);
        });
      });
      var byLang = Sites.languages();
      Object.keys(byLang).forEach(function (l) {
        byLang[l].forEach(function (s) {
          if (!Sites.has(out, s.url)) out.push(s);
        });
      });
      Sites.favorites().forEach(function (s) {
        if (!Sites.has(out, s.url)) out.push(s);
      });
      return out;
    },
    has: function (list, url) {
      if (!list) return false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === url) return true;
      }
      return false;
    },
    stale: function () {
      var last = Store.get("fmhy_sites_ts", 0);
      return !Store.get("fmhy_video_md", "") || (Date.now() - last > 12 * 3600 * 1000);
    },
    refresh: function () {
      return Promise.all([
        fetchText(SOURCE_VIDEO).catch(function () { return ""; }),
        fetchText(SOURCE_LANG).catch(function () { return ""; })
      ]).then(function (res) {
        var videoMd = res[0];
        var langMd = res[1];
        var changed = false;
        if (videoMd && videoMd.indexOf("Streaming Sites") >= 0) {
          if (videoMd !== Store.get("fmhy_video_md", "")) changed = true;
          Store.set("fmhy_video_md", videoMd);
          parsedSitesCache = null;
        }
        if (langMd && langMd.indexOf("► ") >= 0) {
          if (langMd !== Store.get("fmhy_lang_md", "")) changed = true;
          Store.set("fmhy_lang_md", langMd);
          parsedLangsCache = null;
        }
        if (videoMd || langMd) {
          Store.set("fmhy_sites_ts", Date.now());
        }
        return changed;
      });
    },
    favorites: function () {
      return Store.get("favs", []) || [];
    },
    isFavorite: function (url) {
      var favs = Sites.favorites();
      for (var i = 0; i < favs.length; i++) {
        if (favs[i].url === url) return true;
      }
      return false;
    },
    toggleFavorite: function (site) {
      var favs = Sites.favorites().slice();
      var idx = -1;
      for (var i = 0; i < favs.length; i++) {
        if (favs[i].url === site.url) { idx = i; break; }
      }
      if (idx >= 0) {
        favs.splice(idx, 1);
      } else {
        favs.push({
          name: site.name,
          url: site.url,
          tags: site.tags || "",
          mirrors: site.mirrors || []
        });
      }
      Store.set("favs", favs);
      return idx < 0;
    },
    addCustom: function (raw) {
      var trimmed = String(raw || "").trim();
      if (!trimmed) return;
      var u = /^https?:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;
      var host = u;
      try {
        host = new URL(u).hostname.replace(/^www\./, "");
      } catch (e) {}
      var site = { name: host, url: u, tags: "Custom site", mirrors: [] };
      if (!Sites.isFavorite(u)) Sites.toggleFavorite(site);
    },
    clearFavorites: function () {
      Store.set("favs", []);
    }
  };

  // ---- Catalog.java Port (Cinemeta Public Catalog) ----
  var CINEMETA_BASE = "https://v3-cinemeta.strem.io";
  var catalogCache = {};

  function parseCatalogTitle(o, type) {
    if (!o) return null;
    var t = {
      id: o.id || "",
      tmdb: o.moviedb_id > 0 ? String(o.moviedb_id) : "",
      type: type || o.type || "movie",
      name: o.name || "",
      year: String(o.releaseInfo || o.year || ""),
      rating: String(o.imdbRating || ""),
      poster: String(o.poster || "").replace("/poster/small/", "/poster/medium/"),
      background: o.background || "",
      overview: o.description || "",
      runtime: o.runtime || "",
      genres: "",
      episodes: []
    };
    var g = o.genres || o.genre || [];
    if (Array.isArray(g)) t.genres = g.join(" · ");
    if (Array.isArray(o.videos)) {
      for (var i = 0; i < o.videos.length; i++) {
        var v = o.videos[i];
        var season = Number(v.season || 0);
        var number = Number(v.episode || v.number || 0);
        if (season < 1 || number < 1) continue;
        t.episodes.push({
          season: season,
          number: number,
          title: v.name || v.title || "",
          overview: v.overview || v.description || "",
          thumb: v.thumbnail || ""
        });
      }
      t.episodes.sort(function (a, b) {
        return a.season !== b.season ? a.season - b.season : a.number - b.number;
      });
    }
    return t;
  }

  var Catalog = {
    GENRES: [
      "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime",
      "Documentary", "Drama", "Family", "Fantasy", "History", "Horror",
      "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western"
    ],
    cached: function (type, extra) {
      var key = type + "|" + (extra || "");
      return catalogCache[key] || null;
    },
    list: function (type, extra) {
      extra = extra || "";
      var key = type + "|" + extra;
      if (catalogCache[key] && extra.indexOf("search=") !== 0) {
        return Promise.resolve(catalogCache[key]);
      }
      var path = "/catalog/" + type + "/top" + (extra ? "/" + extra : "") + ".json";
      return fetchText(CINEMETA_BASE + path, { useService: false })
        .catch(function () { return fetchText(CINEMETA_BASE + path, { forceService: true }); })
        .then(function (txt) {
          var data = JSON.parse(txt);
          var metas = (data && data.metas) || [];
          var out = [];
          for (var i = 0; i < metas.length; i++) {
            var item = parseCatalogTitle(metas[i], type);
            if (item && item.id && item.name) out.push(item);
          }
          if (extra.indexOf("search=") !== 0) catalogCache[key] = out;
          return out;
        })
        .catch(function () {
          return null;
        });
    },
    fill: function (titleObj) {
      var path = "/meta/" + titleObj.type + "/" + titleObj.id + ".json";
      return fetchText(CINEMETA_BASE + path, { useService: false })
        .catch(function () { return fetchText(CINEMETA_BASE + path, { forceService: true }); })
        .then(function (txt) {
          var full = parseCatalogTitle(JSON.parse(txt).meta, titleObj.type);
          if (!full) return titleObj;
          titleObj.overview = full.overview || titleObj.overview;
          titleObj.runtime = full.runtime || titleObj.runtime;
          titleObj.background = full.background || titleObj.background;
          titleObj.genres = full.genres || titleObj.genres;
          if (full.tmdb) titleObj.tmdb = full.tmdb;
          if (full.year) titleObj.year = full.year;
          if (full.rating) titleObj.rating = full.rating;
          titleObj.episodes = full.episodes || [];
          return titleObj;
        })
        .catch(function () {
          return titleObj;
        });
    },
    seasons: function (titleObj) {
      var max = 0;
      var eps = (titleObj && titleObj.episodes) || [];
      for (var i = 0; i < eps.length; i++) {
        if (eps[i].season > max) max = eps[i].season;
      }
      return max;
    },
    mine: function () {
      return Store.get("mylist", []) || [];
    },
    isMine: function (id) {
      var list = Catalog.mine();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return true;
      }
      return false;
    },
    toggleMine: function (t) {
      var old = Catalog.mine();
      var had = false;
      var kept = [];
      for (var i = 0; i < old.length; i++) {
        if (old[i].id === t.id) had = true;
        else kept.push(old[i]);
      }
      if (!had) {
        kept.unshift({
          id: t.id,
          tmdb: t.tmdb || "",
          type: t.type || "movie",
          name: t.name,
          year: t.year || "",
          rating: t.rating || "",
          poster: t.poster || ""
        });
      }
      Store.set("mylist", kept);
      return !had;
    }
  };

  // ---- Iptv.java Port ----
  var IPTV_MAIN = "https://iptv-org.github.io/iptv/index.m3u";
  var DEFAULT_EXTRAS = "https://raw.githubusercontent.com/fmhyplay/sources/main/sources.txt";
  var EMOJI_MAP = {
    "General": "📺", "Other": "🗂", "News": "📰", "Entertainment": "🎭",
    "Religious": "🙏", "Music": "🎵", "Movies": "🎬", "Series": "🎞",
    "Sports": "⚽", "Kids": "🧸", "Documentary": "🌍", "Legislative": "🏛",
    "Education": "🎓", "Comedy": "😂", "Culture": "🎨", "Lifestyle": "🌿",
    "Shop": "🛍", "Business": "💼", "Animation": "🐭", "Outdoor": "🏕",
    "Classic": "📻", "Travel": "✈️", "Family": "👨‍👩‍👧", "Cooking": "🍳",
    "Auto": "🚗", "Weather": "⛅", "Science": "🔬", "Public": "🏙",
    "Mature": "🔞", "My playlists": "📂", "Relax": "🧘", "Interactive": "🕹"
  };

  var COUNTRY_NAMES = {};
  try {
    if (window.Intl && Intl.DisplayNames) {
      var regionNames = new Intl.DisplayNames(["en"], { type: "region" });
      COUNTRY_NAMES._intl = regionNames;
    }
  } catch (e) {}

  function countryFromCode(code) {
    if (!code) return "";
    var c = code.toLowerCase();
    if (c === "uk") c = "gb";
    var up = c.toUpperCase();
    if (up.length !== 2) return up;
    try {
      if (COUNTRY_NAMES._intl) {
        return COUNTRY_NAMES._intl.of(up) || up;
      }
    } catch (e) {}
    return up;
  }

  function flagForCountryCode(code) {
    if (!code || code.length !== 2) return "🏳";
    var up = code.toUpperCase();
    return String.fromCodePoint(0x1F1E6 + up.charCodeAt(0) - 65) +
           String.fromCodePoint(0x1F1E6 + up.charCodeAt(1) - 65);
  }

  function extractAttr(line, key) {
    var k = key + '="';
    var idx = line.indexOf(k);
    while (idx >= 0) {
      if (idx === 0 || line.charAt(idx - 1) === " ") {
        var end = line.indexOf('"', idx + k.length);
        return end < 0 ? "" : line.substring(idx + k.length, end);
      }
      idx = line.indexOf(k, idx + 1);
    }
    return "";
  }

  function extractChannelName(line) {
    var quoted = false;
    var comma = -1;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) comma = i;
    }
    return comma < 0 ? "" : line.substring(comma + 1).trim();
  }

  function cleanStreamMacros(u) {
    var q = u.indexOf("?");
    if (q < 0 || u.indexOf("[", q) < 0) return u;
    var base = u.substring(0, q);
    var parts = u.substring(q + 1).split("&");
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var eq = p.indexOf("=");
      var v = eq < 0 ? "" : p.substring(eq + 1);
      if (v.charAt(0) === "[" && v.charAt(v.length - 1) === "]") continue;
      kept.push(p);
    }
    return kept.length ? base + "?" + kept.join("&") : base;
  }

  function parseM3u(text, isAdult) {
    var out = [];
    if (!text) return out;
    var c = null;
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf("#EXTINF") === 0) {
        c = {
          name: extractChannelName(line),
          logo: extractAttr(line, "tvg-logo"),
          ua: extractAttr(line, "http-user-agent"),
          ref: extractAttr(line, "http-referrer"),
          country: "",
          countryCode: "",
          group: extractAttr(line, "group-title"),
          source: "",
          playlist: "",
          cats: ["Other"],
          adult: !!isAdult
        };
        var id = extractAttr(line, "tvg-id");
        var dot = id.lastIndexOf(".");
        if (!isAdult && dot >= 0) {
          var rawCode = id.substring(dot + 1).replace(/@.*/, "");
          if (rawCode.toLowerCase() === "uk") rawCode = "gb";
          c.countryCode = rawCode.toUpperCase();
          c.country = countryFromCode(rawCode);
        }
        var grp = isAdult ? "Mature" : c.group;
        if (grp) c.cats = grp.split(";");
        if (c.cats[0] === "Undefined" || !c.cats[0]) c.cats = ["Other"];
      } else if (c && line.indexOf("#EXTVLCOPT:") === 0) {
        if (line.indexOf("http-referrer=") >= 0) c.ref = line.substring(line.indexOf("http-referrer=") + 14);
        else if (line.indexOf("http-user-agent=") >= 0) c.ua = line.substring(line.indexOf("http-user-agent=") + 16);
      } else if (c && line && line.charAt(0) !== "#") {
        var hasLetter = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF]/.test(c.name);
        var isOlero = /\bolero\b/i.test(c.name);
        if (line.indexOf("http") === 0 && hasLetter && !isOlero) {
          c.url = cleanStreamMacros(line);
          out.push(c);
        }
        c = null;
      }
    }
    return out;
  }

  var iptvMainRaw = "";
  var iptvChannelsCache = null;
  var countryFlagMap = {};

  var Iptv = {
    MINE: "My playlists",
    STREAMS: "My streams",
    ADULT_NAME: "Mature",
    loading: false,
    sweeping: false,
    sweepDone: 0,
    sweepTotal: 0,

    extrasUrl: function () {
      return Store.get("extrasUrl", DEFAULT_EXTRAS);
    },
    adultAvailable: function () {
      var extras = Store.get("iptv_extras_sources", []) || [];
      for (var i = 0; i < extras.length; i++) {
        if (extras[i].flag === "18") return true;
      }
      return false;
    },
    adultOn: function () {
      return Iptv.adultAvailable() && !!Store.get("adult", false);
    },
    hideDead: function () {
      return Store.get("hideDead", true) !== false;
    },
    isDead: function (url) {
      var health = Store.get("iptv_health", {}) || {};
      var v = health[url];
      return v !== undefined && v < 0 && (Date.now() + v < 2 * 24 * 3600 * 1000);
    },
    mark: function (url, works) {
      var health = Store.get("iptv_health", {}) || {};
      var now = Date.now();
      health[url] = works ? now : -now;
      Store.set("iptv_health", health);
    },
    played: function (url) {
      var health = Store.get("iptv_health", {}) || {};
      var good = Store.get("iptv_good", {}) || {};
      var now = Date.now();
      health[url] = now;
      good[url] = now;
      Store.set("iptv_health", health);
      Store.set("iptv_good", good);
    },
    forgetWorking: function (url) {
      var health = Store.get("iptv_health", {}) || {};
      var good = Store.get("iptv_good", {}) || {};
      delete health[url];
      delete good[url];
      Store.set("iptv_health", health);
      Store.set("iptv_good", good);
    },
    deadCount: function () {
      var all = Iptv.all(true);
      var n = 0;
      for (var i = 0; i < all.length; i++) {
        if (Iptv.isDead(all[i].url)) n++;
      }
      return n;
    },
    statusLine: function () {
      if (Iptv.sweeping) {
        return "Checking channels… " + Iptv.sweepDone + " of " + Iptv.sweepTotal + " tested, offline ones are hidden";
      }
      var dead = Iptv.deadCount();
      return dead > 0 && Iptv.hideDead() ? dead + " offline channels hidden" : "";
    },
    all: function (includeDead) {
      if (!iptvChannelsCache) {
        var out = parseM3u(iptvMainRaw, false);
        var myPlaylists = Store.get("iptv_mine_data", {}) || {};
        var myUrls = Iptv.mine();
        for (var i = 0; i < myUrls.length; i++) {
          var u = myUrls[i];
          var parsedMine = parseM3u(myPlaylists[u] || "", false);
          for (var j = 0; j < parsedMine.length; j++) {
            parsedMine[j].cats = [Iptv.MINE];
            parsedMine[j].playlist = u;
            out.push(parsedMine[j]);
          }
        }
        var extraData = Store.get("iptv_extra_m3u", {}) || {};
        var extraSources = Store.get("iptv_extras_sources", []) || [];
        for (var k = 0; k < extraSources.length; k++) {
          var src = extraSources[k];
          var isAd = src.flag === "18";
          var parsedExtra = parseM3u(extraData[src.url] || "", isAd);
          for (var m = 0; m < parsedExtra.length; m++) {
            parsedExtra[m].source = src.label;
            out.push(parsedExtra[m]);
          }
        }
        for (var cIdx = 0; cIdx < out.length; cIdx++) {
          if (out[cIdx].country && out[cIdx].countryCode && !countryFlagMap[out[cIdx].country]) {
            countryFlagMap[out[cIdx].country] = flagForCountryCode(out[cIdx].countryCode);
          }
        }
        out.sort(function (a, b) {
          return a.name.localeCompare(b.name);
        });
        iptvChannelsCache = out;
      }
      if (includeDead) return iptvChannelsCache.slice();
      var res = [];
      var hide = Iptv.hideDead();
      var allowAdult = Iptv.adultOn();
      for (var idx = 0; idx < iptvChannelsCache.length; idx++) {
        var ch = iptvChannelsCache[idx];
        if ((allowAdult || !ch.adult) && !(hide && Iptv.isDead(ch.url))) {
          res.push(ch);
        }
      }
      return res;
    },
    working: function () {
      var good = Store.get("iptv_good", {}) || {};
      var health = Store.get("iptv_health", {}) || {};
      var played = [], tested = [];
      var list = Iptv.all();
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (good[c.url]) played.push(c);
        else if ((health[c.url] || 0) > 0) tested.push(c);
      }
      played.sort(function (a, b) { return (good[b.url] || 0) - (good[a.url] || 0); });
      return played.concat(tested);
    },
    groups: function (by) {
      var m = {};
      var list = Iptv.all();
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var keys = by === "cat" ? c.cats : [c.country];
        for (var j = 0; j < keys.length; j++) {
          var k = keys[j];
          if (!k || (by === "cat" && k === Iptv.MINE)) continue;
          if (!m[k]) m[k] = [];
          m[k].push(c);
        }
      }
      var entries = Object.keys(m).map(function (k) { return [k, m[k]]; });
      if (by === "cat") {
        entries.sort(function (a, b) { return a[0].localeCompare(b[0]); });
      } else {
        entries.sort(function (a, b) { return b[1].length - a[1].length; });
      }
      var out = {};
      for (var e = 0; e < entries.length; e++) {
        out[entries[e][0]] = entries[e][1];
      }
      return out;
    },
    list: function (type, key) {
      if (type === "fav") return Iptv.favorites();
      if (type === "working") return Iptv.working();
      if (type === "mine") {
        return Iptv.all().filter(function (c) {
          return c.cats[0] === Iptv.MINE && (!key || c.playlist === key || (key === Iptv.STREAMS && c.group === Iptv.STREAMS));
        });
      }
      if (type === "cat" || type === "country") {
        var g = Iptv.groups(type)[key];
        return g ? g.slice() : [];
      }
      return Iptv.all();
    },
    emoji: function (cat) {
      return EMOJI_MAP[cat] || "📡";
    },
    flag: function (countryName) {
      return countryFlagMap[countryName] || "🏳";
    },
    favorites: function () {
      var favUrls = Store.get("iptvfav", []) || [];
      var set = {};
      for (var i = 0; i < favUrls.length; i++) set[favUrls[i]] = true;
      return Iptv.all().filter(function (c) { return !!set[c.url]; });
    },
    isFavorite: function (c) {
      var favUrls = Store.get("iptvfav", []) || [];
      return favUrls.indexOf(c.url) >= 0;
    },
    toggleFavorite: function (c) {
      var favUrls = (Store.get("iptvfav", []) || []).slice();
      var idx = favUrls.indexOf(c.url);
      if (idx >= 0) favUrls.splice(idx, 1);
      else favUrls.push(c.url);
      Store.set("iptvfav", favUrls);
      return idx < 0;
    },
    history: function () {
      var h = Store.get("iptvhist", []) || [];
      var allowAdult = Iptv.adultOn();
      return h.filter(function (c) { return allowAdult || !c.adult; });
    },
    recordHistory: function (c) {
      var h = Iptv.history().filter(function (x) { return x.url !== c.url; });
      h.unshift(c);
      Store.set("iptvhist", h.slice(0, 20));
    },
    removeFromHistory: function (url) {
      var h = Iptv.history().filter(function (x) { return x.url !== url; });
      Store.set("iptvhist", h);
    },
    mine: function () {
      return Store.get("iptvmine", []) || [];
    },
    playlistName: function (url) {
      var names = Store.get("iptvnames", {}) || {};
      if (names[url]) return names[url];
      try {
        var u = new URL(url);
        if (u.pathname && u.pathname.slice(-15) === "/player_api.php") {
          return u.host + " · Xtream (" + (u.searchParams.get("username") || "") + ")";
        }
      } catch (e) {}
      return String(url).replace(/^https?:\/\//i, "");
    },
    xtreamUrl: function (server, user, pass) {
      var base = String(server || "").trim().replace(/\/+(player_api\.php.*|get\.php.*)?$/i, "");
      if (!/^https?:\/\/.+/i.test(base)) base = "http://" + base;
      return base + "/player_api.php?username=" + encodeURIComponent(user.trim()) + "&password=" + encodeURIComponent(pass.trim());
    },
    addPlaylist: function (rawUrl, label) {
      var url = String(rawUrl || "").trim();
      if (!url) return Promise.resolve("Empty URL");
      if (!/^https?:\/\/.+/i.test(url)) url = "https://" + url;
      var current = Iptv.mine().slice();
      if (current.indexOf(url) >= 0) return Promise.resolve("Already added");

      var isXtream = url.indexOf("/player_api.php") >= 0;
      var fetchPromise;
      if (isXtream) {
        fetchPromise = fetchText(url, { forceService: true }).then(function (loginTxt) {
          var login = JSON.parse(loginTxt).user_info;
          if (!login || Number(login.auth) !== 1) throw new Error("Xtream auth failed");
          return Promise.all([
            fetchText(url + "&action=get_live_categories", { forceService: true }),
            fetchText(url + "&action=get_live_streams", { forceService: true })
          ]).then(function (parts) {
            var catsArr = JSON.parse(parts[0]);
            var streamsArr = JSON.parse(parts[1]);
            var catMap = {};
            for (var i = 0; i < catsArr.length; i++) {
              catMap[catsArr[i].category_id] = catsArr[i].category_name;
            }
            var u = new URL(url);
            var base = url.substring(0, url.indexOf("/player_api.php")) + "/live/" +
              encodeURIComponent(u.searchParams.get("username")) + "/" +
              encodeURIComponent(u.searchParams.get("password")) + "/";
            var m3u = ["#EXTM3U"];
            for (var j = 0; j < streamsArr.length; j++) {
              var s = streamsArr[j];
              var grp = String(catMap[s.category_id] || "Live").replace(/"/g, "'");
              m3u.push('#EXTINF:-1 tvg-logo="' + (s.stream_icon || "") + '" group-title="' + grp + '",' + String(s.name || "Channel").replace(/\n/g, " ").trim());
              m3u.push(base + s.stream_id + ".m3u8");
            }
            return m3u.join("\n");
          });
        });
      } else {
        fetchPromise = fetchText(url);
      }

      return fetchPromise.then(function (text) {
        if (!text || text.trim().indexOf("#EXTM3U") !== 0) {
          return isXtream ? "Can't sign in: check server, username and password" : "Not a valid M3U playlist or stream link";
        }
        var parsed = parseM3u(text, false);
        if (parsed.length === 0 && text.indexOf("#EXT-X-") >= 0) {
          var streamTitle = (label && label.trim()) ? label.trim() : url.replace(/^https?:\/\//i, "");
          text = '#EXTM3U\n#EXTINF:-1 group-title="' + Iptv.STREAMS + '",' + streamTitle + "\n" + url + "\n";
          parsed = parseM3u(text, false);
        }
        if (parsed.length === 0) return "No channels in that playlist";
        var names = Store.get("iptvnames", {}) || {};
        if (label && label.trim()) names[url] = label.trim();
        Store.set("iptvnames", names);

        var mineData = Store.get("iptv_mine_data", {}) || {};
        mineData[url] = text;
        Store.set("iptv_mine_data", mineData);

        current.push(url);
        Store.set("iptvmine", current);
        iptvChannelsCache = null;
        return null;
      }).catch(function () {
        return isXtream ? "Can't sign in: check the server, username and password" : "Not a playlist or stream link, or it can't be reached";
      });
    },
    removePlaylist: function (url) {
      var current = Iptv.mine().filter(function (u) { return u !== url; });
      Store.set("iptvmine", current);
      var names = Store.get("iptvnames", {}) || {};
      delete names[url];
      Store.set("iptvnames", names);
      var mineData = Store.get("iptv_mine_data", {}) || {};
      delete mineData[url];
      Store.set("iptv_mine_data", mineData);
      iptvChannelsCache = null;
    },
    refresh: function () {
      Iptv.loading = true;
      var extUrl = Iptv.extrasUrl();
      return fetchText(IPTV_MAIN)
        .then(function (mainM3u) {
          if (mainM3u && mainM3u.trim().indexOf("#EXTM3U") === 0) {
            iptvMainRaw = mainM3u;
            iptvChannelsCache = null;
          }
          if (!extUrl) return true;
          return fetchText(extUrl).then(function (extrasTxt) {
            var lines = String(extrasTxt || "").split(/\r?\n/);
            var sources = [];
            var deeplinksUrl = "";
            for (var i = 0; i < lines.length; i++) {
              var ln = lines[i].trim();
              if (!ln || ln.charAt(0) === "#") continue;
              var parts = ln.split("|");
              if (parts.length >= 2 && parts[0] === "@deeplinks") {
                deeplinksUrl = parts[1].trim();
              } else if (parts.length >= 2 && parts[1].indexOf("http") === 0) {
                sources.push({ label: parts[0], url: parts[1].trim(), flag: (parts[2] || "").trim() });
              }
            }
            Store.set("iptv_extras_sources", sources);
            if (deeplinksUrl) {
              fetchText(deeplinksUrl).then(function (dlJson) {
                try { Store.set("deeplinks", JSON.parse(dlJson)); } catch (e) {}
              }).catch(function () {});
            }
            return true;
          }).catch(function () { return true; });
        })
        .then(function () {
          Iptv.loading = false;
          iptvChannelsCache = null;
          return iptvMainRaw.length > 0;
        })
        .catch(function () {
          Iptv.loading = false;
          return false;
        });
    },
    sweep: function (onProgress) {
      if (Iptv.sweeping) return;
      var all = Iptv.all(true);
      if (all.length === 0) return;
      Iptv.sweeping = true;
      var favs = Iptv.favorites();
      var hist = Iptv.history();
      var prioritySet = {};
      favs.forEach(function (c) { prioritySet[c.url] = true; });
      hist.forEach(function (c) { prioritySet[c.url] = true; });

      var priority = [];
      var rest = [];
      for (var i = 0; i < all.length; i++) {
        if (prioritySet[all[i].url]) priority.push(all[i]);
        else rest.push(all[i]);
      }
      // Probe up to 160 channels per sweep in browser/service mode so TV stays snappy
      var todo = priority.concat(rest.slice(0, 160));
      Iptv.sweepDone = 0;
      Iptv.sweepTotal = todo.length;

      function nextBatch(idx) {
        if (idx >= todo.length) {
          Iptv.sweeping = false;
          if (onProgress) onProgress();
          return;
        }
        var batch = todo.slice(idx, idx + 16);
        if (serviceOnline) {
          fetch(SERVICE_URL + "/api/probe-batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channels: batch })
          })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              var map = (res && res.results) || {};
              Object.keys(map).forEach(function (u) {
                Iptv.mark(u, !!map[u]);
              });
              Iptv.sweepDone += batch.length;
              if (onProgress) onProgress();
              nextBatch(idx + 16);
            })
            .catch(function () {
              Iptv.sweeping = false;
            });
        } else {
          Iptv.sweeping = false;
        }
      }
      nextBatch(0);
    }
  };

  // ---- Subs.java Port (OpenSubtitles v3 Public Addon) ----
  var OPENSUBS_BASE = "https://opensubtitles-v3.strem.io/subtitles/";
  var ODD_LANGS = {
    "pob": "Portuguese (Brazil)", "zht": "Chinese (Traditional)", "zhc": "Chinese (Cantonese)",
    "zhe": "Chinese (bilingual)", "spl": "Spanish (Latin America)", "spn": "Spanish (Spain)",
    "pom": "Portuguese", "eng": "English", "spa": "Spanish", "fre": "French", "fra": "French",
    "ger": "German", "deu": "German", "ita": "Italian", "rus": "Russian", "ara": "Arabic",
    "tur": "Turkish", "jpn": "Japanese", "kor": "Korean", "hin": "Hindi", "pol": "Polish",
    "dut": "Dutch", "nld": "Dutch", "swe": "Swedish", "nor": "Norwegian", "dan": "Danish",
    "fin": "Finnish", "gre": "Greek", "heb": "Hebrew", "ind": "Indonesian", "vie": "Vietnamese",
    "tha": "Thai", "ces": "Czech", "cze": "Czech", "hun": "Hungarian", "ron": "Romanian",
    "rum": "Romanian", "ukr": "Ukrainian", "fas": "Persian", "per": "Persian"
  };

  var Subs = {
    delayMs: 0,
    size: function () { return Number(Store.get("subSize", 100)); },
    setSize: function (v) { Store.set("subSize", Math.max(50, Math.min(250, v))); },
    sizeLabel: function () { var s = Subs.size(); return s === 100 ? "Default" : s + "%"; },
    offset: function () { return Number(Store.get("subOffset", 0)); },
    setOffset: function (v) { Store.set("subOffset", Math.max(-80, Math.min(200, v))); },
    offsetLabel: function () { var o = Subs.offset(); return o === 0 ? "Default" : (o > 0 ? "Up " : "Down ") + Math.abs(o); },
    delayLabel: function () { return Subs.delayMs === 0 ? "In sync" : ((Subs.delayMs > 0 ? "+" : "") + (Subs.delayMs / 1000).toFixed(1) + " s"); },
    reset: function () {
      Store.set("subSize", 100);
      Store.set("subOffset", 0);
      Subs.delayMs = 0;
    },
    languageName: function (iso3) {
      var code = String(iso3 || "und").toLowerCase();
      if (ODD_LANGS[code]) return ODD_LANGS[code];
      return code.toUpperCase();
    },
    find: function (imdb, season, episode) {
      var path = season > 0 ? ("series/" + imdb + ":" + season + ":" + episode) : ("movie/" + imdb);
      return fetchText(OPENSUBS_BASE + path + ".json")
        .then(function (txt) {
          var arr = (JSON.parse(txt) || {}).subtitles || [];
          var out = [];
          for (var i = 0; i < arr.length; i++) {
            var o = arr[i];
            if (!o.url) continue;
            out.push({
              url: o.url,
              lang: o.lang || "und",
              release: o.subtitleFileName || o.movieReleaseName || ("Subtitle " + (i + 1))
            });
          }
          return out;
        })
        .catch(function () { return null; });
    },
    byLanguage: function (allSubs) {
      var m = {};
      for (var i = 0; i < allSubs.length; i++) {
        var s = allSubs[i];
        if (!m[s.lang]) m[s.lang] = [];
        m[s.lang].push(s);
      }
      var keys = Object.keys(m);
      keys.sort(function (a, b) {
        var rankA = (a === "eng" ? 1000 : 0) + m[a].length;
        var rankB = (b === "eng" ? 1000 : 0) + m[b].length;
        return rankB - rankA;
      });
      var out = {};
      for (var j = 0; j < keys.length; j++) out[keys[j]] = m[keys[j]];
      return out;
    }
  };

  // ---- Simkl.java Port ----
  var SIMKL_CLIENT_ID = "fdc9c9da795fdb1d5fd717f714a8f793d88e86f3ee24a935b8c76d10c21bb36c";
  var SIMKL_API = "https://api.simkl.com";

  var Simkl = {
    signedIn: function () {
      return !!Store.get("simklToken", "");
    },
    signOut: function () {
      Store.remove("simklToken");
      Store.remove("simklRefresh");
      Store.remove("simklUntil");
    },
    newCode: function () {
      var url = SIMKL_API + "/oauth2/device?client_id=" + SIMKL_CLIENT_ID + "&scope=media:read%20media:write";
      return fetchText(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "client_id=" + encodeURIComponent(SIMKL_CLIENT_ID) + "&scope=media%3Aread%20media%3Awrite"
      })
        .then(function (txt) {
          var o = JSON.parse(txt);
          if (!o.user_code) return null;
          return {
            user: o.user_code,
            device: o.device_code,
            page: o.verification_uri || "https://simkl.com/pin",
            interval: Math.max(5, Number(o.interval || 5)),
            until: Date.now() + Number(o.expires_in || 900) * 1000
          };
        })
        .catch(function () { return null; });
    },
    check: function (codeObj) {
      if (!codeObj || Date.now() > codeObj.until) return Promise.resolve("expired");
      var body = "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:device_code") +
                 "&client_id=" + encodeURIComponent(SIMKL_CLIENT_ID) +
                 "&device_code=" + encodeURIComponent(codeObj.device);
      return fetchText(SIMKL_API + "/oauth2/token?client_id=" + SIMKL_CLIENT_ID, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body
      })
        .then(function (txt) {
          var o = JSON.parse(txt);
          if (o.access_token) {
            Store.set("simklToken", o.access_token);
            Store.set("simklRefresh", o.refresh_token || "");
            Store.set("simklUntil", Date.now() + Number(o.expires_in || 604800) * 1000);
            return "ok";
          }
          if (o.error === "authorization_pending") return "wait";
          if (o.error === "slow_down") return "slow";
          if (o.error === "expired_token") return "expired";
          return "wait";
        })
        .catch(function () { return "wait"; });
    },
    scrobble: function (action, imdb, episodeArr, progress, onToast) {
      var token = Store.get("simklToken", "");
      if (!token || !imdb || String(imdb).indexOf("tt") !== 0) return;
      var payload = {
        progress: Math.round(Math.max(0, Math.min(100, progress)) * 100) / 100
      };
      var ids = { ids: { imdb: imdb } };
      if (!episodeArr) {
        payload.movie = ids;
      } else {
        payload.show = ids;
        payload.episode = { season: episodeArr[0], number: episodeArr[1] };
      }
      fetchText(SIMKL_API + "/scrobble/" + action + "?client_id=" + SIMKL_CLIENT_ID + "&app-name=fmhyplay-tizen&app-version=1.0.0", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
          "simkl-api-key": SIMKL_CLIENT_ID
        },
        body: JSON.stringify(payload)
      })
        .then(function (reply) {
          if (action === "stop" && reply && reply.indexOf('"scrobble"') >= 0 && onToast) {
            onToast("Marked watched on Simkl");
          }
        })
        .catch(function () {});
    }
  };

  // ---- History.java Port ----
  var EP_TEXT_RE = /\b(?:S(\d{1,2})\s*E(\d{1,4})|Season\s*(\d+)\W*Episode\s*(\d+)|(?:Episode|Ep\.?)\s*(\d+))\b/i;
  var JUNK_TAIL_RE = /\s+(online|free|hd|streaming|full movie|for free|eng(lish)? sub(bed)?|subbed|dubbed)\b.*$/i;

  var History = {
    list: function () {
      return Store.get("history", []) || [];
    },
    save: function (list) {
      Store.set("history", (list || []).slice(0, 60));
    },
    cleanTitle: function (rawTitle, siteName) {
      var t = String(rawTitle || "");
      var s = String(siteName || "").toLowerCase();
      var parts = t.split(/\s+[|–—•·-]\s+/);
      var best = "";
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (!p || (s && p.toLowerCase().indexOf(s) >= 0)) continue;
        best = p;
        break;
      }
      if (!best) best = t.trim();
      best = best.replace(/^(watch|stream)\s+/i, "");
      return best.replace(JUNK_TAIL_RE, "").trim();
    },
    episode: function (url, title) {
      var u = String(url || "");
      var m1 = /\/(?:tv|series|show)\/[^/?#]+\/(\d{1,2})\/(\d{1,4})(?:[/?#]|$)/i.exec(u) ||
               /season[-/=](\d+).*?episode[-/=](\d+)/i.exec(u) ||
               /[?&]s=(\d+).*?[?&]e=(\d+)/i.exec(u);
      if (m1) return "S" + parseInt(m1[1], 10) + " E" + parseInt(m1[2], 10);
      var mt = EP_TEXT_RE.exec(String(title || ""));
      if (mt) {
        if (mt[1]) return "S" + parseInt(mt[1], 10) + " E" + parseInt(mt[2], 10);
        if (mt[3]) return "S" + parseInt(mt[3], 10) + " E" + parseInt(mt[4], 10);
        return "E" + parseInt(mt[5], 10);
      }
      var me = /(?:episode|ep)[-/=](\d+)/i.exec(u);
      return me ? "E" + parseInt(me[1], 10) : "";
    },
    record: function (entryObj) {
      if (!entryObj || !entryObj.title) return;
      var list = History.list().slice();
      var title = History.cleanTitle(entryObj.title, entryObj.site || "");
      title = title.replace(EP_TEXT_RE, "").replace(/[\s:,|–-]+$/, "").trim();
      if (title.length < 2) return;
      var ep = entryObj.episode || History.episode(entryObj.url, entryObj.title);
      var existingIdx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].title.toLowerCase() === title.toLowerCase()) {
          existingIdx = i;
          break;
        }
      }
      var item = existingIdx >= 0 ? list.splice(existingIdx, 1)[0] : {};
      item.site = entryObj.site || item.site || "FMHYPlay";
      item.siteUrl = entryObj.siteUrl || item.siteUrl || "";
      item.title = title;
      item.url = entryObj.url || item.url || "";
      item.image = entryObj.image || item.image || "";
      item.episode = ep || item.episode || "";
      item.imdb = entryObj.imdb || item.imdb || "";
      item.tmdb = entryObj.tmdb || item.tmdb || "";
      item.type = entryObj.type || item.type || "movie";
      item.seasonNum = entryObj.seasonNum || item.seasonNum || 0;
      item.episodeNum = entryObj.episodeNum || item.episodeNum || 0;
      item.time = Date.now();
      list.unshift(item);
      History.save(list);
    },
    remove: function (entry) {
      var list = History.list().filter(function (x) {
        return !(x.site === entry.site && x.title === entry.title);
      });
      History.save(list);
    },
    relativeTime: function (ts) {
      var diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
      if (diffSec < 60) return "just now";
      var min = Math.floor(diffSec / 60);
      if (min < 60) return min + " min ago";
      var hr = Math.floor(min / 60);
      if (hr < 24) return hr + (hr === 1 ? " hr ago" : " hrs ago");
      var d = Math.floor(hr / 24);
      return d + (d === 1 ? " day ago" : " days ago");
    }
  };

  return {
    SERVICE_URL: SERVICE_URL,
    isServiceOnline: function () { return serviceOnline; },
    initService: initService,
    fetchText: fetchText,
    proxyStreamUrl: proxyStreamUrl,
    proxyPageUrl: proxyPageUrl,
    colorFor: colorFor,
    Store: Store,
    Cats: Cats,
    Sites: Sites,
    Catalog: Catalog,
    Iptv: Iptv,
    Subs: Subs,
    Simkl: Simkl,
    History: History
  };
})();
