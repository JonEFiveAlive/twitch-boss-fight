/**
 * Exchanges a refresh token for a fresh access token using your registered
 * Twitch application's Client ID and Client Secret.
 *
 * Twitch access tokens expire (typically a few hours); refresh tokens let you
 * get a new access token without any manual re-authorization, as long as you
 * keep using the latest refresh token (Twitch sometimes rotates it on refresh).
 */
async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Twitch token refresh failed (${response.status}): ${JSON.stringify(data)}`);
  }

  // data: { access_token, refresh_token, expires_in, scope, token_type }
  return data;
}

module.exports = { refreshAccessToken };
