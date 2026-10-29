/**
 * Fire-time precondition for `agent.task` runs. A failing guard makes
 * `runAgentTask` return a skipped result before any session or agent turn exists.
 */

import { exec } from 'node:child_process'
import { stat } from 'node:fs/promises'

import type { TaskGuard } from '@shared/data/api/schemas/agents'

/** A guard command is a cheap check, not a job — bound it so a hung command cannot hold the run slot. */
const GUARD_COMMAND_TIMEOUT_MS = 30_000

export type TaskGuardOutcome = { proceed: true } | { proceed: false; reason: string }

/**
 * @param lastRunStartedAt Start time (ms) of the previous executed run, or `null` when there is none.
 */
export async function evaluateTaskGuard(
  guard: TaskGuard,
  options: { lastRunStartedAt: number | null; signal?: AbortSignal }
): Promise<TaskGuardOutcome> {
  switch (guard.type) {
    case 'always':
      return { proceed: true }
    case 'file_changed': {
      let mtimeMs: number
      try {
        mtimeMs = (await stat(guard.path)).mtimeMs
      } catch {
        return { proceed: false, reason: `file missing: ${guard.path}` }
      }
      if (options.lastRunStartedAt !== null && mtimeMs <= options.lastRunStartedAt) {
        return { proceed: false, reason: `unchanged: ${guard.path}` }
      }
      return { proceed: true }
    }
    case 'command':
      return await new Promise<TaskGuardOutcome>((resolve, reject) => {
        exec(
          guard.command,
          { timeout: GUARD_COMMAND_TIMEOUT_MS, signal: options.signal, windowsHide: true },
          (error) => {
            // Cancellation is not a failed predicate: propagate it so the job
            // finalizes as cancelled instead of recording a guard skip.
            if (options.signal?.aborted) {
              const reason = options.signal.reason
              return reject(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
            }
            if (!error) return resolve({ proceed: true })
            const code = (error as { code?: unknown }).code
            const detail = error.killed ? 'timed out' : typeof code === 'number' ? `exit code ${code}` : error.message
            resolve({ proceed: false, reason: `command failed (${detail}): ${guard.command}` })
          }
        )
      })
  }
}
