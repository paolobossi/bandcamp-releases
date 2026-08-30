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
  new:    { q: "rating=eq.unrated&order=created_at.desc,id.asc",   empty: "No new releases. All caught up." },
  liked:  { q: "rating=eq.liked&order=updated_at.desc,id.asc",     empty: "Nothing liked yet." },
  later:  { q: "download_later=is.true&order=updated_at.desc,id.asc", empty: "Download-later list is empty." },
  hidden: { q: "rating=eq.hidden&order=updated_at.desc,id.asc",     empty: "Nothing hidden." },
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

async function load() {
  loadingEl.hidden = false;
  emptyEl.hidden = true;
  listEl.innerHTML = "";
  try {
    rows = await api(`/tracks?select=*&${TABS[tab].q}&limit=500`);
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
  $("#laterbar").hidden = tab !== "later" || rows.length === 0;
  if (tab === "later") $("#latercount").textContent = `${rows.length} track${rows.length === 1 ? "" : "s"} to buy`;

  if (!rows.length) {
    emptyEl.textContent = TABS[tab].empty;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  for (const t of rows) {
    const li = document.createElement("li");
    li.className = "row" + (t.id === current ? " playing" : "");
    li.dataset.id = t.id;

    const art = document.createElement("img");
    art.loading = "lazy";
    art.src = artAt(t.artwork_url, 9); // ~210px
    art.alt = "";

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
      btn(t.id === current && !audio.paused ? "⏸" : "▶", "Play / pause", () => playRow(t)),
      btn("♥", "Like → download later", () => toggleLike(t), t.rating === "liked" ? "on-like" : ""),
      tab === "later"
        ? btn("✓", "Got it — remove from download later", () => clearLater(t))
        : btn("🚫", "Hide", () => toggleHide(t), t.rating === "hidden" ? "on-later" : ""),
      link("↗", "Open on Bandcamp", t.bandcamp_release_url || t.bandcamp_track_url),
    );

    li.append(art, info, actions);
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
  if (tab === "later") $("#latercount").textContent = `${rows.length} track${rows.length === 1 ? "" : "s"} to buy`;
}

async function toggleLike(t) {
  const like = t.rating !== "liked";
  await patch(t.id, like ? { rating: "liked", download_later: true } : { rating: "unrated", download_later: false });
  t.rating = like ? "liked" : "unrated";
  t.download_later = like;
  if ((tab === "new" && like) || (tab === "liked" && !like) || (tab === "hidden")) dropRow(t.id);
  else render();
}
async function toggleHide(t) {
  const hide = t.rating !== "hidden";
  await patch(t.id, hide ? { rating: "hidden", download_later: false } : { rating: "unrated" });
  t.rating = hide ? "hidden" : "unrated";
  if (hide) dropRow(t.id); else render();
}
async function clearLater(t) {
  await patch(t.id, { download_later: false });
  t.download_later = false;
  dropRow(t.id);
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

$("#p-toggle").onclick = () => (audio.paused ? audio.play() : audio.pause());
audio.onplay = audio.onpause = () => {
  $("#p-toggle").textContent = audio.paused ? "▶" : "⏸";
  const el = listEl.querySelector(".row.playing .actions button");
  if (el) el.textContent = audio.paused ? "▶" : "⏸";
};
audio.ontimeupdate = () => {
  if (!audio.duration) return;
  $("#p-seek").value = String(Math.round((audio.currentTime / audio.duration) * 1000));
  $("#p-time").textContent = fmtTime(audio.currentTime);
};
audio.onended = () => {
  const i = rows.findIndex((r) => r.id === current);
  if (i > -1 && rows[i + 1]) playRow(rows[i + 1]);
};
$("#p-seek").oninput = () => { if (audio.duration) audio.currentTime = (Number($("#p-seek").value) / 1000) * audio.duration; };
function fmtTime(s) { s = Math.floor(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

// ---------- later bar ----------
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

// ---------- tabs + sync ----------
$("#tabs").onclick = (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  [...$("#tabs").children].forEach((x) => x.classList.toggle("active", x === b));
  tab = b.dataset.tab;
  load();
};

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
showSync();
