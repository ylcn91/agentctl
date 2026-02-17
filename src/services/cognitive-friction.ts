
import type { HandoffPayload } from "./handoff";

export type FrictionLevel = "none" | "warning" | "blocking";
export type GateAction = "auto-accept" | "require-acceptance" | "require-justification" | "require-elevated-review";

export interface FrictionCheck {
  requiresHumanReview: boolean;
  reason?: string;
  frictionLevel: FrictionLevel;
}

export interface GatedAcceptanceResult {
  action: GateAction;
  reason: string;
  requiresJustification: boolean;
}

export function checkCognitiveFriction(payload: HandoffPayload): FrictionCheck {
  const criticality = payload.criticality;
  const reversibility = payload.reversibility;
  const complexity = payload.complexity;

  if (
    (criticality === "high" || criticality === "critical") &&
    (reversibility === "irreversible" || reversibility === "partial")
  ) {
    return {
      requiresHumanReview: true,
      frictionLevel: "blocking",
      reason: "High-criticality task with limited reversibility requires human review",
    };
  }

  if (criticality === "critical") {
    return {
      requiresHumanReview: true,
      frictionLevel: "warning",
      reason: "Critical task requires human confirmation",
    };
  }

  if (
    reversibility === "irreversible" &&
    (complexity === "high" || complexity === "critical")
  ) {
    return {
      requiresHumanReview: true,
      frictionLevel: "warning",
      reason: "Irreversible task with high complexity requires human review",
    };
  }

  return {
    requiresHumanReview: false,
    frictionLevel: "none",
  };
}

export function getGatedAcceptanceAction(payload: HandoffPayload): GatedAcceptanceResult {
  const criticality = payload.criticality ?? "medium";
  const verifiability = payload.verifiability;
  const reversibility = payload.reversibility;

  if (criticality === "critical") {
    return {
      action: "require-elevated-review",
      reason: "Critical task requires elevated review before acceptance",
      requiresJustification: true,
    };
  }

  if (criticality === "high" && reversibility === "irreversible") {
    return {
      action: "require-justification",
      reason: "High-criticality irreversible task requires justification for acceptance",
      requiresJustification: true,
    };
  }

  if (criticality === "low" && verifiability === "auto-testable") {
    return {
      action: "auto-accept",
      reason: "Low-criticality auto-testable task eligible for auto-acceptance",
      requiresJustification: false,
    };
  }

  return {
    action: "require-acceptance",
    reason: "Task requires explicit acceptance",
    requiresJustification: false,
  };
}

export function validateJustification(
  gateResult: GatedAcceptanceResult,
  justification?: string,
): { valid: boolean; error?: string } {
  if (!gateResult.requiresJustification) {
    return { valid: true };
  }
  if (!justification || justification.trim().length === 0) {
    return {
      valid: false,
      error: `Justification is required for ${gateResult.action}: ${gateResult.reason}`,
    };
  }
  return { valid: true };
}
