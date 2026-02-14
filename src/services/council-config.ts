// Council pre-analysis configuration — account-based members and chairman

export interface CouncilServiceConfig {
  members: string[];  // account names from config.accounts
  chairman: string;   // account name
  timeoutMs?: number;
}

export const DEFAULT_COUNCIL_CONFIG: CouncilServiceConfig = {
  members: [],
  chairman: "",
  timeoutMs: 120_000,
};
