# − minus

A minimal, animated local music player — installable as an app on any device.  
No app store. No account. No internet required after first load.

---

## Files

Live -- https://minusplayer.netlify.app

```
minus/
├── index.html      — app shell
├── style.css       — theme, layout & animations
├── app.js          — playback logic & PWA wiring
├── manifest.json   — PWA manifest (name, icons, theme)
├── sw.js           — service worker (offline caching)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## Installing the App

minus is a **Progressive Web App (PWA)** — it installs like a native app directly from the browser.

### On Android (Chrome)
1. Open `index.html` via a local server (see below) or hosted URL
2. Tap the **install** banner that appears, or tap ⋮ → **Add to Home Screen**
3. minus appears on your home screen like any other app

### On iPhone / iPad (Safari)
1. Open the page in Safari
2. Tap the **Share** button → **Add to Home Screen**
3. Tap **Add** — minus is now on your home screen

### On Desktop (Chrome / Edge)
1. Open the page
2. Click the **install** icon in the address bar (or the install banner)
3. Click **Install** — minus opens in its own window with no browser chrome

---

## Running Locally (required for PWA features)

Service workers only work over HTTPS or `localhost`.  
Serve the folder with any simple static server:

**Python** (built-in):
```bash
cd minus
python3 -m http.server 8080
# open http://localhost:8080
```

**Node.js**:
```bash
npx serve minus
# or
npx http-server minus -p 8080
```

**VS Code**: use the **Live Server** extension, right-click `index.html` → Open with Live Server.

Then open the URL in your browser and install from there.

---

## Features

- **Local file playback** — audio stays on your device, nothing uploaded
- **Installable PWA** — works as a standalone app on phone & desktop
- **Offline support** — app shell cached by service worker after first visit
- **Library view** — scrollable track list with artist & duration
- **Player view** — full-screen now-playing with album art & visualizer
- **Audio visualizer** — real-time frequency bars on the art canvas
- **Floating particles** — animated particles while music plays
- **Shuffle & repeat** — repeat one, repeat all, or shuffle
- **Favourites** — heart tracks with a pop animation
- **Now playing pill** — mini-player when browsing library
- **Marquee titles** — long names scroll automatically

---

## Supported Audio Formats

| Format | Chrome | Firefox | Safari |
|--------|--------|---------|--------|
| MP3    | ✓      | ✓       | ✓      |
| AAC    | ✓      | ✓       | ✓      |
| OGG    | ✓      | ✓       | —      |
| FLAC   | ✓      | ✓       | ✓      |
| WAV    | ✓      | ✓       | ✓      |

---

## Filename Tip

Name files `Artist - Title.mp3` for automatic artist/title splitting.

---

## Color Theme

| Role        | Value     |
|-------------|-----------|
| Background  | `#080b12` |
| Teal accent | `#00e5c8` |
| Coral/rose  | `#ff6b8a` |
| Violet      | `#7b6bff` |
| Amber       | `#ffd166` |

---

## License

Do whatever you want with it.
