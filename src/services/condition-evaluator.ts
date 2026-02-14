export interface EvalContext {
  steps: Map<string, { result?: string; duration_ms?: number; assignee?: string }>;
  trigger: { context: string };
}

/**
 * Safe expression evaluator using regex parsing only.
 *
 * Supported:
 *   step.<id>.result == '<value>'
 *   step.<id>.duration_ms > <number>
 *   step.<id>.assignee == '<name>'
 *   trigger.context contains '<text>'
 */
export function evaluateCondition(expression: string, context: EvalContext): boolean {
  // step.<id>.result == '<value>'
  const resultMatch = expression.match(/^step\.(\w+)\.result\s*==\s*'([^']*)'$/);
  if (resultMatch) {
    const [, stepId, expected] = resultMatch;
    const step = context.steps.get(stepId);
    return step?.result === expected;
  }

  // step.<id>.duration_ms > <number>
  const durationGtMatch = expression.match(/^step\.(\w+)\.duration_ms\s*>\s*(\d+)$/);
  if (durationGtMatch) {
    const [, stepId, threshold] = durationGtMatch;
    const step = context.steps.get(stepId);
    return (step?.duration_ms ?? 0) > Number(threshold);
  }

  // step.<id>.duration_ms < <number>
  const durationLtMatch = expression.match(/^step\.(\w+)\.duration_ms\s*<\s*(\d+)$/);
  if (durationLtMatch) {
    const [, stepId, threshold] = durationLtMatch;
    const step = context.steps.get(stepId);
    return (step?.duration_ms ?? 0) < Number(threshold);
  }

  // step.<id>.assignee == '<name>'
  const assigneeMatch = expression.match(/^step\.(\w+)\.assignee\s*==\s*'([^']*)'$/);
  if (assigneeMatch) {
    const [, stepId, expected] = assigneeMatch;
    const step = context.steps.get(stepId);
    return step?.assignee === expected;
  }

  // trigger.context contains '<text>'
  const containsMatch = expression.match(/^trigger\.context\s+contains\s+'([^']*)'$/);
  if (containsMatch) {
    const [, text] = containsMatch;
    return context.trigger.context.includes(text);
  }

  // Unknown expression format -- safe default
  return false;
}
