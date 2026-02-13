import { atomicWrite, atomicRead, backupFile } from "./services/file-store";
import { HubConfig, AccountConfig, DEFAULT_CONFIG, CONFIG_PATH } from "./types";

const CURRENT_SCHEMA_VERSION = 1;

export function getConfigPath(): string {
  return process.env.CLAUDE_HUB_DIR
    ? `${process.env.CLAUDE_HUB_DIR}/config.json`
    : CONFIG_PATH;
}

export async function loadConfig(path?: string): Promise<HubConfig> {
  const configPath = path ?? getConfigPath();
  const raw = await atomicRead<Record<string, unknown>>(configPath);
  if (!raw) return { ...DEFAULT_CONFIG };

  // Tolerant parsing: use defaults for missing fields
  return {
    schemaVersion: (raw.schemaVersion as number) ?? DEFAULT_CONFIG.schemaVersion,
    accounts: Array.isArray(raw.accounts) ? raw.accounts as AccountConfig[] : [],
    entire: {
      autoEnable: (raw.entire as any)?.autoEnable ?? DEFAULT_CONFIG.entire.autoEnable,
    },
    defaults: {
      launchInNewWindow: (raw.defaults as any)?.launchInNewWindow ?? DEFAULT_CONFIG.defaults.launchInNewWindow,
      quotaPolicy: {
        ...DEFAULT_CONFIG.defaults.quotaPolicy,
        ...((raw.defaults as any)?.quotaPolicy ?? {}),
      },
    },
  };
}

export async function saveConfig(config: HubConfig, path?: string): Promise<void> {
  const configPath = path ?? getConfigPath();
  await atomicWrite(configPath, config);
}

export function addAccount(config: HubConfig, account: AccountConfig): HubConfig {
  if (config.accounts.some((a) => a.name === account.name)) {
    throw new Error(`Account '${account.name}' already exists`);
  }
  return { ...config, accounts: [...config.accounts, account] };
}

export function removeAccount(config: HubConfig, name: string): HubConfig {
  return { ...config, accounts: config.accounts.filter((a) => a.name !== name) };
}

export async function migrateConfig(
  path?: string
): Promise<{ migrated: boolean; backupPath: string | null }> {
  const configPath = path ?? getConfigPath();
  const raw = await atomicRead<Record<string, unknown>>(configPath);
  if (!raw) return { migrated: false, backupPath: null };

  const version = (raw.schemaVersion as number) ?? 0;
  if (version >= CURRENT_SCHEMA_VERSION) return { migrated: false, backupPath: null };

  // Backup before migration
  const bp = await backupFile(configPath, version);

  // Run migration chain (currently only v0 -> v1)
  let data = raw;
  if (version < 1) {
    data = { ...DEFAULT_CONFIG, ...data, schemaVersion: 1 };
  }

  await atomicWrite(configPath, data);
  return { migrated: true, backupPath: bp };
}
