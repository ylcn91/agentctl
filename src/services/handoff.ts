export interface HandoffPayload {
  goal: string;
  acceptance_criteria: string[];
  run_commands: string[];
  blocked_by: string[];
}

export interface HandoffValidationError {
  field: string;
  message: string;
}

export function validateHandoff(payload: any): { valid: true; payload: HandoffPayload } | { valid: false; errors: HandoffValidationError[] } {
  const errors: HandoffValidationError[] = [];

  if (!payload?.goal || typeof payload.goal !== "string" || payload.goal.trim() === "") {
    errors.push({ field: "goal", message: "goal is required and cannot be empty" });
  }

  if (!Array.isArray(payload?.acceptance_criteria) || payload.acceptance_criteria.length === 0) {
    errors.push({ field: "acceptance_criteria", message: "at least 1 acceptance criterion is required" });
  } else if (payload.acceptance_criteria.some((c: any) => typeof c !== "string" || c.trim() === "")) {
    errors.push({ field: "acceptance_criteria", message: "all acceptance criteria must be non-empty strings" });
  }

  if (!Array.isArray(payload?.run_commands) || payload.run_commands.length === 0) {
    errors.push({ field: "run_commands", message: "at least 1 run command is required" });
  } else if (payload.run_commands.some((c: any) => typeof c !== "string" || c.trim() === "")) {
    errors.push({ field: "run_commands", message: "all run commands must be non-empty strings" });
  }

  if (!Array.isArray(payload?.blocked_by) || payload.blocked_by.length === 0) {
    errors.push({ field: "blocked_by", message: "blocked_by is required (use [\"none\"] if no blockers)" });
  } else if (payload.blocked_by.some((b: any) => typeof b !== "string" || b.trim() === "")) {
    errors.push({ field: "blocked_by", message: "all blocked_by entries must be non-empty strings" });
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, payload: payload as HandoffPayload };
}
