import { z } from "zod";
import { parse as parseYaml } from "yaml";

// ── Types ──

export interface WorkflowDefinition {
  name: string;
  description?: string;
  version: number;
  steps: WorkflowStep[];
  on_failure: "notify" | "retry" | "abort";
  max_retries?: number;
  retro: boolean;
}

export interface WorkflowStep {
  id: string;
  title: string;
  assign: string | "auto";
  skills?: string[];
  depends_on?: string[];
  condition?: { when: string };
  handoff: {
    goal: string;
    acceptance_criteria?: string[];
    run_commands?: string[];
    blocked_by?: string[];
  };
}

// ── Zod Schema ──

const HandoffSchema = z.object({
  goal: z.string(),
  acceptance_criteria: z.array(z.string()).optional(),
  run_commands: z.array(z.string()).optional(),
  blocked_by: z.array(z.string()).optional(),
});

const StepSchema = z.object({
  id: z.string(),
  title: z.string(),
  assign: z.string().default("auto"),
  skills: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  condition: z.object({ when: z.string() }).optional(),
  handoff: HandoffSchema,
});

const WorkflowSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.number().int().positive(),
  steps: z.array(StepSchema).min(1),
  on_failure: z.enum(["notify", "retry", "abort"]).default("notify"),
  max_retries: z.number().int().nonnegative().optional(),
  retro: z.boolean().default(false),
});

// ── DAG Validation ──

export function validateDAG(steps: WorkflowStep[]): void {
  const ids = new Set(steps.map((s) => s.id));

  // Check that all depends_on references exist
  for (const step of steps) {
    for (const dep of step.depends_on ?? []) {
      if (!ids.has(dep)) {
        throw new Error(`Step '${step.id}' depends on unknown step '${dep}'`);
      }
    }
  }

  // Kahn's algorithm for cycle detection
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const step of steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }
  for (const step of steps) {
    for (const dep of step.depends_on ?? []) {
      adjacency.get(dep)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (visited !== steps.length) {
    throw new Error("Workflow contains a cycle in step dependencies");
  }
}

export function topologicalSort(steps: WorkflowStep[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const step of steps) {
    inDegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }
  for (const step of steps) {
    for (const dep of step.depends_on ?? []) {
      adjacency.get(dep)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return order;
}

// ── Parsing ──

export function parseWorkflow(yamlContent: string): WorkflowDefinition {
  const raw = parseYaml(yamlContent);
  const result = WorkflowSchema.parse(raw);
  validateDAG(result.steps);
  return result;
}

export async function loadWorkflowFile(filePath: string): Promise<WorkflowDefinition> {
  const file = Bun.file(filePath);
  const content = await file.text();
  return parseWorkflow(content);
}

export async function scanWorkflowDir(dirPath: string): Promise<WorkflowDefinition[]> {
  const glob = new Bun.Glob("*.{yaml,yml}");
  const definitions: WorkflowDefinition[] = [];

  for await (const entry of glob.scan({ cwd: dirPath, absolute: true })) {
    try {
      const def = await loadWorkflowFile(entry);
      definitions.push(def);
    } catch (err: any) {
      console.error(`[workflow] Failed to parse ${entry}: ${err.message}`);
    }
  }

  return definitions;
}
