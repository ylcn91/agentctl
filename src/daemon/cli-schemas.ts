
import { z } from "zod";

export const AccountNameSchema = z.string().regex(
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/,
  "Names must be 1-63 alphanumeric characters, hyphens, or underscores, starting with a letter or digit",
);

export const HexColorSchema = z.string().regex(
  /^#[0-9a-fA-F]{6}$/,
  "Color must be a hex color in #RRGGBB format",
);

export const ProviderSchema = z.enum([
  "claude-code",
  "codex-cli",
  "openhands",
  "gemini-cli",
  "opencode",
  "cursor-agent",
]);

export const AddAccountArgsSchema = z.object({
  name: AccountNameSchema,
  color: HexColorSchema.optional(),
  provider: ProviderSchema.optional(),
});

export const ConfigSetArgsSchema = z.object({
  key: z.string()
    .min(1, "Config key must not be empty")
    .max(255, "Config key must be at most 255 characters")
    .regex(/^[a-zA-Z0-9_.]+$/, "Config key must contain only alphanumeric characters, dots, or underscores"),
  value: z.string()
    .max(10_000, "Config value must be at most 10000 characters"),
});

export const SessionNameArgsSchema = z.object({
  sessionId: z.string()
    .min(1, "Session ID must not be empty")
    .max(255, "Session ID must be at most 255 characters"),
  name: z.string()
    .min(1, "Session name must not be empty")
    .max(255, "Session name must be at most 255 characters"),
});

export const LaunchDirSchema = z.object({
  dir: z.string()
    .max(4096, "Directory path must be at most 4096 characters")
    .regex(/^[a-zA-Z0-9_.\/~\s:-]+$/, "Directory path contains invalid characters")
    .optional(),
});

export const SearchPatternSchema = z.object({
  pattern: z.string()
    .min(1, "Search pattern must not be empty")
    .max(1000, "Search pattern must be at most 1000 characters"),
});
