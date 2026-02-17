
export const MAX_PAYLOAD_BYTES = 1_048_576;
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export const MCP_REQUEST_TIMEOUT_MS = 5_000;
export const DAEMON_START_TIMEOUT_MS = 3_000;
export const DAEMON_START_POLL_MS = 100;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const RECONNECT_MAX_DELAY_MS = 30_000;

export const DAEMON_CLIENT_TIMEOUT_MS = 2_000;

export const STALE_THRESHOLD_MS = 10 * 60 * 1000;

export const THROUGHPUT_WINDOW_MS = 60 * 60 * 1000;

export const MAX_STREAM_CHUNK_BYTES = 262_144;
export const STREAM_BUFFER_FLUSH_MS = 50;
export const CHUNK_QUEUE_BATCH_SIZE = 10;
export const CHUNK_QUEUE_FLUSH_DELAY_MS = 20;

export const MODEL_CONTEXT_LIMIT = 200_000;
export const CONTEXT_SAFETY_MARGIN = 20_000;

export const LOG_MAX_BYTES = 10 * 1024 * 1024;
export const LOG_ROTATION_COUNT = 3;
