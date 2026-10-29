/**
 * Fire-time precondition for `agent.task` runs. A failing guard makes
 * `runAgentTask` return a skipped result before any session or agent turn exists.
 */

import { spawn } from 'node:child_process'
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
        // The contract is exit-code-only, so unused output is discarded at the
        // fd level (`stdio: 'ignore'`). Buffering it (exec's default 1 MiB
        // maxBuffer) let output VOLUME fail an otherwise successful command.
        const child = spawn(guard.command, {
          shell: true,
          stdio: 'ignore',
          signal: options.signal,
          windowsHide: true
        })
        // Manual timeout (not spawn's `timeout` option) so the skip reason can
        // distinguish our own timeout kill from an external signal.
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          child.kill()
        }, GUARD_COMMAND_TIMEOUT_MS)
        const settleAbort = () => {
          // Cancellation is not a failed predicate: propagate it so the job
          // finalizes as cancelled instead of recording a guard skip.
          const reason = options.signal?.reason
          clearTimeout(timer)
          reject(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
        }
        const settleOutcome = (outcome: TaskGuardOutcome) => {
          clearTimeout(timer)
          resolve(outcome)
        }
        child.once('error', (error) => {
          if (options.signal?.aborted) return settleAbort()
          settleOutcome({ proceed: false, reason: `command failed (${error.message}): ${guard.command}` })
        })
        child.once('exit', (code, exitSignal) => {
          if (options.signal?.aborted) return settleAbort()
          if (code === 0) return settleOutcome({ proceed: true })
          const detail = timedOut
            ? 'timed out'
            : typeof code === 'number'
              ? `exit code ${code}`
              : `signal ${exitSignal}`
          settleOutcome({ proceed: false, reason: `command failed (${detail}): ${guard.command}` })
        })
      })
  }
}
