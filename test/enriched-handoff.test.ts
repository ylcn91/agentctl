import { test, expect, describe } from "bun:test";
import { validateHandoff } from "../src/services/handoff";

const validPayload = {
  goal: "Implement structured handoff contract",
  acceptance_criteria: ["Validation passes for valid payloads", "Errors returned for invalid payloads"],
  run_commands: ["bun test"],
  blocked_by: ["none"],
};

describe("validateHandoff — enriched fields", () => {
  test("existing tests still pass: valid payload without enriched fields", () => {
    const result = validateHandoff(validPayload);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.goal).toBe(validPayload.goal);
      expect(result.payload.complexity).toBeUndefined();
      expect(result.payload.criticality).toBeUndefined();
    }
  });

  test("valid enriched payload passes validation", () => {
    const enriched = {
      ...validPayload,
      complexity: "high",
      criticality: "critical",
      uncertainty: "medium",
      estimated_duration_minutes: 45,
      verifiability: "auto-testable",
      reversibility: "reversible",
      required_skills: ["typescript", "testing"],
      autonomy_level: "standard",
      monitoring_level: "periodic",
    };
    const result = validateHandoff(enriched);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.complexity).toBe("high");
      expect(result.payload.criticality).toBe("critical");
      expect(result.payload.uncertainty).toBe("medium");
      expect(result.payload.estimated_duration_minutes).toBe(45);
      expect(result.payload.verifiability).toBe("auto-testable");
      expect(result.payload.reversibility).toBe("reversible");
      expect(result.payload.required_skills).toEqual(["typescript", "testing"]);
      expect(result.payload.autonomy_level).toBe("standard");
      expect(result.payload.monitoring_level).toBe("periodic");
    }
  });

  test("invalid complexity enum fails", () => {
    const result = validateHandoff({ ...validPayload, complexity: "extreme" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "complexity")).toBe(true);
    }
  });

  test("invalid criticality enum fails", () => {
    const result = validateHandoff({ ...validPayload, criticality: "urgent" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "criticality")).toBe(true);
    }
  });

  test("invalid uncertainty enum fails", () => {
    const result = validateHandoff({ ...validPayload, uncertainty: "very-high" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "uncertainty")).toBe(true);
    }
  });

  test("invalid verifiability enum fails", () => {
    const result = validateHandoff({ ...validPayload, verifiability: "maybe" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "verifiability")).toBe(true);
    }
  });

  test("invalid reversibility enum fails", () => {
    const result = validateHandoff({ ...validPayload, reversibility: "unknown" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "reversibility")).toBe(true);
    }
  });

  test("invalid autonomy_level enum fails", () => {
    const result = validateHandoff({ ...validPayload, autonomy_level: "autonomous" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "autonomy_level")).toBe(true);
    }
  });

  test("invalid monitoring_level enum fails", () => {
    const result = validateHandoff({ ...validPayload, monitoring_level: "always" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "monitoring_level")).toBe(true);
    }
  });

  test("negative estimated_duration_minutes fails", () => {
    const result = validateHandoff({ ...validPayload, estimated_duration_minutes: -10 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "estimated_duration_minutes")).toBe(true);
    }
  });

  test("non-number estimated_duration_minutes fails", () => {
    const result = validateHandoff({ ...validPayload, estimated_duration_minutes: "30" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "estimated_duration_minutes")).toBe(true);
    }
  });

  test("negative estimated_cost fails", () => {
    const result = validateHandoff({ ...validPayload, estimated_cost: -5 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "estimated_cost")).toBe(true);
    }
  });

  test("non-integer delegation_depth fails", () => {
    const result = validateHandoff({ ...validPayload, delegation_depth: 1.5 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "delegation_depth")).toBe(true);
    }
  });

  test("negative delegation_depth fails", () => {
    const result = validateHandoff({ ...validPayload, delegation_depth: -1 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "delegation_depth")).toBe(true);
    }
  });

  test("valid delegation_depth passes", () => {
    const result = validateHandoff({ ...validPayload, delegation_depth: 2 });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.delegation_depth).toBe(2);
    }
  });

  test("required_skills with non-string values fails", () => {
    const result = validateHandoff({ ...validPayload, required_skills: ["ts", 42] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "required_skills")).toBe(true);
    }
  });

  test("verification_policy is preserved", () => {
    const policy = { mode: "strict" as const, artifacts: [{ type: "test_log", validator: "auto" }] };
    const result = validateHandoff({ ...validPayload, verification_policy: policy });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.verification_policy).toEqual(policy);
    }
  });

  test("parent_handoff_id is preserved", () => {
    const result = validateHandoff({ ...validPayload, parent_handoff_id: "abc-123" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.parent_handoff_id).toBe("abc-123");
    }
  });

  test("multiple invalid enriched fields return multiple errors", () => {
    const result = validateHandoff({
      ...validPayload,
      complexity: "extreme",
      criticality: "urgent",
      estimated_duration_minutes: -10,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBe(3);
    }
  });

  test("invalid enriched + missing required fields all reported", () => {
    const result = validateHandoff({ complexity: "extreme" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // 4 required field errors + 1 invalid enum
      expect(result.errors.length).toBe(5);
    }
  });
});
