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

const TABS = {
  new:    { q: "rating=eq.unrated", empty: "No new releases. All caught up." },
  liked:  { q: "rating=eq.liked",   empty: "Nothing liked yet." },
  hidden: { q: "rating=eq.hidden",  empty: "Nothing hidden." },
};
let tab = "new";
let rows = [];
let current = null; // currently loaded track id

// ---------- data ----------
async function api(path, opts = {}) {
  const r = await fetch(`${REST}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
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
  $("#laterbar").hidden = tab !== "liked" || rows.length === 0;
  if (tab === "liked") $("#latercount").textContent = `${rows.length} liked track${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    emptyEl.textContent = TABS[tab].empty;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  let lastKey = null;
  for (const t of rows) {
    const key = releaseKey(t);
    const isNewGroup = key !== lastKey && lastKey !== null;
    const li = document.createElement("li");
    li.className = "row" + (t.id === current ? " playing" : "") + (isNewGroup ? " newgroup" : "");
    lastKey = key;
    li.dataset.id = t.id;

    const artWrap = document.createElement("div");
    artWrap.className = "art-wrap";
    const art = document.createElement("img");
    art.loading = "lazy";
    art.src = artAt(t.artwork_url, 9);
    art.alt = "";
    const playOverlay = btn(t.id === current && !audio.paused ? "⏸" : "▶", "Play / pause", () => playRow(t));
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
      btn("♥", "Like", () => toggleLike(t), t.rating === "liked" ? "on-like" : ""),
      btn("🚫", "Hide", () => toggleHide(t), t.rating === "hidden" ? "on-later" : ""),
      link("↗", "Open on Bandcamp", t.bandcamp_release_url || t.bandcamp_track_url),
    );

    li.append(artWrap, info, actions);
    listEl.append(li);
  }
}

function btn(label, title, onclick, cls = "") {
  const b = document.createElement("button");
  b.textContent = label; b.title = title; if (cls) b.className = cls;
  b.onclick = (e) => { e.stopPropagation(); onclick(); };
  return b;
}
function link(label, title, href) {
  const a = document.createElement("a");
  a.textContent = label; a.title = title; a.href = href || "#";
  a.target = "_blank"; a.rel = "noopener";
  a.style.cssText = "width:34px;height:34px;display:grid;place-items:center;color:var(--muted);text-decoration:none;border-radius:8px";
  a.onclick = (e) => e.stopPropagation();
  return a;
}
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
// Bandcamp art comes in sized variants; _10 is ~1200px. Downscale for thumbs.
function artAt(url, size) { return url ? url.replace(/_\d+\.jpg$/i, `_${size}.jpg`) : ""; }

// ---------- actions ----------
function dropRow(id) {
  rows = rows.filter((r) => r.id !== id);
  const el = listEl.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
  if (!rows.length) render();
  if (tab === "liked") $("#latercount").textContent = `${rows.length} liked track${rows.length === 1 ? "" : "s"}`;
}

async function toggleLike(t) {
  const like = t.rating !== "liked";
  await patch(t.id, { rating: like ? "liked" : "unrated" });
  t.rating = like ? "liked" : "unrated";
  if ((tab === "new" && like) || (tab === "liked" && !like)) dropRow(t.id);
  else render();
}
async function toggleHide(t) {
  const hide = t.rating !== "hidden";
  await patch(t.id, { rating: hide ? "hidden" : "unrated" });
  t.rating = hide ? "hidden" : "unrated";
  if (hide) dropRow(t.id); else render();
}

// ---------- playback ----------
async function playRow(t) {
  if (current === t.id) { audio.paused ? audio.play() : audio.pause(); return; }
  current = t.id;
  render();
  $("#player").hidden = false;
  $("#p-art").src = artAt(t.artwork_url, 16); // ~700px
  $("#p-title").textContent = t.title;
  $("#p-artist").textContent = t.artist || "";
  $("#p-toggle").textContent = "…";
  try {
    let url = t.stream_url;
    // stored URL expires within ~a day — always refresh via the resolver
    const r = await fetch(`${FN}/resolve-stream?track_url=${encodeURIComponent(t.bandcamp_track_url)}`, { headers: H });
    const j = await r.json();
    if (j && j.url) url = j.url;
    if (!url) { $("#p-title").textContent = t.title + " — not streamable"; $("#p-toggle").textContent = "▶"; return; }
    audio.src = url;
    await audio.play();
  } catch (e) {
    $("#p-toggle").textContent = "▶";
    $("#p-title").textContent = t.title + " — playback error";
  }
}

function currentIndex() { return rows.findIndex((r) => r.id === current); }
function playAt(i) { if (rows[i]) playRow(rows[i]); }

$("#p-toggle").onclick = () => (audio.paused ? audio.play() : audio.pause());
$("#p-prev").onclick = () => playAt(currentIndex() - 1);
$("#p-next").onclick = () => playAt(currentIndex() + 1);
audio.onplay = audio.onpause = () => {
  $("#p-toggle").textContent = audio.paused ? "▶" : "⏸";
  const el = listEl.querySelector(".row.playing .play-overlay");
  if (el) el.textContent = audio.paused ? "▶" : "⏸";
};
audio.ontimeupdate = () => {
  if (!audio.duration) return;
  $("#p-seek").value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  $("#p-time").textContent = fmtTime(audio.currentTime);
};
audio.onended = () => playAt(currentIndex() + 1);
$("#p-seek").oninput = () => { if (audio.duration) audio.currentTime = (Number($("#p-seek").value) / 1000) * audio.duration; };
function fmtTime(s) { s = Math.floor(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

// ---------- liked-tab bulk actions ----------
$("#openall").onclick = () => {
  const urls = [...new Set(rows.map((r) => r.bandcamp_release_url || r.bandcamp_track_url).filter(Boolean))];
  urls.slice(0, 12).forEach((u, i) => setTimeout(() => window.open(u, "_blank", "noopener"), i * 250));
  if (urls.length > 12) alert(`Opened first 12 of ${urls.length}. Use "Copy links" for the rest.`);
};
$("#copylinks").onclick = async () => {
  const urls = [...new Set(rows.map((r) => r.bandcamp_release_url || r.bandcamp_track_url).filter(Boolean))];
  await navigator.clipboard.writeText(urls.join("\n"));
  $("#copylinks").textContent = "Copied ✓";
  setTimeout(() => ($("#copylinks").textContent = "Copy links"), 1500);
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
