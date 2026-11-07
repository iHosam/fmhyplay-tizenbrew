# FMHYPlay for Samsung Tizen TV (TizenBrew Module)

A complete Samsung Tizen TV port of [fmhyplay/android](https://github.com/fmhyplay/android), built as a native [TizenBrew](https://github.com/reisxd/TizenBrew) `"app"` module with a local Node.js background service (`service/service.js`) for CORS-free stream proxying, header spoofing (`Referer`/`Origin`/`User-Agent`), ad-blocking, stream sniffing, and IPTV stream health probing.

---

## Features Ported from `fmhyplay/android`

- **10-Foot TV UI (`Home.java`)**: Same color palette (`#120E1A` background, `#1E1828` cards, `#FF3B5C` rose accent), 6 top tabs (`Home`, `Movies`, `Series`, `Live TV`, `Browse`, `Settings`), and 2D spatial D-pad navigation.
- **Curated FMHY Site Directory (`Sites.java` + `Cats.java`)**:
  - 95+ hand-picked streaming, anime, live sports, cartoon, drama, documentary, and tracking sites with mirror URLs and search deeplinks.
  - Auto-updates live from `github.com/fmhyplay/sources` (`sources.txt` & `deeplinks.json`).
  - Star/favorite sites to **My Sites** by holding `OK` (or pressing the **Yellow** remote button).
- **Movies & Series Catalog (`Catalog.java` + `TitleActivity.java`)**:
  - Powered by Stremio **Cinemeta v3** (`Trending`, `Top IMDb`, and 13 genres).
  - Full Title Detail screen with seasons, episode lists, instant multi-server embeds (`VidSrc`, `VidLink`, `SuperEmbed`, `2Embed`, `AutoEmbed`), and 1-click search on your top starred FMHY sites.
- **Live TV & IPTV (`Iptv.java` + `IptvActivity.java`)**:
  - 11,000+ free live channels from `iptv-org` organized by **17 Categories** and **50 Countries**.
  - Custom **M3U URL** and **Xtream Codes** (`server` + `username` + `password`) playlists.
  - Concurrent stream health probing via the local TizenBrew Node.js service (`/api/probe-batch`) so dead streams are filtered out automatically.
- **Site Browser, Ad-Blocker, Stream Sniffer & Virtual Pointer (`WebActivity.java` + `Sniffer.java` + `Pointer.java`)**:
  - Local reverse proxy (`/proxy/page`) strips `X-Frame-Options` & `Content-Security-Policy`, blocks 75+ ad/popup domains (`AdBlock.java`), and injects `roles.js`, `frame.js`, `spatnav.js`, and `autosearch.js` into streaming pages.
  - Automatically sniffs `.m3u8` (HLS) and `.mpd` (DASH) streams plus `.vtt`/`.srt` subtitles and hands off to the native player.
  - Built-in **Virtual D-pad Pointer** (toggle with **Green** button) for clicking inside web players.
- **Hardware-Accelerated Video Player (`PlayerActivity.java` + `Subs.java` + `Simkl.java`)**:
  - Plays HLS (`.m3u8` via `hls.js` + local header/manifest rewriter `/proxy/stream`), DASH (`.mpd` via `dash.js`), and MP4/WebM.
  - Live **OpenSubtitles v3** search by IMDb ID + season/episode, SRT-to-WebVTT conversion, and live **Subtitle Size, Position, and Timing (`±0.1s`)** adjustments.
  - **Simkl** PIN authentication and automatic watch scrobbling (`start`, `pause`, `stop`).

---

## How TizenBrew Installs Modules

TizenBrew loads modules from **NPM** or **GitHub** via `https://cdn.jsdelivr.net/<moduleName>/package.json` and stores the list of installed modules on your TV at `/home/owner/share/tizenbrewConfig.json`:

1. **GitHub Repository (`gh/<owner>/<repo>`)**:
   - In the TizenBrew UI on your TV, open **Module Manager → Add Module** and enter:
     ```text
     gh/iHosam/fmhyplay-tizenbrew
     ```
   - TizenBrew fetches `https://cdn.jsdelivr.net/gh/iHosam/fmhyplay-tizenbrew/package.json`, reads `"packageType": "app"`, `"appPath": "app/index.html"`, and `"serviceFile": "service/service.js"`.
2. **NPM Package (`npm/<package-name>`)**:
   - If published to npm (e.g. `npm publish`), enter:
     ```text
     npm/fmhyplay-tizen
     ```
   - Or simply `fmhyplay-tizen` in TizenBrew's Module Manager.

When you click **FMHYPlay** on the TizenBrew launch screen:
- TizenBrew's background service (`port 8081`) starts `service/service.js` inside its Node.js `vm` sandbox on the TV (`127.0.0.1:8087`) and launches the TV browser at `http://127.0.0.1:8081/module/gh%2FiHosam%2Ffmhyplay-tizenbrew/app/index.html`.
- TizenBrew automatically registers all remote control keys listed in `package.json` (`MediaPlay`, `MediaPause`, `ColorF0Red`, `ColorF1Green`, `ColorF2Yellow`, `ColorF3Blue`, etc.).

---

## Remote Control Guide

| Remote Button | Main UI / Catalog / IPTV | Site Browser | Video Player |
| :--- | :--- | :--- | :--- |
| **D-Pad Arrows** | Navigate cards, rows & tabs | Move virtual pointer / top bar | `Left`/`Right`: Seek ±10s, `Down`: Chips |
| **OK / Enter** | Open item / Play | Click at pointer | Play / Pause |
| **Hold OK (0.5s)** | Star site / Save title / Fav channel | — | — |
| **Return / Back** | Previous screen / Focus tab bar | Close browser | Exit player / Exit chip row |
| **Red (`403`)** | Open Global Search | Launch Native Player | — |
| **Green (`404`)** | — | Toggle Virtual Pointer ON/OFF | — |
| **Yellow (`405`)** | Context menu (Star / Mirrors / Remove) | Open Streams & Servers picker | — |
| **Blue (`406`)** | Jump to **Live TV** tab | — | Focus bottom action chips |

---

## Local Testing (PC Browser + Node.js)

You can also run and test the entire module locally on your PC before pushing to GitHub/NPM:

```bash
# 1. Start the background service on 127.0.0.1:8087
node service/service.js

# 2. Serve the app directory on any static HTTP port (e.g. npx serve or python)
npx serve app -l 8080
```
Then open `http://localhost:8080` and navigate using your keyboard Arrow keys, `Enter` (hold `Enter` for context menu), and `Escape` / `Backspace`.
