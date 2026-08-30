// Pure Bandcamp parsing helpers — no network I/O lives here.
// Used by both the GitHub Actions ingester (ingest/run.mjs) and any manual run.

const BC_URL_RE =
  /https?:\/\/([a-z0-9][a-z0-9-]*\.bandcamp\.com)\/(album|track)\/([a-z0-9%_-]+)/gi;

/** Pull unique, query-stripped album/track URLs out of an email body. */
export function extractBandcampUrls(text) {
  const out = new Set();
  let m;
  while ((m = BC_URL_RE.exec(text || ""))) {
    out.add(`https://${m[1].toLowerCase()}/${m[2].toLowerCase()}/${m[3].toLowerCase()}`);
  }
  return [...out];
}

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => safeCp(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCp(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}
function safeCp(n) {
  try { return String.fromCodePoint(n); } catch { return ""; }
}

/** Extract Bandcamp's embedded data-tralbum JSON blob from a page's HTML. */
export function parseTralbum(html) {
  let m = html.match(/data-tralbum="([^"]+)"/);
  if (m) { const j = tryJson(decodeEntities(m[1])); if (j) return j; }
  m = html.match(/data-tralbum='([^']+)'/);
  if (m) { const j = tryJson(m[1]); if (j) return j; }
  m = html.match(/data-tralbum=(\{(?:[^{}]|\{[^{}]*\})*\})/);
  if (m) { const j = tryJson(m[1]); if (j) return j; }
  return null;
}

export function parseBand(html) {
  const m = html.match(/data-band="([^"]+)"/);
  if (m) { const j = tryJson(decodeEntities(m[1])); if (j) return j; }
  return null;
}

function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function ogImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function normStream(u) {
  if (!u) return null;
  return u.startsWith("//") ? "https:" + u : u;
}

function normDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(+dt) ? null : dt.toISOString().slice(0, 10);
}

/**
 * Given a fetched Bandcamp album/track page, return one row per track.
 * pageUrl is the canonical URL the email pointed at.
 */
export function tracksFromPage(pageUrl, html) {
  const t = parseTralbum(html);
  if (!t) return [];
  const band = parseBand(html);
  const origin = new URL(pageUrl).origin;

  const albumTitle = t.current?.title ?? t.album_title ?? null;
  const albumArtist =
    (t.artist || t.current?.artist || band?.name || "Unknown").trim();

  const isAlbum = t.item_type === "album" || /\/album\//.test(pageUrl);
  let releasePath = new URL(pageUrl).pathname;
  if (isAlbum && t.url) {
    try { releasePath = new URL(t.url, origin).pathname; } catch { /* keep */ }
  }
  const releaseUrl = isAlbum ? origin + releasePath : (t.album_url ? origin + t.album_url : null);

  const artId = t.art_id ?? t.current?.art_id;
  const artwork = artId ? `https://f4.bcbits.com/img/a${artId}_10.jpg` : ogImage(html);
  const releaseDate = normDate(t.current?.release_date ?? t.album_release_date);

  const info = Array.isArray(t.trackinfo) ? t.trackinfo : [];
  const rows = info
    .filter((ti) => ti && ti.title)
    .map((ti, idx) => {
      const slug = typeof ti.title_link === "string" ? ti.title_link : "";
      // Locked/preorder bonus tracks often have no title_link at all; fall back
      // to a URL unique per track (not the shared album URL) so they don't
      // collide and overwrite each other.
      const base = slug ? origin + slug : `${pageUrl}#locked-${ti.track_num ?? idx + 1}`;
      const trackUrl = base.toLowerCase().split("?")[0];
      const stream = normStream(ti.file && (ti.file["mp3-128"] || ti.file["mp3-v0"]));
      return {
        bandcamp_track_url: trackUrl,
        bandcamp_release_url: releaseUrl || (isAlbum ? pageUrl : null),
        title: String(ti.title).trim(),
        artist: (ti.artist || albumArtist || "Unknown").trim(),
        album: isAlbum
          ? albumTitle
          : (albumTitle && albumTitle !== ti.title ? albumTitle : null),
        artwork_url: artwork,
        duration: typeof ti.duration === "number" ? ti.duration : null,
        released_at: releaseDate,
        is_clip_only: !stream || ti.is_capped === true,
        stream_url: stream,
        track_num: typeof ti.track_num === "number" ? ti.track_num : null,
      };
    });

  // Single-track page that somehow had no trackinfo: synthesise a minimal row.
  if (!rows.length && !isAlbum) {
    return [{
      bandcamp_track_url: pageUrl.toLowerCase().split("?")[0],
      bandcamp_release_url: null,
      title: t.current?.title ?? albumTitle ?? "Unknown",
      artist: albumArtist,
      album: null,
      artwork_url: artwork,
      duration: null,
      released_at: releaseDate,
      is_clip_only: true,
      stream_url: null,
      track_num: 1,
    }];
  }
  return rows;
}
