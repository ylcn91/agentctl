export interface NotificationConfig {
  enabled: boolean;
  events: {
    rateLimit: boolean;
    handoffReceived: boolean;
    messageReceived: boolean;
  };
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: true,
  events: {
    rateLimit: true,
    handoffReceived: true,
    messageReceived: true,
  },
};

// macOS native notification via osascript
export async function sendNotification(title: string, body: string, sound?: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;

  try {
    const soundPart = sound ? ` sound name "${sound}"` : "";
    await Bun.$`osascript -e ${'display notification "' + body + '" with title "' + title + '"' + soundPart}`.quiet();
    return true;
  } catch {
    return false;
  }
}

// Event-specific notifications
export async function notifyRateLimit(accountName: string, config?: NotificationConfig): Promise<void> {
  const cfg = config ?? DEFAULT_NOTIFICATION_CONFIG;
  if (!cfg.enabled || !cfg.events.rateLimit) return;
  await sendNotification("Claude Hub", `Rate limit hit for ${accountName}`, "Basso");
}

export async function notifyHandoff(from: string, to: string, task: string, config?: NotificationConfig): Promise<void> {
  const cfg = config ?? DEFAULT_NOTIFICATION_CONFIG;
  if (!cfg.enabled || !cfg.events.handoffReceived) return;
  await sendNotification("Claude Hub", `Handoff from ${from}: ${task}`);
}

export async function notifyMessage(from: string, to: string, preview: string, config?: NotificationConfig): Promise<void> {
  const cfg = config ?? DEFAULT_NOTIFICATION_CONFIG;
  if (!cfg.enabled || !cfg.events.messageReceived) return;
  await sendNotification("Claude Hub", `Message from ${from}: ${preview.slice(0, 80)}`);
}
