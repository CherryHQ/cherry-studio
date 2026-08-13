import * as z from 'zod'

const optionalNonNegativeInteger = z.number().int().nonnegative().optional()
const optionalNonEmptyString = z.string().trim().min(1).optional()

const agentWorkflowPhaseProgressSchema = z.object({
  type: z.literal('workflow_phase'),
  index: z.number().int().nonnegative(),
  title: z.string().trim().min(1)
})

const agentWorkflowAgentProgressSchema = z.object({
  type: z.literal('workflow_agent'),
  index: z.number().int().nonnegative(),
  label: z.string().trim().min(1),
  phaseIndex: z.number().int().nonnegative(),
  phaseTitle: z.string().trim().min(1),
  state: z.string().trim().min(1),
  startedAt: optionalNonNegativeInteger,
  tokens: optionalNonNegativeInteger,
  cumulativeTokens: optionalNonNegativeInteger,
  toolCalls: optionalNonNegativeInteger,
  durationMs: optionalNonNegativeInteger
})

type AgentWorkflowPhaseProgress = z.infer<typeof agentWorkflowPhaseProgressSchema>
export type AgentWorkflowAgentProgress = z.infer<typeof agentWorkflowAgentProgressSchema>
type AgentWorkflowProgress = AgentWorkflowPhaseProgress | AgentWorkflowAgentProgress

interface AgentWorkflowPhase {
  title: string
}

export interface AgentWorkflowSnapshot {
  runId: string
  taskId: string
  workflowName?: string
  durationMs?: number
  totalTokens?: number
  totalCumulativeTokens?: number
  totalToolCalls?: number
  phases: AgentWorkflowPhase[]
  workflowProgress: AgentWorkflowProgress[]
}

const workflowOutputSchema = z.object({
  runId: optionalNonEmptyString,
  taskId: optionalNonEmptyString,
  workflowName: optionalNonEmptyString,
  durationMs: optionalNonNegativeInteger,
  totalTokens: optionalNonNegativeInteger,
  totalCumulativeTokens: optionalNonNegativeInteger,
  totalToolCalls: optionalNonNegativeInteger,
  phases: z
    .array(
      z.object({
        title: z.string().trim().min(1)
      })
    )
    .optional(),
  workflowProgress: z.array(z.unknown()).optional()
})

type AgentWorkflowSnapshotIdentity = Pick<AgentWorkflowSnapshot, 'runId' | 'taskId' | 'workflowName'>

/** Parses the SDK-owned workflow output file without retaining its potentially large logs/result. */
export function parseAgentWorkflowSnapshot(
  value: unknown,
  expectedIdentity?: AgentWorkflowSnapshotIdentity
): AgentWorkflowSnapshot | undefined {
  const parsed = workflowOutputSchema.safeParse(value)
  if (!parsed.success) return undefined

  if (
    expectedIdentity &&
    ((parsed.data.runId && parsed.data.runId !== expectedIdentity.runId) ||
      (parsed.data.taskId && parsed.data.taskId !== expectedIdentity.taskId) ||
      (parsed.data.workflowName &&
        expectedIdentity.workflowName &&
        parsed.data.workflowName !== expectedIdentity.workflowName))
  ) {
    return undefined
  }

  const runId = parsed.data.runId
  const taskId = parsed.data.taskId
  if (!runId || !taskId) return undefined

  const workflowProgress: AgentWorkflowProgress[] = []
  for (const item of parsed.data.workflowProgress ?? []) {
    const phase = agentWorkflowPhaseProgressSchema.safeParse(item)
    if (phase.success) {
      workflowProgress.push(phase.data)
      continue
    }
    const agent = agentWorkflowAgentProgressSchema.safeParse(item)
    if (agent.success) workflowProgress.push(agent.data)
  }

  const phases = parsed.data.phases ?? []

  const hasSnapshotData =
    phases.length > 0 ||
    workflowProgress.length > 0 ||
    parsed.data.totalTokens !== undefined ||
    parsed.data.totalCumulativeTokens !== undefined ||
    parsed.data.totalToolCalls !== undefined
  if (!hasSnapshotData) return undefined

  return {
    runId,
    taskId,
    ...(parsed.data.workflowName || expectedIdentity?.workflowName
      ? { workflowName: parsed.data.workflowName ?? expectedIdentity?.workflowName }
      : {}),
    ...(parsed.data.durationMs !== undefined ? { durationMs: parsed.data.durationMs } : {}),
    ...(parsed.data.totalTokens !== undefined ? { totalTokens: parsed.data.totalTokens } : {}),
    ...(parsed.data.totalCumulativeTokens !== undefined
      ? { totalCumulativeTokens: parsed.data.totalCumulativeTokens }
      : {}),
    ...(parsed.data.totalToolCalls !== undefined ? { totalToolCalls: parsed.data.totalToolCalls } : {}),
    phases,
    workflowProgress
  }
}
