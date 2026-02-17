import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { WorkflowStore } from "../src/services/workflow-store";
import { WorkflowEngine } from "../src/services/workflow-engine";
import { ActivityStore } from "../src/services/activity-store";
import { RetroStore } from "../src/services/retro-store";
import { RetroEngine, type RetroDocument } from "../src/services/retro-engine";
import { KnowledgeStore } from "../src/daemon/knowledge-store";
import type { WorkflowDefinition } from "../src/services/workflow-parser";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let workflowStore: WorkflowStore;
let activityStore: ActivityStore;
let retroStore: RetroStore;
let knowledgeStore: KnowledgeStore;
let workflowEngine: WorkflowEngine;
let retroEngine: RetroEngine;
let tmpDir: string;

const twoStepWorkflow: WorkflowDefinition = {
  name: "test-workflow",
  version: 1,
  steps: [
    {
      id: "step-1",
      title: "First Step",
      assign: "alice",
      handoff: { goal: "Do first thing" },
    },
    {
      id: "step-2",
      title: "Second Step",
      assign: "bob",
      depends_on: ["step-1"],
      handoff: { goal: "Do second thing" },
    },
  ],
  on_failure: "notify",
  retro: true,
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wf-retro-integration-test-"));
  workflowStore = new WorkflowStore(join(tmpDir, "workflow.db"));
  activityStore = new ActivityStore(join(tmpDir, "activity.db"));
  retroStore = new RetroStore(join(tmpDir, "retro.db"));
  knowledgeStore = new KnowledgeStore(join(tmpDir, "knowledge.db"));

  workflowEngine = new WorkflowEngine(workflowStore, activityStore, {});
  retroEngine = new RetroEngine(retroStore, activityStore, knowledgeStore);
  workflowEngine.retroEngine = retroEngine;
});

afterEach(() => {
  workflowStore.close();
  activityStore.close();
  retroStore.close();
  knowledgeStore.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Workflow-Retro Integration", () => {
  test("complete workflow with retro=true triggers retro", async () => {
    const runId = await workflowEngine.triggerWorkflow(twoStepWorkflow, "integration test");

    await workflowEngine.onStepCompleted(runId, "step-1", "accepted", twoStepWorkflow);

    await workflowEngine.onStepCompleted(runId, "step-2", "accepted", twoStepWorkflow);

    const run = workflowStore.getRun(runId);
    expect(run!.status).toBe("retro_in_progress");

    const sessions = retroStore.listSessions({ workflowRunId: runId });
    expect(sessions.length).toBe(1);
    expect(sessions[0].status).toBe("collecting");
    expect(sessions[0].participants).toContain("alice");
    expect(sessions[0].participants).toContain("bob");
  });

  test("submit all reviews then synthesis produces retro doc", async () => {
    const runId = await workflowEngine.triggerWorkflow(twoStepWorkflow, "full flow");
    await workflowEngine.onStepCompleted(runId, "step-1", "accepted", twoStepWorkflow);
    await workflowEngine.onStepCompleted(runId, "step-2", "accepted", twoStepWorkflow);

    const sessions = retroStore.listSessions({ workflowRunId: runId });
    const retroId = sessions[0].id;

    retroEngine.submitReview(retroId, {
      author: "alice",
      whatWentWell: ["smooth handoff"],
      whatDidntWork: ["slow build"],
      suggestions: ["speed up CI"],
      agentPerformanceNotes: { bob: "reliable" },
      submittedAt: new Date().toISOString(),
    });

    const status = retroEngine.submitReview(retroId, {
      author: "bob",
      whatWentWell: ["clear specs"],
      whatDidntWork: ["missing tests"],
      suggestions: ["add integration tests"],
      agentPerformanceNotes: { alice: "great leadership" },
      submittedAt: new Date().toISOString(),
    });
    expect(status.allCollected).toBe(true);

    const aggregation = retroEngine.aggregate(retroId);
    expect(aggregation.themes.whatWorked).toContain("smooth handoff");
    expect(aggregation.themes.whatWorked).toContain("clear specs");

    const doc: RetroDocument = {
      title: "Integration Test Retro",
      workflowName: "test-workflow",
      duration: "30m",
      participants: ["alice", "bob"],
      keyDecisions: [{ decision: "adopt Bun", rationale: "performance", outcome: "positive" }],
      whatWorked: aggregation.themes.whatWorked,
      whatDidntWork: aggregation.themes.whatDidntWork,
      actionableLearnings: ["speed up CI", "add integration tests"],
      agentHighlights: { alice: "great leadership", bob: "reliable" },
      deltaFromPastRetros: ["first retro for this workflow"],
      generatedAt: new Date().toISOString(),
      generatedBy: "alice",
    };

    await retroEngine.completeSynthesis(retroId, doc);

    const stored = retroEngine.getDocument(retroId);
    expect(stored).not.toBeNull();
    expect(stored!.title).toBe("Integration Test Retro");
    expect(stored!.actionableLearnings).toContain("speed up CI");

    const session = retroEngine.getSession(retroId);
    expect(session!.status).toBe("complete");
  });

  test("retro document indexed in knowledge store (meta-learning)", async () => {
    const runId = await workflowEngine.triggerWorkflow(twoStepWorkflow, "meta-learning test");
    await workflowEngine.onStepCompleted(runId, "step-1", "accepted", twoStepWorkflow);
    await workflowEngine.onStepCompleted(runId, "step-2", "accepted", twoStepWorkflow);

    const sessions = retroStore.listSessions({ workflowRunId: runId });
    const retroId = sessions[0].id;

    retroEngine.submitReview(retroId, {
      author: "alice",
      whatWentWell: ["worked well"],
      whatDidntWork: [],
      suggestions: [],
      agentPerformanceNotes: {},
      submittedAt: new Date().toISOString(),
    });
    retroEngine.submitReview(retroId, {
      author: "bob",
      whatWentWell: [],
      whatDidntWork: [],
      suggestions: [],
      agentPerformanceNotes: {},
      submittedAt: new Date().toISOString(),
    });

    const doc: RetroDocument = {
      title: "Meta-Learning Retro",
      workflowName: "test-workflow",
      duration: "20m",
      participants: ["alice", "bob"],
      keyDecisions: [],
      whatWorked: ["worked well"],
      whatDidntWork: [],
      actionableLearnings: ["always write unit tests first"],
      agentHighlights: {},
      deltaFromPastRetros: ["improved from previous workflow"],
      generatedAt: new Date().toISOString(),
      generatedBy: "alice",
    };

    await retroEngine.completeSynthesis(retroId, doc);

    const results = knowledgeStore.search("unit tests", "retro" as any, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.content).toContain("always write unit tests first");
    expect(results[0].entry.tags).toContain("retro");
  });

  test("workflow without retro=true does not trigger retro", async () => {
    const noRetroWorkflow: WorkflowDefinition = {
      ...twoStepWorkflow,
      name: "no-retro-workflow",
      retro: false,
    };

    const runId = await workflowEngine.triggerWorkflow(noRetroWorkflow, "no retro");
    await workflowEngine.onStepCompleted(runId, "step-1", "accepted", noRetroWorkflow);
    await workflowEngine.onStepCompleted(runId, "step-2", "accepted", noRetroWorkflow);

    const run = workflowStore.getRun(runId);
    expect(run!.status).toBe("completed");

    const sessions = retroStore.listSessions({ workflowRunId: runId });
    expect(sessions.length).toBe(0);
  });
});
