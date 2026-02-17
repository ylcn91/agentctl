export interface EvalContext {
  steps: Map<string, { result?: string; duration_ms?: number; assignee?: string }>;
  trigger: { context: string };
}

export function evaluateCondition(expression: string, context: EvalContext): boolean {
  const resultMatch = expression.match(/^step\.(\w+)\.result\s*==\s*'([^']*)'$/);
  if (resultMatch) {
    const [, stepId, expected] = resultMatch;
    const step = context.steps.get(stepId);
    return step?.result === expected;
  }

  const durationGtMatch = expression.match(/^step\.(\w+)\.duration_ms\s*>\s*(\d+)$/);
  if (durationGtMatch) {
    const [, stepId, threshold] = durationGtMatch;
    const step = context.steps.get(stepId);
    return (step?.duration_ms ?? 0) > Number(threshold);
  }

  const durationLtMatch = expression.match(/^step\.(\w+)\.duration_ms\s*<\s*(\d+)$/);
  if (durationLtMatch) {
    const [, stepId, threshold] = durationLtMatch;
    const step = context.steps.get(stepId);
    return (step?.duration_ms ?? 0) < Number(threshold);
  }

  const assigneeMatch = expression.match(/^step\.(\w+)\.assignee\s*==\s*'([^']*)'$/);
  if (assigneeMatch) {
    const [, stepId, expected] = assigneeMatch;
    const step = context.steps.get(stepId);
    return step?.assignee === expected;
  }

  const containsMatch = expression.match(/^trigger\.context\s+contains\s+'([^']*)'$/);
  if (containsMatch) {
    const [, text] = containsMatch;
    return context.trigger.context.includes(text);
  }

  return false;
}
