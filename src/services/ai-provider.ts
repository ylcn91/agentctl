
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AuthCredentials, OAuthCredentials } from "./auth-store";
import { setAuth } from "./auth-store";

const OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export async function refreshOAuthToken(creds: OAuthCredentials, accountName: string): Promise<OAuthCredentials> {
  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token", refresh_token: creds.refreshToken, client_id: OAUTH_CLIENT_ID }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OAuth token refresh failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  const json = await resp.json() as { access_token: string; refresh_token: string; expires_in: number };
  const updated: OAuthCredentials = { type: "oauth", accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + json.expires_in * 1000 };
  await setAuth(accountName, updated);
  return updated;
}

export async function ensureFreshCreds(creds: AuthCredentials, accountName: string): Promise<AuthCredentials> {
  if (creds.type === "oauth" && creds.refreshToken && creds.expiresAt < Date.now()) {
    return refreshOAuthToken(creds, accountName);
  }
  return creds;
}

export function createProvider(creds: AuthCredentials) {
  if (creds.type === "oauth") {
    return createAnthropic({ authToken: creds.accessToken });
  }
  return createAnthropic({ apiKey: creds.apiKey });
}
