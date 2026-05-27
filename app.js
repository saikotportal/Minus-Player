// ─────────────────────────────────────
//  minus — app.js  (bug-fixed)
// ─────────────────────────────────────

// ── State ──
const state = {
  tracks: [],
  currentIndex: -1,
  isPlaying: false,
  shuffle: false,
  repeatMode: 'none',
  favorites: new Set(),
};

// ── Audio ──
const audio = new Audio();
audio.volume = 1;

let audioCtx, analyser, source;

function setupAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser  = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source    = audioCtx.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
}

// ── IndexedDB Persistence ──
const DB_NAME = 'minus-db';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('files'))
        d.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('settings'))
        d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(); };
    req.onerror   = ()  => { console.warn('IndexedDB failed'); resolve(); };
  });
}

function dbRun(store, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) { resolve(null); return; }
    const tx  = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbPut(store, obj)  { return dbRun(store, 'readwrite', s => s.put(obj)); }
function dbGetAll(store)    { return dbRun(store, 'readonly',  s => s.getAll()); }
function dbGet(store, key)  { return dbRun(store, 'readonly',  s => s.get(key)); }
async function dbClear(store) {
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function saveSettings() {
  if (!db) return;
  await dbPut('settings', {
    key: 'app',
    currentIndex: state.currentIndex,
    shuffle:      state.shuffle,
    repeatMode:   state.repeatMode,
    favorites:    [...state.favorites],
    currentTime:  isNaN(audio.currentTime) ? 0 : audio.currentTime,
  });
}

async function saveTracks() {
  if (!db) return;
  await dbClear('files');
  for (const t of state.tracks) {
    await dbPut('files', {
      file:    t.file,
      title:   t.title,
      artist:  t.artist,
      emoji:   t.emoji,
      glow:    t.glow,
      artwork: t.artworkBlob || null,
    });
  }
}

function scheduleSave() {
  clearTimeout(scheduleSave._t);
  scheduleSave._t = setTimeout(saveSettings, 800);
}

async function loadPersistedData() {
  if (!db) return false;
  try {
    const [rows, settings] = await Promise.all([dbGetAll('files'), dbGet('settings', 'app')]);
    if (!rows || !rows.length) return false;

    for (const row of rows) {
      if (!row.file) continue;
      const url        = URL.createObjectURL(row.file);
      const artworkUrl = row.artwork ? URL.createObjectURL(row.artwork) : null;
      state.tracks.push({
        url, file: row.file,
        title: row.title, artist: row.artist,
        emoji: row.emoji, glow: row.glow,
        artwork: artworkUrl, artworkBlob: row.artwork || null,
        duration: 0,
      });
    }

    if (settings) {
      state.shuffle    = settings.shuffle    || false;
      state.repeatMode = settings.repeatMode || 'none';
      state.favorites  = new Set(settings.favorites || []);
      document.getElementById('shuffle-btn').classList.toggle('active-mode', state.shuffle);
      document.getElementById('repeat-btn').classList.toggle('active-mode', state.repeatMode !== 'none');

      if (settings.currentIndex >= 0 && settings.currentIndex < state.tracks.length) {
        state.currentIndex = settings.currentIndex;
        const track = state.tracks[state.currentIndex];
        audio.src = track.url;
        audio.load();
        const restoreTime = settings.currentTime || 0;
        audio.addEventListener('loadedmetadata', () => {
          if (restoreTime > 1 && restoreTime < audio.duration - 1)
            audio.currentTime = restoreTime;
        }, { once: true });
        updatePlayerUI();
      }
    }
    return true;
  } catch (err) {
    console.warn('[minus] restore failed:', err);
    return false;
  }
}

function trackKey(t) { return t.file ? `${t.file.name}::${t.file.size}` : t.title; }

function isFav(idx) { return state.favorites.has(trackKey(state.tracks[idx])); }
function toggleFav(idx) {
  const k = trackKey(state.tracks[idx]);
  state.favorites.has(k) ? state.favorites.delete(k) : state.favorites.add(k);
}
// Single consistent music note SVG — shown wherever album art is absent
const TRACK_NOTE_SVG   = `<svg class="track-note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
const TRACK_NOTE_SMALL = `<svg class="track-note-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

const GLOWS  = ['#00e5c8','#ff6b8a','#7b6bff','#ffd166','#00b4d8','#ff9f1c','#06d6a0','#ef476f'];
function trackEmoji(i) { return ''; } // kept for DB compat, unused for display
function trackGlow(i)  { return GLOWS[i % GLOWS.length]; }

// ── Ambient BG ──
const bgCanvas = document.getElementById('bg-canvas');
const bgCtx    = bgCanvas.getContext('2d');
let bgColor    = [0, 229, 200];

function resizeBg() {
  bgCanvas.width  = bgCanvas.offsetWidth;
  bgCanvas.height = bgCanvas.offsetHeight;
}
resizeBg();
window.addEventListener('resize', resizeBg);

const orbs = Array.from({ length: 5 }, () => ({
  x: Math.random(), y: Math.random(),
  vx: (Math.random() - 0.5) * 0.0015,
  vy: (Math.random() - 0.5) * 0.0015,
  r:  0.28 + Math.random() * 0.22,
}));

function drawBg() {
  const W = bgCanvas.width, H = bgCanvas.height;
  bgCtx.clearRect(0, 0, W, H);
  for (const orb of orbs) {
    orb.x += orb.vx; orb.y += orb.vy;
    if (orb.x < 0 || orb.x > 1) orb.vx *= -1;
    if (orb.y < 0 || orb.y > 1) orb.vy *= -1;
    const g = bgCtx.createRadialGradient(orb.x*W, orb.y*H, 0, orb.x*W, orb.y*H, orb.r*Math.max(W,H));
    g.addColorStop(0, `rgba(${bgColor.join(',')},0.055)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, W, H);
  }
  requestAnimationFrame(drawBg);
}
drawBg();

// ── Visualizer ──
const visCanvas = document.getElementById('vis-canvas');
const visCtx    = visCanvas.getContext('2d');
let currentGlowColor = '#00e5c8';

function resizeVis() {
  const w = Math.round(visCanvas.offsetWidth  * devicePixelRatio);
  const h = Math.round(visCanvas.offsetHeight * devicePixelRatio);
  if (visCanvas.width === w && visCanvas.height === h) return;
  visCanvas.width  = w;
  visCanvas.height = h;
  visCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function drawVis() {
  requestAnimationFrame(drawVis);
  if (!analyser) return;
  const W = visCanvas.offsetWidth, H = visCanvas.offsetHeight;
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(buf);
  visCtx.clearRect(0, 0, W, H);
  const count = Math.floor(buf.length * 0.5);
  const barW  = (W / count) * 0.75;
  const gap   = (W / count) * 0.25;
  for (let i = 0; i < count; i++) {
    const h     = (buf[i] / 255) * H * 0.95;
    const alpha = 0.25 + (buf[i] / 255) * 0.7;
    visCtx.fillStyle = hexToRgba(currentGlowColor, alpha);
    visCtx.beginPath();
    visCtx.roundRect(i * (barW + gap), H - h, barW, h, 2);
    visCtx.fill();
  }
}
drawVis();

function hexToRgba(hex, alpha) {
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`;
}
function hexToRgbArr(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

// ── Particles ──
function spawnParticle() {
  if (!state.isPlaying) return;
  const container = document.getElementById('particles-container');
  const p = document.createElement('div');
  p.className = 'particle';
  const colors = [currentGlowColor, '#7b6bff', '#ffd166'];
  p.style.cssText = `left:${10+Math.random()*80}%;bottom:${5+Math.random()*20}%;background:${colors[Math.floor(Math.random()*colors.length)]};width:${2+Math.random()*3}px;height:${2+Math.random()*3}px;animation-duration:${2+Math.random()*3}s;animation-delay:${Math.random()*0.5}s;`;
  container.appendChild(p);
  setTimeout(() => p.remove(), 5000);
}
setInterval(spawnParticle, 400);

// ── Tag extraction ──
function extractArtwork(file) {
  return new Promise((resolve) => {
    if (typeof jsmediatags === 'undefined') { resolve(null); return; }
    jsmediatags.read(file, {
      onSuccess(tag) {
        const pic = tag.tags && tag.tags.picture;
        if (!pic) { resolve(null); return; }
        resolve(new Blob([new Uint8Array(pic.data)], { type: pic.format }));
      },
      onError() { resolve(null); }
    });
  });
}

function extractMeta(file) {
  return new Promise((resolve) => {
    if (typeof jsmediatags === 'undefined') { resolve({}); return; }
    jsmediatags.read(file, {
      onSuccess(tag) {
        const t = tag.tags || {};
        resolve({ title: t.title || null, artist: t.artist || null });
      },
      onError() { resolve({}); }
    });
  });
}

// ── Add files to library ──
async function addFiles(files) {
  const audioFiles = Array.from(files).filter(f =>
    f.type.startsWith('audio/') ||
    /\.(mp3|flac|aac|ogg|wav|m4a|opus|weba|webm)$/i.test(f.name)
  );
  if (!audioFiles.length) return;

  for (const file of audioFiles) {
    if (state.tracks.some(t => t.file && t.file.name === file.name && t.file.size === file.size)) continue;

    const url  = URL.createObjectURL(file);
    const name = file.name.replace(/\.[^.]+$/, '');
    let title = name, artist = 'unknown artist';
    if (name.includes(' - ')) {
      const parts = name.split(' - ');
      artist = parts[0].trim();
      title  = parts.slice(1).join(' - ').trim();
    }

    const [meta, artworkBlob] = await Promise.all([extractMeta(file), extractArtwork(file)]);
    if (meta.title)  title  = meta.title;
    if (meta.artist) artist = meta.artist;

    state.tracks.push({
      url, file, title, artist,
      artwork:     artworkBlob ? URL.createObjectURL(artworkBlob) : null,
      artworkBlob: artworkBlob || null,
      emoji:       trackEmoji(state.tracks.length),
      glow:        trackGlow(state.tracks.length),
      duration:    0,
    });
  }

  renderLibrary();
  saveTracks();
  scheduleSave();
}

// ── FIX: file-input — clone before each use so same-file re-import works ──
// BUG WAS: after e.target.value = '' the change event wouldn't re-fire if
// the user picked the exact same files again on some browsers.
// We now clone the input each time loadFiles() is called to guarantee a fresh element.
function loadFiles() {
  const oldInput = document.getElementById('file-input');
  const fresh = oldInput.cloneNode();
  fresh.id = 'file-input';
  oldInput.parentNode.replaceChild(fresh, oldInput);
  fresh.addEventListener('change', async (e) => {
    await addFiles(e.target.files);
    e.target.value = '';
  });
  fresh.click();
}

// ── Library header import button ──
document.getElementById('load-btn-top').addEventListener('click', loadFiles);

// ── Delegated click handler for dynamically rendered buttons ──
document.getElementById('track-container').addEventListener('click', (e) => {
  if (e.target.closest('#load-btn-main')) { loadFiles(); return; }
  if (e.target.closest('#scan-btn-empty')) { scanDirectory(); return; }
  if (e.target.closest('#rescan-btn')) { scanDirectory(); return; }
  const item = e.target.closest('.track-item');
  if (item) { playTrack(+item.dataset.idx); showPlayer(); }
});

// ── Directory scan ──
function hasFileSystemAccess() { return 'showDirectoryPicker' in window; }

function scanDirectory() {
  if (hasFileSystemAccess()) {
    return scanViaFSA();
  } else {
    return scanViaInput();
  }
}

async function scanViaFSA() {
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    showScanProgress('scanning…');
    const files = await collectAudioFiles(dirHandle);
    hideScanProgress();
    if (!files.length) { showToast('no audio files found'); return; }
    showScanProgress(`importing ${files.length} track${files.length !== 1 ? 's' : ''}…`);
    await addFiles(files);
    hideScanProgress();
    showToast(`added ${files.length} track${files.length !== 1 ? 's' : ''} ✓`);
    renderLibrary();
  } catch (err) {
    hideScanProgress();
    if (err.name !== 'AbortError') { showToast('could not access folder'); }
  }
}

function scanViaInput() {
  const input = document.getElementById('folder-input');
  const fresh = input.cloneNode();
  input.parentNode.replaceChild(fresh, input);
  fresh.id = 'folder-input';
  fresh.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).filter(f =>
      f.type.startsWith('audio/') || /\.(mp3|flac|aac|ogg|wav|m4a|opus|weba|webm)$/i.test(f.name)
    );
    if (!files.length) { showToast('no audio files found'); return; }
    showScanProgress(`importing ${files.length} track${files.length !== 1 ? 's' : ''}…`);
    await addFiles(files);
    hideScanProgress();
    showToast(`added ${files.length} track${files.length !== 1 ? 's' : ''} ✓`);
    renderLibrary();
    e.target.value = '';
  });
  fresh.click();
}

async function collectAudioFiles(dirHandle, depth = 0) {
  const files = [];
  if (depth > 3) return files;
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && /\.(mp3|flac|aac|ogg|wav|m4a|opus|weba|webm)$/i.test(entry.name)) {
      try { files.push(await entry.getFile()); } catch {}
    } else if (entry.kind === 'directory') {
      files.push(...await collectAudioFiles(entry, depth + 1));
    }
  }
  return files;
}

// ── Toasts ──
function showScanProgress(msg) {
  let el = document.getElementById('scan-toast');
  if (!el) { el = document.createElement('div'); el.id = 'scan-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'scan-toast visible';
}
function hideScanProgress() {
  const el = document.getElementById('scan-toast');
  if (el) el.classList.remove('visible');
}
function showToast(msg, duration = 3000) {
  let el = document.getElementById('minus-toast');
  if (!el) { el = document.createElement('div'); el.id = 'minus-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'minus-toast visible';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('visible'), duration);
}

// ── Library Render ──
function renderLibrary() {
  const container = document.getElementById('track-container');
  if (!state.tracks.length) {
    container.innerHTML = `
      <div id="empty-state">
        <div class="empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
        </div>
        <div class="empty-title">nothing here yet</div>
        <div class="empty-sub">import your audio files to begin</div>
        <div class="empty-actions">
          <button class="empty-load-btn" id="scan-btn-empty">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
            scan folder</button>
          <button class="empty-load-btn" id="load-btn-main">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            load files</button>
        </div>
      </div>`;
    return;
  }

  let html = `<div class="section-label">— ${state.tracks.length} track${state.tracks.length !== 1 ? 's' : ''} —`;
  html += `<button class="rescan-btn" id="rescan-btn" title="Re-scan folder">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg></button>`;
  html += `</div><div class="track-list">`;
  state.tracks.forEach((t, i) => {
    const active = i === state.currentIndex;
    html += `<div class="track-item ${active ? 'active' : ''}" data-idx="${i}" style="animation-delay:${i * 0.04}s">
      <div class="track-num">${active && state.isPlaying ? '▶' : i + 1}</div>
      <div class="track-art ${active && state.isPlaying ? 'playing' : ''}">
        ${t.artwork ? `<img src="${t.artwork}" style="width:100%;height:100%;object-fit:cover;">` : TRACK_NOTE_SMALL}
      </div>
      <div class="track-info">
        <div class="track-name">${esc(t.title)}</div>
        <div class="track-artist">${esc(t.artist)}</div>
      </div>
      <div class="track-dur">${t.duration ? fmtTime(t.duration) : '—'}</div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── First-launch dialog ──
const FIRST_LAUNCH_KEY = 'minus-first-launch-v1';

function showFirstLaunchDialog() {
  const overlay = document.createElement('div');
  overlay.id = 'fl-overlay';
  overlay.innerHTML = `
    <div id="fl-dialog">
      <div class="fl-logo"><span class="lib-minus">−</span><span class="lib-name">minus</span></div>
      <div class="fl-title">welcome.</div>
      <div class="fl-sub">how would you like to add your music?</div>
      <div class="fl-options">
        <button class="fl-btn fl-primary" id="fl-scan">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          <div><span>scan a folder</span><span class="fl-hint">finds all audio files automatically</span></div>
        </button>
        <button class="fl-btn fl-secondary" id="fl-pick">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div><span>pick files</span><span class="fl-hint">select individual tracks</span></div>
        </button>
        <button class="fl-btn fl-ghost" id="fl-skip">start empty</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#fl-skip').addEventListener('click', () => {
    localStorage.setItem(FIRST_LAUNCH_KEY, '1');
    overlay.remove();
  });
  overlay.querySelector('#fl-pick').addEventListener('click', () => {
    localStorage.setItem(FIRST_LAUNCH_KEY, '1');
    overlay.remove();
    loadFiles();
  });
  overlay.querySelector('#fl-scan').addEventListener('click', async () => {
    localStorage.setItem(FIRST_LAUNCH_KEY, '1');
    overlay.remove();
    await scanDirectory();
  });
}

// ── FIX: pausedByInterruption declared BEFORE it's used ──
// BUG WAS: `let pausedByInterruption` was declared at line ~777, but the
// togglePlay() function at line ~561 referenced it — a temporal dead zone / hoisting issue.
// Now declared at the top of this section, before any function that uses it.
let pausedByInterruption = false;

// ── Playback ──
function playTrack(idx) {
  if (idx < 0 || idx >= state.tracks.length) return;

  // FIX: Set isPlaying = false BEFORE calling audio.load() so the 'pause' event
  // that load() fires doesn't get misidentified as an external interruption.
  // BUG WAS: audio.load() fires a 'pause' event; the pause listener checked
  // state.isPlaying and set pausedByInterruption = true, breaking track switching.
  state.isPlaying = false;

  state.currentIndex = idx;
  const track = state.tracks[idx];
  audio.src = track.url;
  audio.load();
  audio.play().then(() => {
    setupAudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    state.isPlaying = true;
    updatePlayerUI();
    updateMediaSession();
    renderLibrary();
    scheduleSave();
  }).catch(err => console.warn('Playback error:', err));
}

function togglePlay() {
  if (!state.tracks.length) return;
  if (state.currentIndex === -1) { playTrack(0); return; }
  if (audio.paused) {
    audio.play().then(() => {
      setupAudioContext();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      state.isPlaying = true;
      updatePlayerUI(); renderLibrary();
      updateMediaSession();
    });
  } else {
    pausedByInterruption = false; // user chose to pause — don't auto-resume
    audio.pause();
    state.isPlaying = false;
    updatePlayerUI(); renderLibrary();
    updateMediaSession();
  }
  scheduleSave();
}

function nextTrack() {
  if (!state.tracks.length) return;
  const next = state.shuffle
    ? Math.floor(Math.random() * state.tracks.length)
    : (state.currentIndex + 1) % state.tracks.length;
  playTrack(next);
}

function prevTrack() {
  if (!state.tracks.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  playTrack((state.currentIndex - 1 + state.tracks.length) % state.tracks.length);
}

audio.addEventListener('ended', () => {
  if (state.repeatMode === 'one') { audio.play(); return; }
  if (state.repeatMode === 'all' || state.currentIndex < state.tracks.length - 1) { nextTrack(); return; }
  state.isPlaying = false;
  updatePlayerUI();
  updateMediaSession();
});

audio.addEventListener('loadedmetadata', () => {
  const t = state.tracks[state.currentIndex];
  if (t) { t.duration = audio.duration; renderLibrary(); }
  document.getElementById('dur-time').textContent = fmtTime(audio.duration);
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: 1, position: 0 }); } catch {}
  }
});

audio.addEventListener('timeupdate', () => {
  const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('cur-time').textContent = fmtTime(audio.currentTime);
  const sec = Math.floor(audio.currentTime);
  if (state.isPlaying && sec % 5 === 0 && sec !== (audio._lastSavedSec || -1)) {
    audio._lastSavedSec = sec;
    scheduleSave();
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && audio.duration) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: 1, position: audio.currentTime }); } catch {}
    }
  }
});

// ── Player UI ──
function updatePlayerUI() {
  if (state.currentIndex < 0) return;
  const track = state.tracks[state.currentIndex];

  document.getElementById('now-title').textContent  = track.title;
  document.getElementById('now-artist').textContent = track.artist;

  const artInner = document.getElementById('art-display');
  const emojiEl  = document.getElementById('art-emoji');
  const artImgEl = document.getElementById('art-img');
  if (track.artwork) {
    artImgEl.src = track.artwork; artImgEl.style.display = 'block';
    emojiEl.style.display = 'none'; artInner.classList.add('has-artwork');
  } else {
    emojiEl.innerHTML = TRACK_NOTE_SVG; emojiEl.style.display = 'flex';
    artImgEl.style.display = 'none'; artInner.classList.remove('has-artwork');
  }

  // Marquee
  const titleEl = document.getElementById('now-title');
  const marquee = document.getElementById('title-marquee');
  marquee.classList.remove('scrolling');
  setTimeout(() => {
    if (titleEl.scrollWidth > titleEl.parentElement.offsetWidth) {
      titleEl.textContent = track.title + '   ·   ' + track.title;
      marquee.classList.add('scrolling');
    }
  }, 200);

  const playIcon  = `<polygon points="5 3 19 12 5 21 5 3"/>`;
  const pauseIcon = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
  const icon = state.isPlaying ? pauseIcon : playIcon;
  document.getElementById('play-icon').innerHTML      = icon;
  document.getElementById('pill-play-icon').innerHTML = icon;

  const artCon = document.querySelector('.art-container');
  artCon.classList.toggle('spinning-ring', state.isPlaying);
  document.getElementById('main-play-btn').classList.toggle('is-playing', state.isPlaying);

  currentGlowColor = track.glow;
  document.getElementById('art-glow').style.background = track.glow;
  bgColor = hexToRgbArr(track.glow);

  // Pill
  document.getElementById('np-pill').classList.remove('hidden-pill');
  document.getElementById('pill-name').textContent   = track.title;
  document.getElementById('pill-artist').textContent = track.artist;
  const pillEmoji = document.getElementById('pill-emoji');
  const pillImg   = document.getElementById('pill-img');
  if (track.artwork) {
    pillImg.src = track.artwork; pillImg.style.display = 'block'; pillEmoji.style.display = 'none';
  } else {
    pillEmoji.innerHTML = TRACK_NOTE_SMALL; pillEmoji.style.display = 'flex'; pillImg.style.display = 'none';
  }

  document.getElementById('fav-btn').classList.toggle('active', isFav(state.currentIndex));
  renderQueue();
}

function renderQueue() {
  const qList  = document.getElementById('queue-list');
  const qCount = document.getElementById('queue-count');
  if (!qList) return;

  if (!state.tracks.length) { qList.innerHTML = '<div class="queue-empty">no tracks</div>'; return; }

  qCount.textContent = `${state.tracks.length} track${state.tracks.length !== 1 ? 's' : ''}`;

  qList.innerHTML = state.tracks.map((t, idx) => {
    const isCurrent = idx === state.currentIndex;
    return `<div class="q-item${isCurrent ? ' q-current' : ''}" data-idx="${idx}">
      <div class="q-thumb${isCurrent ? ' q-thumb-playing' : ''}">
        ${t.artwork ? `<img src="${t.artwork}" class="q-thumb-img">` : `<span class="q-thumb-emoji">${TRACK_NOTE_SMALL}</span>`}
        ${isCurrent ? `<div class="q-now-anim"><span></span><span></span><span></span></div>` : ''}
      </div>
      <div class="q-info">
        <div class="q-title${isCurrent ? ' q-title-active' : ''}">${esc(t.title)}</div>
        <div class="q-artist">${esc(t.artist)}</div>
      </div>
      <div class="q-num">${isCurrent ? '▶' : idx + 1}</div>
    </div>`;
  }).join('');

  const currentEl = qList.querySelector('.q-current');
  if (currentEl) setTimeout(() => currentEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 80);

  qList.querySelectorAll('.q-item').forEach(el => {
    el.addEventListener('click', () => { playTrack(+el.dataset.idx); updatePlayerUI(); });
  });
}

// ── View navigation ──
let currentView = 'library';

function showPlayer() {
  if (currentView === 'player') return;
  currentView = 'player';
  history.pushState({ view: 'player' }, '');
  document.getElementById('player-view').classList.remove('hidden');
  document.getElementById('library-view').classList.add('hidden');
  document.getElementById('np-pill').classList.add('hidden-pill');
  resizeVis();
}

function showLibrary() {
  currentView = 'library';
  document.getElementById('library-view').classList.remove('hidden');
  document.getElementById('player-view').classList.add('hidden');
  if (state.currentIndex >= 0) document.getElementById('np-pill').classList.remove('hidden-pill');
}

window.addEventListener('popstate', (e) => {
  if (currentView === 'player') {
    showLibrary();
    history.pushState({ view: 'library' }, '');
  }
});

history.replaceState({ view: 'library' }, '');

// ── Media Session API ──
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const track = state.tracks[state.currentIndex];
  if (!track) return;

  const artworkArr = track.artwork
    ? [{ src: track.artwork, sizes: '512x512', type: track.artworkBlob ? track.artworkBlob.type || 'image/jpeg' : 'image/jpeg' }]
    : [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }];

  navigator.mediaSession.metadata = new MediaMetadata({
    title:  track.title,
    artist: track.artist,
    album:  'minus',
    artwork: artworkArr,
  });

  navigator.mediaSession.setActionHandler('play',          () => { audio.play(); state.isPlaying = true; updatePlayerUI(); updateMediaSession(); });
  navigator.mediaSession.setActionHandler('pause',         () => { pausedByInterruption = false; audio.pause(); state.isPlaying = false; updatePlayerUI(); updateMediaSession(); });
  navigator.mediaSession.setActionHandler('nexttrack',     () => nextTrack());
  navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
  navigator.mediaSession.setActionHandler('seekto',        (d) => { if (audio.duration) audio.currentTime = d.seekTime; });

  navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
}

// ── Audio Focus — pause on interruption, resume when focus returns ──
audio.addEventListener('pause', () => {
  // FIX: only mark as interrupted if we're in the middle of real playback
  // (state.isPlaying = true). When playTrack() calls audio.load(), it fires 'pause'
  // but we now set state.isPlaying = false first, so this branch won't trigger.
  if (state.isPlaying) {
    pausedByInterruption = true;
    state.isPlaying = false;
    updatePlayerUI();
    updateMediaSession();
  }
});

audio.addEventListener('play', () => {
  pausedByInterruption = false;
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (pausedByInterruption && state.currentIndex >= 0) {
      audio.play().then(() => {
        setupAudioContext();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        state.isPlaying = true;
        pausedByInterruption = false;
        updatePlayerUI();
        updateMediaSession();
      }).catch(() => {
        pausedByInterruption = false;
      });
    }
  } else {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
});

// ── Controls ──
document.getElementById('back-btn').addEventListener('click', () => {
  if (currentView === 'player') {
    history.back();
  } else {
    showLibrary();
  }
});
document.getElementById('main-play-btn').addEventListener('click', togglePlay);
document.getElementById('next-btn').addEventListener('click', nextTrack);
document.getElementById('prev-btn').addEventListener('click', prevTrack);
document.getElementById('pill-play').addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
document.getElementById('pill-next').addEventListener('click', (e) => { e.stopPropagation(); nextTrack(); });
document.getElementById('pill-prev').addEventListener('click', (e) => { e.stopPropagation(); prevTrack(); });
document.getElementById('np-pill').addEventListener('click', () => { if (state.currentIndex >= 0) showPlayer(); });

document.getElementById('shuffle-btn').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  document.getElementById('shuffle-btn').classList.toggle('active-mode', state.shuffle);
  scheduleSave();
});

document.getElementById('repeat-btn').addEventListener('click', () => {
  const modes = ['none','all','one'];
  state.repeatMode = modes[(modes.indexOf(state.repeatMode) + 1) % modes.length];
  document.getElementById('repeat-btn').classList.toggle('active-mode', state.repeatMode !== 'none');
  scheduleSave();
});

document.getElementById('fav-btn').addEventListener('click', () => {
  if (state.currentIndex < 0) return;
  toggleFav(state.currentIndex);
  const btn = document.getElementById('fav-btn');
  btn.classList.add('pop');
  setTimeout(() => btn.classList.remove('pop'), 400);
  updatePlayerUI();
  scheduleSave();
});

// ── Progress scrub ──
const progressWrap = document.getElementById('progress-bar-wrap');
let scrubbing = false;
function scrubTo(e) {
  const rect = progressWrap.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  if (audio.duration) audio.currentTime = pct * audio.duration;
}
progressWrap.addEventListener('mousedown',  (e) => { scrubbing = true; scrubTo(e); });
progressWrap.addEventListener('touchstart', (e) => { scrubbing = true; scrubTo(e); }, { passive: true });
window.addEventListener('mousemove',  (e) => { if (scrubbing) scrubTo(e); });
window.addEventListener('touchmove',  (e) => { if (scrubbing) scrubTo(e); }, { passive: true });
window.addEventListener('mouseup',    () => scrubbing = false);
window.addEventListener('touchend',   () => scrubbing = false);

// ── Utils ──
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
}

// Ripple effect
document.querySelectorAll('.ctrl-btn, .play-main, .back-btn, .load-btn, .pill-btn, .empty-load-btn').forEach(btn => {
  btn.addEventListener('click', function(e) {
    const r = document.createElement('span');
    r.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
    btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(r);
    setTimeout(() => r.remove(), 700);
  });
});

// ── About sheet ──
const aboutSheet = document.getElementById('about-sheet');
const aboutClose = document.getElementById('about-close');
const infoBtn    = document.getElementById('info-btn');

if (infoBtn) {
  infoBtn.addEventListener('click', () => aboutSheet.classList.add('open'));
}
if (aboutClose) {
  aboutClose.addEventListener('click', () => aboutSheet.classList.remove('open'));
}
if (aboutSheet) {
  aboutSheet.addEventListener('click', (e) => {
    if (e.target === aboutSheet) aboutSheet.classList.remove('open');
  });
}

// ── Install — permanent button + floating banner + iOS sheet ──
let deferredInstallPrompt = null;
const installBanner  = document.getElementById('install-banner');
const installBtn     = document.getElementById('install-btn');
const installDismiss = document.getElementById('install-dismiss');
const permBtn        = document.getElementById('install-perm-btn');
const iosSheet       = document.getElementById('ios-install-sheet');
const iosSheetClose  = document.getElementById('ios-sheet-close');

const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// FIX: Hide install button and banner when already running as installed PWA
if (isStandalone) {
  installBanner.style.display = 'none';
  if (permBtn) permBtn.classList.add('hidden-installed');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (permBtn && !isStandalone) permBtn.classList.add('pulse');
  if (!isStandalone) {
    setTimeout(() => {
      installBanner.classList.add('visible');
      const autoHide = setTimeout(() => installBanner.classList.remove('visible'), 20000);
      installBanner._autoHide = autoHide;
    }, 2500);
  }
});

// FIX: Install button now correctly handles all three cases:
// 1. Browser supports PWA install prompt (Chrome/Edge/Android) → use deferredInstallPrompt
// 2. iOS Safari → show step-by-step iOS sheet
// 3. Already installed or unsupported browser → show informational toast
if (permBtn) {
  permBtn.addEventListener('click', async () => {
    if (isStandalone) return;
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      console.log('[minus] install:', outcome);
      deferredInstallPrompt = null;
      if (outcome === 'accepted') permBtn.classList.add('hidden-installed');
    } else if (isIOS) {
      iosSheet.classList.add('open');
    } else {
      // FIX: was showing the banner (which is also useless here) — now shows a helpful message
      showToast('open in Chrome or Edge to install as an app');
    }
  });
}

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    clearTimeout(installBanner._autoHide);
    installBanner.classList.remove('visible');
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (outcome === 'accepted') {
        if (permBtn) permBtn.classList.add('hidden-installed');
      }
    } else if (isIOS) {
      iosSheet.classList.add('open');
    }
  });
}

if (installDismiss) {
  installDismiss.addEventListener('click', () => {
    clearTimeout(installBanner._autoHide);
    installBanner.classList.remove('visible');
  });
}

if (iosSheetClose) iosSheetClose.addEventListener('click', () => iosSheet.classList.remove('open'));
if (iosSheet) iosSheet.addEventListener('click', (e) => { if (e.target === iosSheet) iosSheet.classList.remove('open'); });

window.addEventListener('appinstalled', () => {
  installBanner.classList.remove('visible');
  if (permBtn) permBtn.classList.add('hidden-installed');
  deferredInstallPrompt = null;
  showToast('minus installed ✓');
});

// ── PWA service worker ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(r => console.log('[minus] SW:', r.scope))
      .catch(e => console.warn('[minus] SW failed:', e));
  });
}

// ── Session Reset on Close ──
// When the page is unloaded (closed from recent apps / history),
// clear the current-track state so next open starts fresh.
window.addEventListener('pagehide', async () => {
  if (!db) return;
  try {
    const settings = await dbGet('settings', 'app');
    if (settings) {
      await dbPut('settings', {
        ...settings,
        currentIndex: -1,
        currentTime: 0,
      });
    }
  } catch (e) {
    // best-effort — don't throw on unload
  }
});

// ── App Init ──
// FIX: Removed the aggressive auto-launch of scanDirectory() on first load.
// BUG WAS: On first visit, init() immediately triggered scanDirectory() after 800ms
// with no user gesture — this caused the file/folder picker to either be blocked
// by browser popup policies, or pop up unexpectedly before the user was ready.
// Now we show the first-launch dialog instead, which lets the user choose.
(async function init() {
  await openDB();
  const hasData = await loadPersistedData();
  renderLibrary();
  // Always start on the library view — player view must never be visible on open
  document.getElementById('library-view').classList.remove('hidden');
  document.getElementById('player-view').classList.add('hidden');
  currentView = 'library';
  if (!hasData && !localStorage.getItem(FIRST_LAUNCH_KEY)) {
    setTimeout(() => showFirstLaunchDialog(), 300);
  }
})();
