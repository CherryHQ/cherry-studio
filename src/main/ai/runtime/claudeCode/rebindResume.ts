import { runtimeId } from '@cherrystudio/agent-runtime'
import type {
  ClaudeCodeRuntime,
  ClaudeCodeRuntimeOptions,
  ClaudeThreadHandle,
  createClaudeCodeRuntime
} from '@cherrystudio/agent-runtime-claude-code'
import type { AgentSessionWorkspaceEventRow } from '@data/db/schemas/agentSessionWorkspaceEvent'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ClaudeCodeRebindResume')

export interface RebindResumeInput {
  /** Cherry session whose resume just missed its native transcript. */
  sessionId: string
  /** Native session id the resume was attempted with. */
  resumeToken: string
  /** Backend id of the connection being resumed. */
  backendId: string
  /** cwd the resume ran with — the session's current workspace path. */
  currentCwd: string
  /** The connection's runtime, used to create the successor under the current cwd. */
  primaryRuntime: ClaudeCodeRuntime
  /** Config for the successor create — the same config the failed resume used. */
  createConfig: Parameters<ClaudeCodeRuntime['create']>[0]
  /** Factory for the read-only probe runtime pointed at the previous workspace. */
  createRuntime: typeof createClaudeCodeRuntime
  /** Probe factory options; its load() resolves the archive under the given cwd. */
  probeRuntimeOptions: (previousCwd: string) => ClaudeCodeRuntimeOptions
  /** Recorded deliberate rebind (AgentSessionService.getLatestWorkspaceEvent). */
  getLatestWorkspaceEvent: (sessionId: string) => AgentSessionWorkspaceEventRow | null
}

/**
 * AC5 of the session workdir rebind spec: a resume that misses its native transcript
 * under the current project tree stays fail-closed UNLESS a deliberate rebind is
 * recorded on the session. With a recorded event whose new path matches the current
 * cwd, the original transcript must still be accessible under the recorded previous
 * path (probed read-only); the session then continues as a successor engine session
 * created under the new cwd, keeping Cherry history and the recorded event.
 *
 * Returns the successor handle, or undefined to keep the caller fail-closed.
 */
export async function openRebindSuccessor(input: RebindResumeInput): Promise<ClaudeThreadHandle | undefined> {
  const event = input.getLatestWorkspaceEvent(input.sessionId)
  if (!event) return undefined
  if (event.newWorkspacePath !== input.currentCwd) {
    // The recorded chain does not explain this mismatch: fail closed.
    logger.warn('Workspace event does not match the current binding; refusing successor resume', {
      sessionId: input.sessionId,
      recordedNewPath: event.newWorkspacePath,
      currentCwd: input.currentCwd
    })
    return undefined
  }

  const probe = input.createRuntime(input.probeRuntimeOptions(event.previousWorkspacePath))
  try {
    const probed = await probe.open({ backendId: runtimeId(input.backendId), id: runtimeId(input.resumeToken) })
    if (probed.status !== 'confirmed') {
      logger.warn('Recorded rebind but the original transcript is not accessible; refusing successor resume', {
        sessionId: input.sessionId,
        previousWorkspacePath: event.previousWorkspacePath,
        error: probed.error.message
      })
      return undefined
    }
    await probed.value.release()
  } finally {
    await probe.shutdown().catch(() => undefined)
  }

  const created = await input.primaryRuntime.create(input.createConfig)
  if (created.status !== 'confirmed') throw new Error(created.error.message)
  logger.info('Recorded workspace rebind: created successor engine session under the new workspace', {
    sessionId: input.sessionId,
    previousWorkspacePath: event.previousWorkspacePath,
    newWorkspacePath: event.newWorkspacePath
  })
  return created.value
}
