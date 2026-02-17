
import type { HandoffPayload } from "./handoff";

export interface DelegationDepthConfig {
  maxDepth: number;
  requireReauthAbove?: number;
}

export const DEFAULT_DELEGATION_DEPTH_CONFIG: DelegationDepthConfig = {
  maxDepth: 3,
};

export interface DelegationDepthCheck {
  allowed: boolean;
  currentDepth: number;
  maxDepth: number;
  requiresReauthorization: boolean;
  reason?: string;
}

export function checkDelegationDepth(
  payload: HandoffPayload,
  config?: Partial<DelegationDepthConfig>,
): DelegationDepthCheck {
  const maxDepth = config?.maxDepth ?? DEFAULT_DELEGATION_DEPTH_CONFIG.maxDepth;
  const currentDepth = payload.delegation_depth ?? 0;

  if (currentDepth >= maxDepth) {
    return {
      allowed: false,
      currentDepth,
      maxDepth,
      requiresReauthorization: true,
      reason: `Delegation depth ${currentDepth} exceeds maximum allowed depth of ${maxDepth}. Human re-authorization required.`,
    };
  }

  if (currentDepth >= maxDepth - 1) {
    return {
      allowed: true,
      currentDepth,
      maxDepth,
      requiresReauthorization: false,
      reason: `Approaching delegation depth limit (${currentDepth}/${maxDepth}). Next delegation will require human re-authorization.`,
    };
  }

  return {
    allowed: true,
    currentDepth,
    maxDepth,
    requiresReauthorization: false,
  };
}

export function computeNextDepth(parentDepth?: number): number {
  return (parentDepth ?? 0) + 1;
}
