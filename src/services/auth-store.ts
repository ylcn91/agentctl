
import { getHubDir } from "../paths";
import path from "path";
import { mkdir } from "node:fs/promises";

export interface OAuthCredentials {
  type: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface ApiKeyCredentials {
  type: "api";
  apiKey: string;
}

export type AuthCredentials = OAuthCredentials | ApiKeyCredentials;

function getAuthDir(): string {
  return path.join(getHubDir(), "auth");
}

function getAuthPath(accountName: string): string {
  return path.join(getAuthDir(), `${accountName}.json`);
}

export async function getAuth(accountName: string): Promise<AuthCredentials | null> {
  const file = Bun.file(getAuthPath(accountName));
  if (!(await file.exists())) return null;
  try {
    const data = await file.json();
    if (data.type === "oauth" && data.accessToken) {
      return data as OAuthCredentials;
    }
    if (data.type === "api" && data.apiKey) {
      return data as ApiKeyCredentials;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setAuth(accountName: string, creds: AuthCredentials): Promise<void> {
  const dir = getAuthDir();
  await mkdir(dir, { recursive: true });
  await Bun.write(getAuthPath(accountName), JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export async function removeAuth(accountName: string): Promise<boolean> {
  const file = Bun.file(getAuthPath(accountName));
  if (!(await file.exists())) return false;
  const { unlink } = await import("node:fs/promises");
  await unlink(getAuthPath(accountName));
  return true;
}

export async function listAuth(): Promise<Record<string, AuthCredentials>> {
  const dir = getAuthDir();
  const { readdir } = await import("node:fs/promises");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return {};
  }
  const result: Record<string, AuthCredentials> = {};
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const name = f.replace(/\.json$/, "");
    const creds = await getAuth(name);
    if (creds) result[name] = creds;
  }
  return result;
}
