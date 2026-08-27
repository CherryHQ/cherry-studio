import type { ConversationExecutionProjection } from '@shared/ai/transport'

/** Merge observer snapshots by exact execution identity while preserving source order. */
export function projectActiveExecutions(
  ...sources: ReadonlyArray<readonly ConversationExecutionProjection[]>
): ConversationExecutionProjection[] {
  const order: string[] = []
  const executions = new Map<string, ConversationExecutionProjection>()
  for (const source of sources) {
    for (const execution of source) {
      if (!executions.has(execution.executionId)) order.push(execution.executionId)
      executions.set(execution.executionId, execution)
    }
  }
  return order.flatMap((executionId) => {
    const execution = executions.get(executionId)
    return execution ? [execution] : []
  })
}
