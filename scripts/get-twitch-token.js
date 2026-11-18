/**
 * ONE-TIME SETUP SCRIPT.
 *
 * Run this once to authorize your registered Twitch application against your
 * BOT account and obtain a refresh token. After this, the main server
 * (src/server.js) uses that refresh token to fetch new access tokens on its
 * own — you should not need to run this again unless the refresh token is
 * ever revoked.
 *
 * Usage:
 *   1. Make sure TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set in .env
 *      (from https://dev.twitch.tv/console).
 *   2. Make sure the redirect URI below is added EXACTLY (including http://
 *      and the port) to your application's "OAuth Redirect URLs" in the
 *      Twitch dev console.
 *   3. Run: npm run get-token
 *   4. In your browser, log in to Twitch AS YOUR BOT ACCOUNT first.
 *   5. Open the URL this script prints, and click Authorize.
 *   6. Copy the TWITCH_REFRESH_TOKEN line it prints into your .env file.
 */

require("dotenv").config();
const express = require("express");

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = process.env.TWITCH_REDIRECT_URI || "http://localhost:3001/oauth/callback";
const SCOPES = ["chat:read", "chat:edit"].join(" ");
const SETUP_PORT = 3001; // separate from the main app's PORT so both can exist in .env without clashing

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in your .env first.");
  process.exit(1);
}

const app = express();

app.get("/oauth/callback", async (req, res) => {
  const { code, error, error_description: errorDescription } = req.query;

  if (error) {
    res.send(`Authorization failed: ${errorDescription || error}`);
    return;
  }

  try {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI
    });

    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    const data = await response.json();

    if (!response.ok) {
      res.send(`Token exchange failed: ${JSON.stringify(data)}`);
      console.error("Token exchange failed:", data);
      setTimeout(() => process.exit(1), 500);
      return;
    }

    console.log("\n=== Success! Add this line to your .env file: ===");
    console.log(`TWITCH_REFRESH_TOKEN=${data.refresh_token}`);
    console.log("===================================================\n");

    res.send("Success! Check your terminal for the refresh token — copy it into .env. You can close this tab.");
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    console.error(err);
    res.send("Something went wrong — check the terminal for details.");
    setTimeout(() => process.exit(1), 500);
  }
});

app.listen(SETUP_PORT, () => {
  const authUrl =
    `https://id.twitch.tv/oauth2/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}`;

  console.log("\nStep 1: In your browser, log in to Twitch AS YOUR BOT ACCOUNT (not your streamer account).");
  console.log("Step 2: Then open this URL and click Authorize:\n");
  console.log(authUrl);
  console.log("\nWaiting for authorization... (this script will exit automatically once done)\n");
});
