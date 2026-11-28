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
  /** Durable recorded rebinds, newest insertion first. */
  getWorkspaceEvents: (sessionId: string) => AgentSessionWorkspaceEventRow[]
}

/**
 * AC5 of the session workdir rebind spec: a resume that misses its native transcript
 * under the current project tree stays fail-closed UNLESS a deliberate rebind is
 * recorded on the session. With a contiguous recorded chain ending at the current
 * cwd, the original transcript must still be accessible under a recorded previous
 * path (each probed read-only, newest first); the session then continues as a successor engine session
 * created under the new cwd, keeping Cherry history and the recorded event.
 *
 * Returns the successor handle, or undefined to keep the caller fail-closed.
 */
export async function openRebindSuccessor(input: RebindResumeInput): Promise<ClaudeThreadHandle | undefined> {
  const events = input.getWorkspaceEvents(input.sessionId)
  const latest = events[0]
  if (!latest || latest.sessionId !== input.sessionId || latest.newWorkspacePath !== input.currentCwd) return undefined

  // Follow only contiguous recorded edges. Repeated rebinds may have no native
  // turn in the intermediate workspace, so the transcript can still live in A.
  let expectedId = latest.newWorkspaceId
  let expectedPath = input.currentCwd
  let transcriptFound = false
  const visitedPaths = new Set<string>()
  for (const event of events) {
    if (
      event.sessionId !== input.sessionId ||
      event.newWorkspaceId !== expectedId ||
      event.newWorkspacePath !== expectedPath
    )
      break
    expectedId = event.previousWorkspaceId
    expectedPath = event.previousWorkspacePath
    if (visitedPaths.has(expectedPath)) continue
    visitedPaths.add(expectedPath)
    const probe = input.createRuntime(input.probeRuntimeOptions(expectedPath))
    try {
      const probed = await probe.open({ backendId: runtimeId(input.backendId), id: runtimeId(input.resumeToken) })
      if (probed.status === 'confirmed') {
        await probed.value.release()
        transcriptFound = true
        break
      }
      if (probed.error.code !== 'native-storage-missing') return undefined
    } finally {
      await probe.shutdown().catch(() => undefined)
    }
  }
  if (!transcriptFound) return undefined

  const created = await input.primaryRuntime.create(input.createConfig)
  if (created.status !== 'confirmed') throw new Error(created.error.message)
  logger.info('Recorded workspace rebind: created successor engine session under the new workspace', {
    sessionId: input.sessionId,
    previousWorkspacePath: expectedPath,
    newWorkspacePath: input.currentCwd
  })
  return created.value
}
