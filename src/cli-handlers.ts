
interface CliFlags {
  account?: string;
  json: boolean;
  search?: string;
  watch: boolean;
  apiKey: boolean;
  [key: string]: any;
}

export async function handleConfig(subcommand: string | undefined, input: string[], _flags: CliFlags) {
  if (subcommand === "reload") {
    const { connect } = await import("net");
    const { existsSync } = await import("fs");
    const { getSockPath } = await import("./paths.js");
    const { createLineParser, generateRequestId, frameSend } = await import("./daemon/framing.js");
    const sockPath = getSockPath();
    if (!existsSync(sockPath)) { console.error("Daemon not running (no socket). Start with: actl daemon start"); process.exit(1); }
    try {
      const result = await new Promise<{ reloaded: boolean; accounts: number }>((resolve, reject) => {
        const timeout = setTimeout(() => { try { socket.destroy(); } catch {} reject(new Error("Daemon did not respond within 2s")); }, 2000);
        const pending = new Map<string, { resolve: Function }>();
        const socket = connect(sockPath, () => {
          const reloadId = generateRequestId();
          pending.set(reloadId, { resolve: (msg: any) => { clearTimeout(timeout); socket.end(); msg.type === "error" ? reject(new Error(msg.error)) : resolve({ reloaded: msg.reloaded ?? true, accounts: msg.accounts ?? 0 }); } });
          socket.write(frameSend({ type: "config_reload", requestId: reloadId }));
        });
        const parser = createLineParser((msg: any) => { if (msg.requestId && pending.has(msg.requestId)) { const entry = pending.get(msg.requestId)!; pending.delete(msg.requestId); entry.resolve(msg); } });
        socket.on("data", (data: Buffer) => parser.feed(data));
        socket.on("error", (err: Error) => { clearTimeout(timeout); reject(err); });
      });
      console.log(`Config reloaded via daemon (${result.accounts} accounts)`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  } else if (subcommand === "set") {
    const key = input[2], val = input[3];
    if (!key || val === undefined) { console.error("Usage: actl config set <key> <value>"); process.exit(1); }
    const { ConfigSetArgsSchema } = await import("./daemon/schemas.js");
    const validation = ConfigSetArgsSchema.safeParse({ key, value: val });
    if (!validation.success) {
      for (const issue of validation.error.issues) console.error(`Invalid ${issue.path.join(".")}: ${issue.message}`);
      process.exit(1);
    }
    const { setConfigValue } = await import("./config.js");
    try {
      const { oldValue, newValue } = await setConfigValue(validation.data.key, validation.data.value);
      console.log(`${validation.data.key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
    } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
  }
}

export async function handleSearch(pattern: string | undefined) {
  if (!pattern) { console.error("Usage: actl search <pattern>"); process.exit(1); }
  const { SearchPatternSchema } = await import("./daemon/schemas.js");
  const validation = SearchPatternSchema.safeParse({ pattern });
  if (!validation.success) {
    for (const issue of validation.error.issues) console.error(`Invalid ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const { searchCommand } = await import("./services/cli-commands.js");
  try { console.log(await searchCommand(validation.data.pattern)); } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
}

export async function handleReplay(sessionId: string | undefined, flags: CliFlags) {
  if (!sessionId) { console.error("Usage: actl replay <session-id> [--json]"); process.exit(1); }
  const { replayCommand } = await import("./services/cli-commands.js");
  try { console.log(await replayCommand(sessionId, { json: flags.json })); } catch (e: any) { console.error(`Error: ${e.message}`); process.exit(1); }
}

export async function handleSession(subcommand: string | undefined, input: string[], flags: CliFlags) {
  if (subcommand !== "name") return;
  const sessionId = input[2], name = input[3];
  if (!sessionId || !name) { console.error("Usage: actl session name <session-id> <name>"); process.exit(1); }
  const { SessionNameArgsSchema } = await import("./daemon/schemas.js");
  const validation = SessionNameArgsSchema.safeParse({ sessionId, name });
  if (!validation.success) {
    for (const issue of validation.error.issues) console.error(`Invalid ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const { SessionStore } = await import("./daemon/session-store.js");
  const { getSessionsDbPath } = await import("./paths.js");
  const store = new SessionStore(getSessionsDbPath());
  try {
    const session = store.nameSession(validation.data.sessionId, validation.data.name, { account: flags.account ?? "local" });
    console.log(`Session ${validation.data.sessionId} named: "${session.name}"`);
  } finally { store.close(); }
}

export async function handleSessions(flags: CliFlags) {
  const { SessionStore } = await import("./daemon/session-store.js");
  const { getSessionsDbPath } = await import("./paths.js");
  const store = new SessionStore(getSessionsDbPath());
  try {
    if (flags.search) {
      const results = store.search(flags.search);
      if (results.length === 0) { console.log(`No sessions matching "${flags.search}"`); } else {
        for (const r of results) console.log(`${r.session.id}  ${r.session.name}  (${r.session.account})  ${r.session.startedAt}`);
      }
    } else {
      const sessions = store.list();
      if (sessions.length === 0) { console.log("No named sessions. Use: actl session name <id> <name>"); } else {
        for (const s of sessions) console.log(`${s.id}  ${s.name}  (${s.account})  ${s.startedAt}`);
      }
    }
  } finally { store.close(); }
}

export async function handleTdd(testFile: string | undefined, flags: CliFlags) {
  if (!testFile) { console.error("Usage: actl tdd <test-file> [--watch]"); process.exit(1); }
  const { existsSync } = await import("fs");
  if (!existsSync(testFile)) { console.error(`Test file not found: ${testFile}`); process.exit(1); }
  const { TddEngine } = await import("./services/tdd-engine.js");
  const engine = new TddEngine({
    testFile, watchMode: flags.watch,
    onStateChange: (state) => {
      const phase = state.phase.toUpperCase();
      const last = state.lastTestPassed ? "PASS" : "FAIL";
      process.stdout.write(`\r[${phase}] ${last} - cycles: ${state.cycles.filter((c) => c.phase === "red").length}  `);
    },
  });
  engine.start();
  const result = await engine.runTests();
  engine.advanceAfterTests(result.passed);
  console.log(`\n${result.output}`);
  if (!flags.watch) { engine.stop(); } else {
    console.log("Watching for changes... (Ctrl+C to stop)");
    process.on("SIGINT", () => { engine.stop(); process.exit(0); });
    process.on("SIGTERM", () => { engine.stop(); process.exit(0); });
  }
}
