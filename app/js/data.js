"use strict";

/**
 * FMHYPlay Core Data Layer for Samsung Tizen TV (TizenBrew)
 * Ports Sites.java, Cats.java, Catalog.java, Iptv.java, Subs.java, Simkl.java, History.java
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
    },
    getBool: function (key, defVal) {
      var v = memStore[key];
      if (v === undefined || v === null) return !!defVal;
      return v === true || v === "true" || v === 1 || v === "1";
    },
    setBool: function (key, val) {
      Store.set(key, !!val);
    }
  };

  // Check TizenBrew Node.js background service (with 1.2s timeout so UI never hangs)
  function initService() {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          serviceOnline = false;
          resolve(false);
        }
      }, 1200);

      fetch(SERVICE_URL + "/api/ping")
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (done) return;
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
                clearTimeout(timer);
                done = true;
                resolve(true);
              });
          } else {
            clearTimeout(timer);
            done = true;
            resolve(false);
          }
        })
        .catch(function () {
          if (!done) {
            clearTimeout(timer);
            done = true;
            serviceOnline = false;
            resolve(false);
          }
        });
    });
  }

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
    var adblock = Store.getBool("adblock", true) ? "1" : "0";
    var q = SERVICE_URL + "/proxy/page?url=" + encodeURIComponent(url) + "&adblock=" + adblock;
    if (searchQuery) q += "&q=" + encodeURIComponent(searchQuery);
    return q;
  }

  // ---- Categories (Cats.java Port) ----
  var CAT_LABELS = {
    "streaming": "Movies & TV",
    "anime": "Anime",
    "livetv": "Live TV & Sports",
    "cartoons": "Cartoons",
    "drama": "Drama & Asian",
    "docs": "Documentaries",
    "tools": "Tracking & Specialty"
  };

  var Cats = {
    ORDER: ["streaming", "anime", "livetv", "cartoons", "drama", "docs", "tools"],
    label: function (catId) {
      return CAT_LABELS[catId] || String(catId || "Streaming");
    }
  };

  // ---- Built-in Curated FMHY Sites + Live Updates (Sites.java Port) ----
  var BUILTIN_SITES = [
    // Starred FMHY Picks - Movies & TV
    { id: "cineby", name: "Cineby", cat: "streaming", urls: ["https://www.cineby.app", "https://www.cineby.ru"], star: true, tags: "Movies · TV · 4K · Fast" },
    { id: "rivestream", name: "RiveStream", cat: "streaming", urls: ["https://rivestream.org", "https://rivestream.live"], star: true, tags: "Movies · TV · Anime · Multi-Server" },
    { id: "flixer", name: "Flixer", cat: "streaming", urls: ["https://flixer.su"], star: true, tags: "Movies · TV · Auto-Next" },
    { id: "brocoflix", name: "BrocoFlix", cat: "streaming", urls: ["https://brocoflix.com"], star: true, tags: "Movies · TV · 1080p" },
    { id: "hydrahd", name: "HydraHD", cat: "streaming", urls: ["https://hydrahd.me", "https://hydrahd.cc"], star: true, tags: "Movies · TV · 1080p · Fast" },
    { id: "flickystream", name: "FlickyStream", cat: "streaming", urls: ["https://flickystream.com"], star: true, tags: "Movies · TV · Multi-Audio" },
    { id: "xprime", name: "XPrime", cat: "streaming", urls: ["https://xprime.tv"], star: true, tags: "Movies · TV · 4K" },
    { id: "rgshows", name: "RGShows", cat: "streaming", urls: ["https://www.rgshows.me"], star: true, tags: "Movies · TV · Anime" },
    { id: "vidbox", name: "VidBox", cat: "streaming", urls: ["https://vidbox.to"], star: true, tags: "Movies · TV · Clean UI" },
    { id: "1shows", name: "1Shows", cat: "streaming", urls: ["https://www.1shows.live"], star: true, tags: "Movies · TV · Fast" },
    { id: "spenflix", name: "SpenFlix", cat: "streaming", urls: ["https://watch.spencerdevs.xyz"], star: false, tags: "Movies · TV · P-Stream" },
    { id: "nepu", name: "Nepu", cat: "streaming", urls: ["https://nepu.to"], star: false, tags: "Movies · TV · 1080p" },
    { id: "fmovies", name: "FMovies+", cat: "streaming", urls: ["https://www.fmovies.gd"], star: false, tags: "Movies · TV" },
    { id: "cinemaos", name: "CinemaOS", cat: "streaming", urls: ["https://cinemaos.live"], star: false, tags: "Movies · TV" },
    { id: "veloratv", name: "VeloraTV", cat: "streaming", urls: ["https://veloratv.ru"], star: false, tags: "Movies · TV" },
    { id: "hexawatch", name: "HexaWatch", cat: "streaming", urls: ["https://hexa.watch"], star: false, tags: "Movies · TV · 4K" },
    { id: "cinetaro", name: "CineTaro", cat: "streaming", urls: ["https://cinetaro.buzz"], star: false, tags: "Movies · TV · Anime" },
    { id: "lookmovie2", name: "LookMovie", cat: "streaming", urls: ["https://www.lookmovie2.to"], star: false, tags: "Movies · TV · Dedicated" },
    { id: "pressplay", name: "PressPlay", cat: "streaming", urls: ["https://www.pressplay.top"], star: false, tags: "Movies · TV" },
    { id: "sflix", name: "SFlix", cat: "streaming", urls: ["https://sflix2.to"], star: false, tags: "Movies · TV" },

    // Anime
    { id: "miruro", name: "Miruro", cat: "anime", urls: ["https://www.miruro.tv", "https://www.miruro.online"], star: true, tags: "Sub · Dub · Multi-Source" },
    { id: "hianime", name: "HiAnime", cat: "anime", urls: ["https://hianime.to", "https://hianime.sx"], star: true, tags: "Sub · Dub · Auto-Next" },
    { id: "animekai", name: "AnimeKai", cat: "anime", urls: ["https://animekai.to", "https://animekai.bz"], star: true, tags: "Sub · Dub · Hard-Sub" },
    { id: "allmanga", name: "AllManga", cat: "anime", urls: ["https://allmanga.to"], star: true, tags: "Sub · Dub · 1080p" },
    { id: "animepahe", name: "AnimePahe", cat: "anime", urls: ["https://animepahe.ru", "https://animepahe.com"], star: true, tags: "Sub · Dub · 1080p" },
    { id: "kickassanime", name: "KickAssAnime", cat: "anime", urls: ["https://kaa.mx"], star: false, tags: "Sub · Dub · 1080p" },
    { id: "aniplay", name: "AniPlay", cat: "anime", urls: ["https://aniplaynow.live"], star: false, tags: "Sub · Dub · AniList Sync" },
    { id: "shiroko", name: "Shiroko", cat: "anime", urls: ["https://shiroko.co"], star: false, tags: "Sub · Dub · Clean" },
    { id: "anikoto", name: "AniKoto", cat: "anime", urls: ["https://anikoto.tv"], star: false, tags: "Sub · Dub" },
    { id: "wco", name: "WCO Stream", cat: "anime", urls: ["https://www.wcostream.tv"], star: false, tags: "Anime · Cartoons · Dub" },

    // Live TV & Sports
    { id: "thetvapp", name: "TheTVApp", cat: "livetv", urls: ["https://thetvapp.to"], star: true, tags: "US Live TV · Sports · 1080p" },
    { id: "tvgarden", name: "TV Garden", cat: "livetv", urls: ["https://tv.garden"], star: true, tags: "Global Live TV · 3D Globe" },
    { id: "ntvstream", name: "NTVStream", cat: "livetv", urls: ["https://ntvstream.cx"], star: true, tags: "US/UK Channels · Sports" },
    { id: "streamed", name: "Streamed", cat: "livetv", urls: ["https://streamed.su"], star: true, tags: "Live Sports · HD Events" },
    { id: "ppvland", name: "PPV.LAND", cat: "livetv", urls: ["https://ppv.wtf", "https://ppv.land"], star: true, tags: "Live Sports · PPV · 1080p" },
    { id: "dlhd", name: "DaddyLiveHD", cat: "livetv", urls: ["https://dlhd.dad"], star: false, tags: "24/7 Live TV · Sports" },
    { id: "sportssurge", name: "SportsSurge", cat: "livetv", urls: ["https://v2.sportsurge.net"], star: false, tags: "NFL · NBA · Soccer · F1" },
    { id: "methstreams", name: "MethStreams", cat: "livetv", urls: ["https://methstreams.cx"], star: false, tags: "Live Sports · MMA · NBA" },
    { id: "WatchFooty", name: "WatchFooty", cat: "livetv", urls: ["https://www.watchfooty.st"], star: false, tags: "Football · Live Sports" },

    // Cartoons
    { id: "kimcartoon", name: "WatchCartoonsOnline", cat: "cartoons", urls: ["https://www.wcofun.net"], star: true, tags: "Cartoons · Animated Series" },
    { id: "kisscartoon", name: "KissCartoon", cat: "cartoons", urls: ["https://kisscartoon.sh"], star: false, tags: "Cartoons · Movies" },
    { id: "toonstream", name: "ToonStream", cat: "cartoons", urls: ["https://toonstream.co"], star: false, tags: "Cartoons · Anime" },

    // Drama & Asian
    { id: "kisskh", name: "KissKH", cat: "drama", urls: ["https://kisskh.co", "https://kisskh.ovh"], star: true, tags: "K-Drama · C-Drama · Anime" },
    { id: "dramacool", name: "DramaCool", cat: "drama", urls: ["https://dramacool.bg"], star: true, tags: "Asian Drama · K-Show" },
    { id: "goplay", name: "GoPlay", cat: "drama", urls: ["https://goplay.su"], star: false, tags: "Asian Drama · Viki Streams" },
    { id: "myasiantv", name: "MyAsianTV", cat: "drama", urls: ["https://myasiantv.ac"], star: false, tags: "K-Drama · Movies" },

    // Documentaries
    { id: "ihavenotv", name: "IHaveNoTV", cat: "docs", urls: ["https://ihavenotv.com"], star: true, tags: "Curated Documentaries" },
    { id: "topdocumentary", name: "TopDocumentaryFilms", cat: "docs", urls: ["https://topdocumentaryfilms.com"], star: true, tags: "Free Documentaries" },
    { id: "docuwiki", name: "DocuWiki", cat: "docs", urls: ["https://docuwiki.net"], star: false, tags: "Documentary Archive" },

    // Tracking & Specialty
    { id: "simkl", name: "Simkl", cat: "tools", urls: ["https://simkl.com"], star: true, tags: "Tracker · TV · Anime · Movies" },
    { id: "internetarchive", name: "Internet Archive", cat: "tools", urls: ["https://archive.org/details/movies"], star: true, tags: "Public Domain · Classics" }
  ];

  var EMBED_SERVERS = [
    { label: "VidSrc CC", movie: "https://vidsrc.cc/v2/embed/movie/{id}", tv: "https://vidsrc.cc/v2/embed/tv/{id}/{s}/{e}" },
    { label: "VidLink Pro", movie: "https://vidlink.pro/movie/{id}?autoplay=true", tv: "https://vidlink.pro/tv/{id}/{s}/{e}?autoplay=true" },
    { label: "AutoEmbed", movie: "https://player.autoembed.cc/embed/movie/{id}", tv: "https://player.autoembed.cc/embed/tv/{id}/{s}/{e}" },
    { label: "VidSrc XYZ", movie: "https://vidsrc.xyz/embed/movie/{id}", tv: "https://vidsrc.xyz/embed/tv/{id}/{s}-{e}" },
    { label: "MultiEmbed", movie: "https://multiembed.mov/?video_id={id}", tv: "https://multiembed.mov/?video_id={id}&s={s}&e={e}" },
    { label: "2Embed", movie: "https://www.2embed.cc/embed/{id}", tv: "https://www.2embed.cc/embedtv/{id}&s={s}&e={e}" }
  ];

  // Default search URL patterns per domain
  var SEARCH_PATTERNS = {
    "cineby.app": "/search?q={q}",
    "cineby.ru": "/search?q={q}",
    "rivestream.org": "/search?q={q}",
    "flixer.su": "/search?q={q}",
    "hydrahd.me": "/index.php?menu=search&query={q}",
    "miruro.tv": "/search?query={q}",
    "hianime.to": "/search?keyword={q}",
    "animekai.to": "/browser?keyword={q}",
    "allmanga.to": "/anime?cty=ALL&query={q}",
    "kisskh.co": "/Search?q={q}"
  };

  function hydrateSiteObject(raw) {
    var urls = Array.isArray(raw.urls) && raw.urls.length > 0 ? raw.urls : [raw.url || "https://fmhy.net"];
    var id = raw.id || String(raw.name || urls[0]).toLowerCase().replace(/[^a-z0-9]+/g, "");
    return {
      id: id,
      name: raw.name || "Site",
      cat: raw.cat || "streaming",
      urls: urls,
      star: !!(raw.star || raw.pick),
      tags: raw.tags || "",
      url: function () { return urls[0]; },
      faviconUrl: function () {
        try {
          var host = new URL(urls[0]).hostname;
          return "https://www.google.com/s2/favicons?sz=64&domain_url=" + encodeURIComponent(host);
        } catch (e) {
          return "";
        }
      }
    };
  }

  var allSitesCache = null;

  function buildSitesList() {
    if (allSitesCache) return allSitesCache;
    var map = {};
    var list = [];
    BUILTIN_SITES.forEach(function (b) {
      var s = hydrateSiteObject(b);
      map[s.id] = s;
      list.push(s);
    });
    var remoteCustom = Store.get("fmhy_remote_sites", []) || [];
    remoteCustom.forEach(function (r) {
      var s = hydrateSiteObject(r);
      if (!map[s.id]) {
        map[s.id] = s;
        list.push(s);
      }
    });
    allSitesCache = list;
    return list;
  }

  // Initialize default starred sites on first run
  function getStarredIds() {
    var ids = Store.get("starred_site_ids", null);
    if (!Array.isArray(ids)) {
      ids = ["cineby", "rivestream", "miruro", "hianime", "thetvapp", "streamed"];
      Store.set("starred_site_ids", ids);
    }
    return ids;
  }

  var Sites = {
    all: function () {
      return buildSitesList();
    },
    byCategory: function (catId) {
      return buildSitesList().filter(function (s) { return s.cat === catId; });
    },
    featured: function () {
      return buildSitesList().filter(function (s) { return s.star; });
    },
    starred: function () {
      var ids = getStarredIds();
      var all = buildSitesList();
      var out = [];
      ids.forEach(function (id) {
        for (var i = 0; i < all.length; i++) {
          if (all[i].id === id) {
            out.push(all[i]);
            break;
          }
        }
      });
      return out;
    },
    isStarred: function (siteId) {
      return getStarredIds().indexOf(siteId) !== -1;
    },
    toggleStar: function (siteId) {
      var ids = getStarredIds().slice();
      var idx = ids.indexOf(siteId);
      if (idx >= 0) ids.splice(idx, 1);
      else ids.push(siteId);
      Store.set("starred_site_ids", ids);
      return idx < 0;
    },
    search: function (query) {
      var q = String(query || "").trim().toLowerCase();
      if (!q) return [];
      return buildSitesList().filter(function (s) {
        return s.name.toLowerCase().indexOf(q) !== -1 ||
               s.tags.toLowerCase().indexOf(q) !== -1 ||
               s.urls[0].toLowerCase().indexOf(q) !== -1;
      });
    },
    deeplink: function (siteUrl, query) {
      if (!siteUrl) return "";
      if (!query) return siteUrl;
      try {
        var u = new URL(siteUrl);
        var host = u.hostname.replace(/^www\./, "");
        var pat = SEARCH_PATTERNS[host];
        if (pat) {
          return u.protocol + "//" + u.host + pat.replace("{q}", encodeURIComponent(query));
        }
      } catch (e) {}
      return siteUrl;
    },
    embedUrlsForTitle: function (type, imdbId, season, episode) {
      var id = String(imdbId || "");
      if (!id) return [];
      var isSeries = type === "series";
      var s = season || 1;
      var e = episode || 1;
      return EMBED_SERVERS.map(function (srv) {
        var tpl = isSeries ? srv.tv : srv.movie;
        var u = tpl
          .replace(/\{id\}/g, encodeURIComponent(id))
          .replace(/\{s\}/g, String(s))
          .replace(/\{e\}/g, String(e));
        return { label: srv.label, name: srv.label, url: u };
      });
    },
    refresh: function () {
      var ENTRY_RE = /^\*\s*(⭐|🌟|🌐)?\s*(?:\*\*)?\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(?:\*\*)?(.*)$/;
      return fetchText("https://raw.githubusercontent.com/fmhy/edit/main/docs/video.md")
        .then(function (md) {
          if (!md || md.indexOf("Streaming") === -1) return false;
          var lines = md.split(/\r?\n/);
          var section = "";
          var remoteSites = [];
          for (var i = 0; i < lines.length; i++) {
            var ln = lines[i].trim();
            if (ln.indexOf("#") === 0) {
              section = ln.replace(/^[#\s►▷]+/, "").trim();
              continue;
            }
            var m = ENTRY_RE.exec(ln);
            if (!m) continue;
            var url = m[3];
            if (/reddit\.com|github\.com|fmhy\.|discord\.gg/i.test(url)) continue;
            var cat = "streaming";
            if (/anime/i.test(section)) cat = "anime";
            else if (/live|sport/i.test(section)) cat = "livetv";
            else if (/cartoon/i.test(section)) cat = "cartoons";
            else if (/drama/i.test(section)) cat = "drama";
            else if (/docu/i.test(section)) cat = "docs";
            remoteSites.push({
              name: m[2].trim(),
              cat: cat,
              urls: [url],
              star: !!m[1] && m[1] !== "🌐",
              tags: section
            });
          }
          if (remoteSites.length > 10) {
            Store.set("fmhy_remote_sites", remoteSites.slice(0, 120));
            Store.set("fmhy_sites_ts", Date.now());
            Store.set("fmhy_sites_ver", new Date().toISOString().slice(0, 10));
            allSitesCache = null;
          }
          return true;
        })
        .catch(function () { return false; });
    },
    remoteVersion: function () {
      return Store.get("fmhy_sites_ver", "2026.11");
    },
    lastCheck: function () {
      return Store.get("fmhy_sites_ts", Date.now());
    }
  };

  // ---- Cinemeta Catalog (Catalog.java Port) ----
  var CINEMETA_BASE = "https://v3-cinemeta.strem.io";
  var catalogCache = {};
  var posterCache = {};

  function parseCatalogItem(o, type) {
    if (!o) return null;
    var seasonsMap = {};
    if (Array.isArray(o.videos)) {
      o.videos.forEach(function (v) {
        var sn = Number(v.season || 0);
        var ep = Number(v.episode || v.number || 0);
        if (sn < 1 || ep < 1) return;
        if (!seasonsMap[sn]) seasonsMap[sn] = [];
        seasonsMap[sn].push({
          season: sn,
          episode: ep,
          name: v.name || v.title || ("Episode " + ep),
          overview: v.overview || v.description || "",
          thumb: v.thumbnail || "",
          released: v.released ? String(v.released).slice(0, 10) : ""
        });
      });
      Object.keys(seasonsMap).forEach(function (sn) {
        seasonsMap[sn].sort(function (a, b) { return a.episode - b.episode; });
      });
    }
    var g = o.genres || o.genre || [];
    return {
      id: o.id || "",
      tmdb: o.moviedb_id > 0 ? String(o.moviedb_id) : "",
      type: type || o.type || "movie",
      name: o.name || "",
      year: String(o.releaseInfo || o.year || ""),
      rating: o.imdbRating ? String(o.imdbRating) : "",
      poster: String(o.poster || "").replace("/poster/small/", "/poster/medium/"),
      backdrop: o.background || "",
      overview: o.description || "",
      runtime: o.runtime || "",
      genres: Array.isArray(g) ? g : [],
      seasons: seasonsMap
    };
  }

  var Catalog = {
    GENRES: [
      "All", "Top IMDb", "Action", "Adventure", "Animation", "Biography",
      "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy",
      "History", "Horror", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller"
    ],
    list: function (type, extra) {
      extra = extra || "";
      var key = type + "|" + extra;
      if (catalogCache[key] && extra.indexOf("search=") !== 0) {
        return Promise.resolve(catalogCache[key]);
      }
      var catalogId = extra.indexOf("top_rated") === 0 ? "imdbRating" : "top";
      var cleanExtra = extra.replace(/^top_rated\/?/, "");
      var path = "/catalog/" + type + "/" + catalogId + (cleanExtra ? "/" + cleanExtra : "") + ".json";
      return fetchText(CINEMETA_BASE + path, { useService: false })
        .catch(function () { return fetchText(CINEMETA_BASE + path, { forceService: true }); })
        .then(function (txt) {
          var data = JSON.parse(txt);
          var metas = (data && data.metas) || [];
          var out = [];
          for (var i = 0; i < metas.length; i++) {
            var it = parseCatalogItem(metas[i], type);
            if (it && it.id && it.name) {
              out.push(it);
              if (it.poster) posterCache[it.name.toLowerCase()] = it.poster;
            }
          }
          if (extra.indexOf("search=") !== 0) catalogCache[key] = out;
          return out;
        })
        .catch(function () { return []; });
    },
    trending: function (type, skip) {
      return Catalog.list(type, skip > 0 ? ("skip=" + skip) : "");
    },
    topRated: function (type, skip) {
      return Catalog.list(type, "top_rated" + (skip > 0 ? "/skip=" + skip : ""));
    },
    byGenre: function (type, genre, skip) {
      var ex = "genre=" + encodeURIComponent(genre);
      if (skip > 0) ex += "&skip=" + skip;
      return Catalog.list(type, ex);
    },
    get: function (type, imdbId) {
      var path = "/meta/" + type + "/" + encodeURIComponent(imdbId) + ".json";
      return fetchText(CINEMETA_BASE + path, { useService: false })
        .catch(function () { return fetchText(CINEMETA_BASE + path, { forceService: true }); })
        .then(function (txt) {
          var meta = (JSON.parse(txt) || {}).meta;
          return parseCatalogItem(meta, type);
        })
        .catch(function () { return null; });
    },
    posterFor: function (titleName) {
      if (!titleName) return Promise.resolve("");
      var k = String(titleName).trim().toLowerCase();
      if (posterCache[k]) return Promise.resolve(posterCache[k]);
      return Catalog.list("movie", "search=" + encodeURIComponent(titleName)).then(function (list) {
        if (list && list.length > 0 && list[0].poster) {
          posterCache[k] = list[0].poster;
          return list[0].poster;
        }
        return "";
      }).catch(function () { return ""; });
    },
    favorites: function () {
      return Store.get("saved_catalog", []) || [];
    },
    isFavorite: function (type, id) {
      var list = Catalog.favorites();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return true;
      }
      return false;
    },
    toggleFavorite: function (item) {
      var list = Catalog.favorites().slice();
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === item.id) { idx = i; break; }
      }
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        list.unshift({
          id: item.id,
          type: item.type || "movie",
          name: item.name,
          poster: item.poster || "",
          year: item.year || "",
          rating: item.rating || ""
        });
      }
      Store.set("saved_catalog", list);
      return idx < 0;
    }
  };

  // ---- IPTV & Live TV (Iptv.java Port) ----
  var IPTV_CATEGORIES = [
    ["Sports", "sports", "⚽"],
    ["News", "news", "📰"],
    ["Movies", "movies", "🎬"],
    ["Series", "series", "🎞"],
    ["Entertainment", "entertainment", "🎭"],
    ["Music", "music", "🎵"],
    ["Kids", "kids", "🧸"],
    ["Animation", "animation", "🐭"],
    ["Documentary", "documentary", "🌍"],
    ["Comedy", "comedy", "😂"],
    ["Science", "science", "🔬"],
    ["Education", "education", "🎓"],
    ["Lifestyle", "lifestyle", "🌿"],
    ["Cooking", "cooking", "🍳"],
    ["Travel", "travel", "✈️"],
    ["Auto", "auto", "🚗"],
    ["Weather", "weather", "⛅"]
  ];

  var IPTV_COUNTRIES = [
    ["United States", "us", "🇺🇸"],
    ["United Kingdom", "uk", "🇬🇧"],
    ["Canada", "ca", "🇨🇦"],
    ["Australia", "au", "🇦🇺"],
    ["Germany", "de", "🇩🇪"],
    ["France", "fr", "🇫🇷"],
    ["Spain", "es", "🇪🇸"],
    ["Italy", "it", "🇮🇹"],
    ["Brazil", "br", "🇧🇷"],
    ["Mexico", "mx", "🇲🇽"],
    ["Argentina", "ar", "🇦🇷"],
    ["India", "in", "🇮🇳"],
    ["Japan", "jp", "🇯🇵"],
    ["South Korea", "kr", "🇰🇷"],
    ["Saudi Arabia", "sa", "🇸🇦"],
    ["UAE", "ae", "🇦🇪"],
    ["Egypt", "eg", "🇪🇬"],
    ["Turkey", "tr", "🇹🇷"],
    ["Netherlands", "nl", "🇳🇱"],
    ["Poland", "pl", "🇵🇱"],
    ["Sweden", "se", "🇸🇪"],
    ["Norway", "no", "🇳🇴"],
    ["Denmark", "dk", "🇩🇰"],
    ["Finland", "fi", "🇫🇮"],
    ["Portugal", "pt", "🇵🇹"],
    ["Greece", "gr", "🇬🇷"],
    ["Romania", "ro", "🇷🇴"],
    ["Philippines", "ph", "🇵🇭"],
    ["Indonesia", "id", "🇮🇩"],
    ["Malaysia", "my", "🇲🇾"]
  ];

  var playlistCache = {};

  function extractAttr(line, key) {
    var k = key + '="';
    var idx = line.indexOf(k);
    if (idx < 0) return "";
    var end = line.indexOf('"', idx + k.length);
    return end < 0 ? "" : line.substring(idx + k.length, end);
  }

  function parseM3uText(text) {
    var out = [];
    if (!text) return out;
    var lines = String(text).split(/\r?\n/);
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (ln.indexOf("#EXTINF") === 0) {
        var comma = ln.lastIndexOf(",");
        cur = {
          name: comma >= 0 ? ln.substring(comma + 1).trim() : "Channel",
          logo: extractAttr(ln, "tvg-logo"),
          group: extractAttr(ln, "group-title") || "Live",
          ua: extractAttr(ln, "http-user-agent"),
          ref: extractAttr(ln, "http-referrer"),
          url: ""
        };
      } else if (cur && ln && ln.charAt(0) !== "#") {
        if (ln.indexOf("http") === 0) {
          cur.url = ln;
          out.push(cur);
        }
        cur = null;
      }
    }
    return out;
  }

  var Iptv = {
    CATEGORIES: IPTV_CATEGORIES,
    COUNTRIES: IPTV_COUNTRIES,
    categoryUrl: function (slug) {
      return "https://iptv-org.github.io/iptv/categories/" + slug + ".m3u";
    },
    countryUrl: function (code) {
      return "https://iptv-org.github.io/iptv/countries/" + code + ".m3u";
    },
    fetchPlaylist: function (url, forceRefresh) {
      if (!url) return Promise.resolve([]);
      if (!forceRefresh && playlistCache[url]) {
        return Promise.resolve(playlistCache[url]);
      }
      return fetchText(url)
        .then(function (txt) {
          var list = parseM3uText(txt);
          playlistCache[url] = list;
          return list;
        })
        .catch(function () { return []; });
    },
    search: function (query) {
      var q = String(query || "").trim().toLowerCase();
      if (!q) return Promise.resolve([]);
      return Iptv.fetchPlaylist("https://iptv-org.github.io/iptv/index.m3u", false)
        .then(function (all) {
          return all.filter(function (ch) {
            return ch.name.toLowerCase().indexOf(q) !== -1 ||
                   (ch.group && ch.group.toLowerCase().indexOf(q) !== -1);
          }).slice(0, 120);
        });
    },
    filterLive: function (channels, onBatch, abortSignal) {
      if (!serviceOnline) {
        if (onBatch) onBatch(channels, channels.length, channels.length);
        return Promise.resolve(channels);
      }
      var batchSize = 20;
      var total = channels.length;
      var liveAll = [];

      function runBatch(startIdx) {
        if ((abortSignal && abortSignal.aborted) || startIdx >= total) {
          return Promise.resolve(liveAll);
        }
        var slice = channels.slice(startIdx, startIdx + batchSize);
        return fetch(SERVICE_URL + "/api/probe-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channels: slice })
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            var map = (res && res.results) || {};
            var liveSlice = slice.filter(function (ch) { return map[ch.url] !== false; });
            liveAll = liveAll.concat(liveSlice);
            if (onBatch) onBatch(liveSlice, Math.min(total, startIdx + batchSize), total);
            return runBatch(startIdx + batchSize);
          })
          .catch(function () {
            if (onBatch) onBatch(slice, Math.min(total, startIdx + batchSize), total);
            return slice;
          });
      }
      return runBatch(0);
    },
    favorites: function () {
      return Store.get("iptv_fav_channels", []) || [];
    },
    isFavorite: function (url) {
      var list = Iptv.favorites();
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === url) return true;
      }
      return false;
    },
    toggleFavorite: function (ch) {
      var list = Iptv.favorites().slice();
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === ch.url) { idx = i; break; }
      }
      if (idx >= 0) list.splice(idx, 1);
      else list.unshift({ name: ch.name, url: ch.url, logo: ch.logo || "", group: ch.group || "" });
      Store.set("iptv_fav_channels", list);
      return idx < 0;
    },
    recent: function () {
      return Store.get("iptv_recent_channels", []) || [];
    },
    played: function (url) {
      if (!url) return;
      var rec = Iptv.recent().slice();
      var existing = null;
      for (var i = 0; i < rec.length; i++) {
        if (rec[i].url === url) { existing = rec.splice(i, 1)[0]; break; }
      }
      if (existing) {
        rec.unshift(existing);
        Store.set("iptv_recent_channels", rec.slice(0, 24));
      }
    },
    mark: function () {},
    playlists: function () {
      return Store.get("iptv_custom_playlists", []) || [];
    },
    addPlaylist: function (name, url) {
      var u = String(url || "").trim();
      if (!u) return;
      if (!/^https?:\/\//i.test(u)) u = "https://" + u;
      var n = String(name || "").trim() || u.replace(/^https?:\/\//i, "").slice(0, 28);
      var list = Iptv.playlists().filter(function (p) { return p.url !== u; });
      list.push({ name: n, url: u });
      Store.set("iptv_custom_playlists", list);
    },
    addXtream: function (name, server, user, pass) {
      var srv = String(server || "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(srv)) srv = "http://" + srv;
      var m3uUrl = srv + "/get.php?username=" + encodeURIComponent(user) + "&password=" + encodeURIComponent(pass) + "&type=m3u_plus&output=ts";
      Iptv.addPlaylist(name || (user + " @ Xtream"), m3uUrl);
    },
    removePlaylist: function (url) {
      var list = Iptv.playlists().filter(function (p) { return p.url !== url; });
      Store.set("iptv_custom_playlists", list);
    },
    refresh: function () {
      playlistCache = {};
      return Promise.resolve(true);
    }
  };

  // ---- OpenSubtitles v3 & Subtitle Styling (Subs.java Port) ----
  var OPENSUBS_BASE = "https://opensubtitles-v3.strem.io/subtitles/";
  var SUB_LANGS = [
    ["eng", "English"],
    ["ara", "Arabic"],
    ["spa", "Spanish"],
    ["fre", "French"],
    ["ger", "German"],
    ["ita", "Italian"],
    ["por", "Portuguese"],
    ["pob", "Portuguese (Brazil)"],
    ["rus", "Russian"],
    ["tur", "Turkish"],
    ["jpn", "Japanese"],
    ["kor", "Korean"],
    ["hin", "Hindi"],
    ["pol", "Polish"],
    ["nld", "Dutch"],
    ["swe", "Swedish"],
    ["ind", "Indonesian"],
    ["vie", "Vietnamese"]
  ];

  var Subs = {
    LANGS: SUB_LANGS,
    delayMs: 0,
    preferredLang: function () {
      return Store.get("sub_lang", "eng");
    },
    setPreferredLang: function (code) {
      Store.set("sub_lang", code || "eng");
    },
    size: function () {
      return Number(Store.get("subSize", 100));
    },
    setSize: function (v) {
      // Support both +/-1 step calls and explicit percentage calls
      var cur = Subs.size();
      var next = Math.abs(v - cur) <= 2 ? (cur + (v > cur ? 15 : -15)) : v;
      if (v === 1) next = 100;
      Store.set("subSize", Math.max(60, Math.min(220, next)));
    },
    sizeLabel: function () {
      var s = Subs.size();
      return s === 100 ? "Default (100%)" : s + "%";
    },
    offset: function () {
      return Number(Store.get("subOffset", 0));
    },
    setOffset: function (v) {
      var cur = Subs.offset();
      var next = Math.abs(v - cur) <= 2 ? (cur + (v > cur ? 15 : -15)) : v;
      if (v === 1) next = 0;
      Store.set("subOffset", Math.max(-75, Math.min(180, next)));
    },
    offsetLabel: function () {
      var o = Subs.offset();
      return o === 0 ? "Default" : (o > 0 ? "Up +" + o + "px" : "Down " + o + "px");
    },
    stepDelay: function (deltaMs) {
      Subs.delayMs += Number(deltaMs || 0);
    },
    resetDelay: function () {
      Subs.delayMs = 0;
    },
    delayLabel: function () {
      return Subs.delayMs === 0 ? "In sync (0.0s)" : ((Subs.delayMs > 0 ? "+" : "") + (Subs.delayMs / 1000).toFixed(1) + "s");
    },
    languageName: function (iso3) {
      var code = String(iso3 || "eng").toLowerCase();
      for (var i = 0; i < SUB_LANGS.length; i++) {
        if (SUB_LANGS[i][0] === code) return SUB_LANGS[i][1];
      }
      return code.toUpperCase();
    },
    find: function (imdb, season, episode) {
      var path = season > 0 ? ("series/" + imdb + ":" + season + ":" + episode) : ("movie/" + imdb);
      return fetchText(OPENSUBS_BASE + path + ".json")
        .then(function (txt) {
          var arr = (JSON.parse(txt) || {}).subtitles || [];
          return arr.filter(function (o) { return !!o.url; }).map(function (o, idx) {
            return {
              url: o.url,
              lang: o.lang || "eng",
              release: o.subtitleFileName || o.movieReleaseName || ("Subtitle #" + (idx + 1))
            };
          });
        })
        .catch(function () { return []; });
    },
    byLanguage: function (allSubs) {
      var m = {};
      var pref = Subs.preferredLang();
      (allSubs || []).forEach(function (s) {
        if (!m[s.lang]) m[s.lang] = [];
        m[s.lang].push(s);
      });
      var keys = Object.keys(m).sort(function (a, b) {
        var ra = (a === pref ? 2000 : (a === "eng" ? 1000 : 0)) + m[a].length;
        var rb = (b === pref ? 2000 : (b === "eng" ? 1000 : 0)) + m[b].length;
        return rb - ra;
      });
      var out = {};
      keys.forEach(function (k) { out[k] = m[k]; });
      return out;
    }
  };

  // ---- Simkl Sync (Simkl.java Port) ----
  var SIMKL_CLIENT_ID = "fdc9c9da795fdb1d5fd717f714a8f793d88e86f3ee24a935b8c76d10c21bb36c";
  var SIMKL_API = "https://api.simkl.com";

  var Simkl = {
    isConnected: function () {
      return !!Store.get("simklToken", "");
    },
    disconnect: function () {
      Store.remove("simklToken");
    },
    startAuth: function () {
      var url = SIMKL_API + "/oauth/pin?client_id=" + SIMKL_CLIENT_ID;
      return fetchText(url)
        .then(function (txt) {
          var o = JSON.parse(txt);
          if (!o || !o.user_code) return null;
          return {
            user_code: o.user_code,
            verification_url: o.verification_url || "https://simkl.com/pin"
          };
        })
        .catch(function () { return null; });
    },
    pollCode: function (userCode) {
      var url = SIMKL_API + "/oauth/pin/" + encodeURIComponent(userCode) + "?client_id=" + SIMKL_CLIENT_ID;
      return fetchText(url)
        .then(function (txt) {
          var o = JSON.parse(txt);
          if (o && o.result === "OK" && o.access_token) {
            Store.set("simklToken", o.access_token);
            return "ok";
          }
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
      fetchText(SIMKL_API + "/scrobble/" + action + "?client_id=" + SIMKL_CLIENT_ID, {
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

  // ---- Watch History (History.java Port) ----
  var EP_TEXT_RE = /\b(?:S(\d{1,2})\s*E(\d{1,4})|Season\s*(\d+)\W*Episode\s*(\d+)|(?:Episode|Ep\.?)\s*(\d+))\b/i;

  var History = {
    all: function () {
      return Store.get("watch_history", []) || [];
    },
    list: function () {
      return History.all();
    },
    hostLabel: function (url) {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch (e) {
        return String(url || "Site");
      }
    },
    cleanTitle: function (rawTitle, siteName) {
      var t = String(rawTitle || "").trim();
      var s = String(siteName || "").toLowerCase();
      var parts = t.split(/\s+[|–—•·-]\s+/);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p && (!s || p.toLowerCase().indexOf(s) === -1)) return p;
      }
      return t;
    },
    episode: function (url, title) {
      var m = EP_TEXT_RE.exec(String(title || "") + " " + String(url || ""));
      if (!m) return "";
      if (m[1]) return "S" + parseInt(m[1], 10) + " E" + parseInt(m[2], 10);
      if (m[3]) return "S" + parseInt(m[3], 10) + " E" + parseInt(m[4], 10);
      return "E" + parseInt(m[5], 10);
    },
    record: function (urlOrObj, title, siteName, ep) {
      var u = typeof urlOrObj === "object" ? urlOrObj.url : urlOrObj;
      var t = typeof urlOrObj === "object" ? urlOrObj.title : title;
      var s = typeof urlOrObj === "object" ? urlOrObj.site : siteName;
      var e = typeof urlOrObj === "object" ? urlOrObj.ep : ep;
      if (!u || !t) return;
      var list = History.all().filter(function (x) { return x.url !== u && x.title !== t; });
      list.unshift({
        url: u,
        title: t,
        site: s || History.hostLabel(u),
        ep: e || "",
        time: Date.now()
      });
      Store.set("watch_history", list.slice(0, 40));
    },
    remove: function (url) {
      var list = History.all().filter(function (x) { return x.url !== url; });
      Store.set("watch_history", list);
    },
    clear: function () {
      Store.set("watch_history", []);
    }
  };

  function init() {
    // Start service check, and kick off non-blocking site refresh in background
    return initService().then(function () {
      if (Date.now() - Store.get("fmhy_sites_ts", 0) > 12 * 3600 * 1000) {
        Sites.refresh();
      }
      return true;
    });
  }

  return {
    SERVICE_URL: SERVICE_URL,
    isServiceOnline: function () { return serviceOnline; },
    init: init,
    initService: initService,
    fetchText: fetchText,
    proxyStreamUrl: proxyStreamUrl,
    proxyPageUrl: proxyPageUrl,
    colorFor: colorFor,
    colorHash: colorFor,
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
