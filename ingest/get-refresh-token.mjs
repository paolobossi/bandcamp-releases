// One-time helper: obtain a Gmail refresh token with the gmail.modify scope.
//
// 1. Google Cloud Console -> create OAuth client, type "Desktop app".
// 2. Enable the Gmail API for that project.
// 3. Run:  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node ingest/get-refresh-token.mjs
// 4. Open the printed URL, approve, paste the code back.
// 5. Copy the printed refresh_token into the GitHub repo secret GOOGLE_REFRESH_TOKEN.

import http from "node:http";
import { URL } from "node:url";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars first.");
  process.exit(1);
}
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

console.log("\nOpen this URL in your browser and approve:\n\n" + authUrl + "\n");

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) { res.end("no code"); return; }
  res.end("Done — you can close this tab and return to the terminal.");
  server.close();

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT, grant_type: "authorization_code",
    }),
  });
  const j = await r.json();
  if (!j.refresh_token) { console.error("No refresh_token in response:", j); process.exit(1); }
  console.log("\n=== GOOGLE_REFRESH_TOKEN ===\n" + j.refresh_token + "\n============================\n");
  process.exit(0);
});
server.listen(PORT);
