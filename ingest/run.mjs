// Daily ingester: Gmail -> Bandcamp -> Supabase. Runs in GitHub Actions.
//
// Env required:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN  (scope: gmail.modify)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
// Optional:
//   GMAIL_QUERY      (default: from:noreply@bandcamp.com -label:"✅ Done")
//   MAX_EMAILS       (default: 40)
//   DONE_LABEL       (default: "✅ Done")
//   DRY_RUN=1        (parse + print, write nothing, label nothing)

import { extractBandcampUrls, tracksFromPage } from "./parse.mjs";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  GMAIL_QUERY = 'from:noreply@bandcamp.com -label:"✅ Done"',
  MAX_EMAILS = "40",
  DONE_LABEL = "✅ Done",
  DRY_RUN,
} = process.env;

const dry = DRY_RUN === "1" || DRY_RUN === "true";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function need(v, name) {
  if (!v) { console.error(`Missing env ${name}`); process.exit(1); }
  return v;
}

// ---------- Gmail ----------
async function gmailToken() {
  need(GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
  need(GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET");
  need(GOOGLE_REFRESH_TOKEN, "GOOGLE_REFRESH_TOKEN");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

const gapi = (tok) => async (path, init = {}) => {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`gmail ${path} ${r.status}: ${await r.text()}`);
  return r.json();
};

async function ensureDoneLabel(g) {
  const { labels = [] } = await g("/labels");
  const found = labels.find((l) => l.name === DONE_LABEL);
  if (found) return found.id;
  const created = await g("/labels", {
    method: "POST",
    body: JSON.stringify({
      name: DONE_LABEL,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  return created.id;
}

function decodeB64Url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
function collectText(payload) {
  let text = "";
  const walk = (p) => {
    if (!p) return;
    if (p.mimeType === "text/plain" && p.body?.data) text += decodeB64Url(p.body.data) + "\n";
    else if (p.mimeType === "text/html" && p.body?.data && !text) text += decodeB64Url(p.body.data) + "\n";
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return text;
}

// ---------- Bandcamp ----------
async function fetchPage(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
  if (!r.ok) throw new Error(`bandcamp ${url} ${r.status}`);
  return r.text();
}

// ---------- Supabase ----------
async function sb(path, init = {}) {
  need(SUPABASE_URL, "SUPABASE_URL");
  need(SUPABASE_SERVICE_KEY, "SUPABASE_SERVICE_KEY");
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${path} ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

async function upsertTracks(rows) {
  if (!rows.length) return 0;
  // merge-duplicates updates only the columns we send; rating / download_later are untouched.
  await sb("/tracks?on_conflict=bandcamp_track_url", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  return rows.length;
}

// ---------- main ----------
async function main() {
  const started = new Date().toISOString();
  const tok = await gmailToken();
  const g = gapi(tok);
  const doneId = dry ? null : await ensureDoneLabel(g);

  const list = await g(`/messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=${Number(MAX_EMAILS)}`);
  const ids = (list.messages || []).map((m) => m.id);
  console.log(`${ids.length} email(s) match`);

  let emailsProcessed = 0, tracksAdded = 0;
  const seenUrls = new Set();

  for (const id of ids) {
    const msg = await g(`/messages/${id}?format=full`);
    const subject = (msg.payload?.headers || []).find((h) => h.name === "Subject")?.value || "";
    const body = collectText(msg.payload);
    const urls = extractBandcampUrls(body).filter((u) => !/\/fan_unsubscribe|\/email_/.test(u));

    let rowsForEmail = [];
    for (const url of urls) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      try {
        const html = await fetchPage(url);
        const rows = tracksFromPage(url, html).map((r) => ({ ...r, source_email_id: id, source_subject: subject }));
        rowsForEmail.push(...rows);
      } catch (e) {
        console.warn(`  ! ${url} -> ${e.message}`);
      }
    }

    // de-dupe within the email by track url
    const byUrl = new Map(rowsForEmail.map((r) => [r.bandcamp_track_url, r]));
    rowsForEmail = [...byUrl.values()];

    console.log(`- ${subject} :: ${urls.length} link(s), ${rowsForEmail.length} track(s)`);
    if (dry) { rowsForEmail.forEach((r) => console.log(`    ${r.artist} — ${r.title}${r.is_clip_only ? " [clip]" : ""}`)); }
    else {
      tracksAdded += await upsertTracks(rowsForEmail);
      await g(`/messages/${id}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: [doneId] }) });
    }
    emailsProcessed++;
  }

  if (!dry) {
    await sb("/ingest_runs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        started_at: started,
        finished_at: new Date().toISOString(),
        emails_processed: emailsProcessed,
        tracks_added: tracksAdded,
        notes: `query=${GMAIL_QUERY}`,
      }]),
    });
  }
  console.log(`done: ${emailsProcessed} emails, ${tracksAdded} track upserts${dry ? " (dry run)" : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
