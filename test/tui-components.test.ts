import { test, expect, describe } from "bun:test";

describe("CouncilView", () => {
  test("exports a callable SolidJS component", async () => {
    const mod = await import("../src/tui/views/council");
    expect(mod.CouncilView).toBeTruthy();
    expect(typeof mod.CouncilView).toBe("function");
  });
});

describe("VerificationView", () => {
  test("exports a callable SolidJS component", async () => {
    const mod = await import("../src/tui/views/verification");
    expect(mod.VerificationView).toBeTruthy();
    expect(typeof mod.VerificationView).toBe("function");
  });
});

describe("EntireSessions", () => {
  test("exports a named function component", async () => {
    const mod = await import("../src/tui/views/sessions");
    expect(typeof mod.EntireSessions).toBe("function");
  });
});

describe("DelegationChain", () => {
  test("exports a callable SolidJS component", async () => {
    const mod = await import("../src/tui/views/delegation");
    expect(mod.DelegationChain).toBeTruthy();
    expect(typeof mod.DelegationChain).toBe("function");
  });
});

describe("SLABoard (extended)", () => {
  test("has adaptive action labels in source", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/tui/views/sla.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("suggest_reassign");
    expect(src).toContain("auto_reassign");
    expect(src).toContain("escalate_human");
    expect(src).toContain("terminate");
  });
});

describe("TaskBoard (extended)", () => {
  test("has friction gate mode in source", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/tui/views/tasks.tsx", import.meta.url).pathname,
      "utf-8"
    );
    const partsSrc = readFileSync(
      new URL("../src/tui/views/task-parts.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("justify");
    expect(src).toContain("getGatedAcceptanceAction");
    expect(partsSrc).toContain("calculateProviderFit");
  });
});

describe("WorkflowDetail (extended)", () => {
  test("has entire.io evidence section in source", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/tui/views/workflow-detail.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("EntireRetroEvidence");
    expect(src).toContain("Entire.io Evidence");
    expect(src).toContain("Burn Rate");
  });
});

describe("App routing", () => {
  test("NAV_KEYS includes all views", async () => {
    const { NAV_KEYS } = await import("../src/tui/context/keybind");
    expect(NAV_KEYS["c"]).toBe("council");
    expect(NAV_KEYS["v"]).toBe("verify");
    expect(NAV_KEYS["i"]).toBe("entire");
    expect(NAV_KEYS["g"]).toBe("chains");
  });

  test("app.tsx imports all view components", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/tui/app.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("CouncilView");
    expect(src).toContain("VerificationView");
    expect(src).toContain("EntireSessions");
    expect(src).toContain("DelegationChain");
  });

  test("Header nav items include all new views", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/tui/ui/header.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain('"council"');
    expect(src).toContain('"verify"');
    expect(src).toContain('"entire"');
    expect(src).toContain('"chains"');
  });
});
