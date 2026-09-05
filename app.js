"use strict";
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.BC_CONFIG;
const REST = `${SUPABASE_URL}/rest/v1`;
const FN = `${SUPABASE_URL}/functions/v1`;
const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

const $ = (s) => document.querySelector(s);
const listEl = $("#list");
const emptyEl = $("#empty");
const loadingEl = $("#loading");
const audio = $("#audio");

// ---------- icons (no emoji, inline SVG only) ----------
const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>`;
const ICON_PREV = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>`;
const ICON_NEXT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`;
const ICON_HEART_FILLED = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
const ICON_HEART_OUT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/></svg>`;
const ICON_HIDE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const ICON_LINK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
const ICON_SPINNER = `<svg viewBox="0 0 24 24" class="spinner" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="9" stroke-dasharray="40 100"/></svg>`;

const TABS = {
  new:    { q: "rating=eq.unrated", empty: "No new releases. All caught up." },
  liked:  { q: "rating=eq.liked",   empty: "Nothing liked yet." },
  hidden: { q: "rating=eq.hidden",  empty: "Nothing hidden." },
};
const TAB_RATING = { new: "unrated", liked: "liked", hidden: "hidden" };
let tab = "new";
let rows = [];
let current = null; // currently loaded track id
let currentTrack = null; // currently loaded track object
let currentGhostIndex = null; // where `current` was in `rows` just before it got removed (like/hide)

// ---------- data ----------
async function api(path, opts = {}) {
  const r = await fetch(`${REST}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

function releaseKey(t) { return t.bandcamp_release_url || t.bandcamp_track_url; }

// Recency-ordered, but tracks from the same release stay grouped and in track order.
function groupByRelease(list) {
  const order = [];
  const groups = new Map();
  for (const t of list) {
    const k = releaseKey(t);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k).push(t);
  }
  const out = [];
  for (const k of order) {
    const g = groups.get(k);
    g.sort((a, b) => (a.track_num ?? 999) - (b.track_num ?? 999) || a.title.localeCompare(b.title));
    out.push(...g);
  }
  return out;
}

async function load() {
  loadingEl.hidden = false;
  emptyEl.hidden = true;
  listEl.innerHTML = "";
  currentGhostIndex = null; // stale once `rows` gets replaced by a fresh fetch
  try {
    const raw = await api(`/tracks?select=*&${TABS[tab].q}&order=created_at.desc&limit=1000`);
    rows = groupByRelease(raw);
  } catch (e) {
    loadingEl.textContent = "Failed to load: " + e.message;
    return;
  }
  loadingEl.hidden = true;
  render();
}

async function patch(id, body) {
  await api(`/tracks?id=eq.${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}

// ---------- render ----------
function fmtDate(d) {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function render() {
  listEl.innerHTML = "";
  $("#hiddenbar").hidden = tab !== "hidden" || rows.length === 0;
  if (tab === "hidden") $("#hiddencount").textContent = `${rows.length} hidden track${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    emptyEl.textContent = TABS[tab].empty;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const groupSize = new Map();
  for (const t of rows) { const k = releaseKey(t); groupSize.set(k, (groupSize.get(k) || 0) + 1); }

  let lastKey = null;
  let firstRow = true;
  for (const t of rows) {
    const key = releaseKey(t);
    const isNewGroup = key !== lastKey;
    if (isNewGroup) {
      lastKey = key;
      if (groupSize.get(key) > 1) {
        const header = document.createElement("li");
        header.className = "group-header";
        const spacer = document.createElement("div");
        const gtitle = document.createElement("div");
        gtitle.className = "gh-title";
        gtitle.textContent = `${t.artist}${t.album ? " · " + t.album : ""}`;
        const gactions = document.createElement("div");
        gactions.className = "actions";
        gactions.append(
          btn(ICON_HEART_OUT, "Like this entire release", () => likeRelease(key)),
          btn(ICON_HIDE, "Hide this entire release", () => hideRelease(key)),
          link(ICON_LINK, "Open on Bandcamp", t.bandcamp_release_url || t.bandcamp_track_url),
        );
        header.append(spacer, gtitle, gactions);
        listEl.append(header);
      }
    }

    const li = document.createElement("li");
    const needsBorder = isNewGroup && !firstRow && groupSize.get(key) === 1;
    li.className = "row" + (t.id === current ? " playing" : "") + (needsBorder ? " newgroup" : "");
    firstRow = false;
    li.dataset.id = t.id;

    const artWrap = document.createElement("div");
    artWrap.className = "art-wrap";
    const art = document.createElement("img");
    art.loading = "lazy";
    art.src = artAt(t.artwork_url, 9);
    art.alt = "";
    const playOverlay = btn(t.id === current && !audio.paused ? ICON_PAUSE : ICON_PLAY, "Play / pause", () => playRow(t));
    playOverlay.className = "play-overlay";
    artWrap.append(art, playOverlay);

    const info = document.createElement("div");
    info.className = "info";
    const sub = [t.artist, t.album, fmtDate(t.released_at)].filter(Boolean).join(" · ");
    info.innerHTML =
      `<div class="t">${esc(t.title)}${t.is_clip_only ? '<span class="clip">clip</span>' : ""}</div>` +
      `<div class="s">${esc(sub)}</div>`;
    info.style.cursor = "pointer";
    info.onclick = () => playRow(t);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      btn(t.rating === "liked" ? ICON_HEART_FILLED : ICON_HEART_OUT, "Like", () => toggleLike(t), t.rating === "liked" ? "on-like" : ""),
      btn(ICON_HIDE, "Hide", () => toggleHide(t), t.rating === "hidden" ? "on-later" : ""),
      link(ICON_LINK, "Open on Bandcamp", t.bandcamp_release_url || t.bandcamp_track_url),
    );

    li.append(artWrap, info, actions);
    listEl.append(li);
  }
}

function btn(html, title, onclick, cls = "") {
  const b = document.createElement("button");
  b.innerHTML = html; b.title = title; if (cls) b.className = cls;
  b.onclick = (e) => { e.stopPropagation(); onclick(); };
  return b;
}
function link(html, title, href) {
  const a = document.createElement("a");
  a.innerHTML = html; a.title = title; a.href = href || "#";
  a.target = "_blank"; a.rel = "noopener"; a.className = "icon-link";
  a.onclick = (e) => e.stopPropagation();
  return a;
}
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
// Bandcamp art comes in sized variants; _10 is ~1200px. Downscale for thumbs.
function artAt(url, size) { return url ? url.replace(/_\d+\.jpg$/i, `_${size}.jpg`) : ""; }

// ---------- actions ----------
// Removing the currently-playing track from `rows` breaks id-based lookup for
// prev/next. Before removing, remember where it *would* land so playback can
// still step to the track that took its place instead of jumping to index 0.
function removeFromRows(ids) {
  const idSet = new Set(ids);
  if (idSet.has(current)) {
    const oldIdx = rows.findIndex((r) => r.id === current);
    const removedBefore = rows.slice(0, oldIdx).filter((r) => idSet.has(r.id)).length;
    currentGhostIndex = oldIdx - removedBefore;
  }
  rows = rows.filter((r) => !idSet.has(r.id));
}

async function toggleLike(t) {
  const like = t.rating !== "liked";
  await patch(t.id, { rating: like ? "liked" : "unrated" });
  t.rating = like ? "liked" : "unrated";
  if ((tab === "new" && like) || (tab === "liked" && !like)) removeFromRows([t.id]);
  render();
  updatePlayerActions();
}
async function toggleHide(t) {
  const hide = t.rating !== "hidden";
  await patch(t.id, { rating: hide ? "hidden" : "unrated" });
  t.rating = hide ? "hidden" : "unrated";
  if (hide) removeFromRows([t.id]);
  render();
  updatePlayerActions();
}
async function patchRelease(key, rating) {
  const group = rows.filter((r) => releaseKey(r) === key);
  if (!group.length) return;
  const col = group[0].bandcamp_release_url === key ? "bandcamp_release_url" : "bandcamp_track_url";
  // Scope to the rating currently shown in this tab, so a track rated
  // differently elsewhere (e.g. already liked) is never clobbered by a
  // bulk release action taken from another tab.
  await api(`/tracks?${col}=eq.${encodeURIComponent(key)}&rating=eq.${TAB_RATING[tab]}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ rating }),
  });
  for (const t of group) t.rating = rating;
  if (tab !== rating) removeFromRows(group.map((t) => t.id));
  render();
  updatePlayerActions();
}
function hideRelease(key) { return patchRelease(key, "hidden"); }
function likeRelease(key) { return patchRelease(key, "liked"); }

// ---------- playback ----------
async function playRow(t) {
  if (current === t.id) { audio.paused ? audio.play() : audio.pause(); return; }
  current = t.id;
  currentTrack = t;
  currentGhostIndex = null;
  render();
  $("#player").hidden = false;
  $("#p-art").src = artAt(t.artwork_url, 16); // ~700px
  $("#p-title").textContent = t.title;
  $("#p-artist").textContent = t.artist || "";
  $("#p-toggle").innerHTML = ICON_SPINNER;
  updatePlayerActions();
  try {
    let url = t.stream_url;
    // stored URL expires within ~a day — always refresh via the resolver
    const r = await fetch(`${FN}/resolve-stream?track_url=${encodeURIComponent(t.bandcamp_track_url)}`, { headers: H });
    const j = await r.json();
    if (j && j.url) url = j.url;
    if (!url) { $("#p-title").textContent = t.title + " — not streamable"; $("#p-toggle").innerHTML = ICON_PLAY; return; }
    audio.src = url;
    await audio.play();
  } catch (e) {
    $("#p-toggle").innerHTML = ICON_PLAY;
    $("#p-title").textContent = t.title + " — playback error";
  }
}

// `currentGhostIndex` (set by removeFromRows) already points at whichever
// track slid into the removed track's slot, i.e. the correct "next" track.
function nextIndex() {
  const idx = rows.findIndex((r) => r.id === current);
  return idx > -1 ? idx + 1 : (currentGhostIndex ?? 0);
}
function prevIndex() {
  const idx = rows.findIndex((r) => r.id === current);
  return idx > -1 ? idx - 1 : (currentGhostIndex ?? 0) - 1;
}
function playAt(i) { if (rows[i]) playRow(rows[i]); }

function updatePlayerActions() {
  if (!currentTrack) return;
  const liked = currentTrack.rating === "liked";
  const hidden = currentTrack.rating === "hidden";
  const likeBtn = $("#p-like"), hideBtn = $("#p-hide");
  likeBtn.innerHTML = liked ? ICON_HEART_FILLED : ICON_HEART_OUT;
  likeBtn.classList.toggle("on-like", liked);
  hideBtn.classList.toggle("on-later", hidden);
}

$("#p-prev").innerHTML = ICON_PREV;
$("#p-next").innerHTML = ICON_NEXT;
$("#p-toggle").innerHTML = ICON_PLAY;
$("#p-like").innerHTML = ICON_HEART_OUT;
$("#p-hide").innerHTML = ICON_HIDE;

$("#p-toggle").onclick = () => (audio.paused ? audio.play() : audio.pause());
$("#p-prev").onclick = () => playAt(prevIndex());
$("#p-next").onclick = () => playAt(nextIndex());
$("#p-like").onclick = () => currentTrack && toggleLike(currentTrack);
$("#p-hide").onclick = () => currentTrack && toggleHide(currentTrack);
audio.onplay = audio.onpause = () => {
  $("#p-toggle").innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
  const el = listEl.querySelector(".row.playing .play-overlay");
  if (el) el.innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
};
audio.ontimeupdate = () => {
  if (!audio.duration) return;
  $("#p-seek").value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  $("#p-time").textContent = fmtTime(audio.currentTime);
};
audio.onended = () => playAt(nextIndex());
$("#p-seek").oninput = () => { if (audio.duration) audio.currentTime = (Number($("#p-seek").value) / 1000) * audio.duration; };
function fmtTime(s) { s = Math.floor(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

// ---------- hidden-tab cleanup ----------
$("#deleteall").onclick = async () => {
  if (!rows.length) return;
  const ids = rows.map((r) => r.id);
  const n = ids.length;
  if (!confirm(`Permanently delete ${n} hidden track${n === 1 ? "" : "s"} from the database? This can't be undone.`)) return;
  await api(`/tracks?id=in.(${ids.join(",")})`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  removeFromRows(ids);
  render();
  updatePlayerActions();
  showStats();
};

// ---------- tabs + header stats ----------
$("#tabs").onclick = (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  [...$("#tabs").children].forEach((x) => x.classList.toggle("active", x === b));
  tab = b.dataset.tab;
  load();
};

async function showStats() {
  try {
    const all = await api(`/tracks?select=bandcamp_release_url,bandcamp_track_url`);
    const releases = new Set(all.map((r) => r.bandcamp_release_url || r.bandcamp_track_url));
    $("#stats").textContent = `${all.length} track${all.length === 1 ? "" : "s"} from ${releases.size} release${releases.size === 1 ? "" : "s"}`;
  } catch { /* ignore */ }
}

async function showSync() {
  try {
    const [r] = await api(`/ingest_runs?select=finished_at,tracks_added&order=finished_at.desc&limit=1`);
    if (r?.finished_at) {
      const d = new Date(r.finished_at);
      $("#sync").textContent = `synced ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
    }
  } catch { /* table may be empty */ }
}

load();
showStats();
showSync();
