import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { canRebuildAgentSessionFork } from '@shared/ai/agentSessionFork'

import {
  AgentSessionForkError,
  type RuntimeForkCheckpoint,
  type RuntimeForkResult,
  RuntimeForkStateSchema
} from '../runtime/forkCheckpoint'
import { runtimeDriverRegistry } from '../runtime/registry'

export interface PrepareRuntimeHistoryInput {
  sourceSessionId: string
  runtime: string
  messages: readonly AgentSessionMessageRow[]
  targetSessionId: string
  targetCwd: string
  artifactDirectory: string
  allowHistoryRebuild: boolean
  signal: AbortSignal
}

/** Prepare an independent native prefix without publishing files or creating an application session. */
export async function prepareRuntimeHistory(input: PrepareRuntimeHistoryInput): Promise<RuntimeForkResult | undefined> {
  input.signal.throwIfAborted()
  const driver = runtimeDriverRegistry.getAgentSessionDriver(input.runtime)
  if (!driver) throw new AgentSessionForkError('unsupported_checkpoint')
  const boundary = input.messages.at(-1)
  const state = RuntimeForkStateSchema.safeParse(boundary?.runtimeForkState)
  const checkpoint =
    boundary?.role === 'assistant' &&
    boundary.status === 'success' &&
    state.success &&
    state.data.status === 'available'
      ? state.data.checkpoint
      : undefined
  if (!checkpoint || checkpoint.runtime !== input.runtime || !driver.fork) {
    if (!input.allowHistoryRebuild) throw new AgentSessionForkError('unsupported_checkpoint')
    return undefined
  }
  if (
    state.success &&
    state.data.status === 'available' &&
    state.data.excludedMessageIds?.some((id) => input.messages.some((message) => message.id === id))
  ) {
    if (!input.allowHistoryRebuild) throw new AgentSessionForkError('history_changed')
    return undefined
  }
  const checkpoints: RuntimeForkCheckpoint[] = []
  for (const message of input.messages) {
    const parsed = RuntimeForkStateSchema.safeParse(message.runtimeForkState)
    if (parsed.success && parsed.data.status === 'available') checkpoints.push(parsed.data.checkpoint)
  }
  try {
    const result = await driver.fork({
      sourceSessionId: input.sourceSessionId,
      checkpoint,
      checkpoints,
      targetSessionId: input.targetSessionId,
      targetCwd: input.targetCwd,
      artifactDirectory: input.artifactDirectory,
      signal: input.signal
    })
    input.signal.throwIfAborted()
    if (result.checkpoints.length !== checkpoints.length) throw new AgentSessionForkError('history_corrupt')
    return result
  } catch (error) {
    if (
      !input.allowHistoryRebuild ||
      input.signal.aborted ||
      !(error instanceof AgentSessionForkError) ||
      !canRebuildAgentSessionFork(error.reason)
    )
      throw error
    return undefined
  }
}
