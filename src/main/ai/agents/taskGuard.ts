/**
 * Fire-time precondition for `agent.task` runs. A failing guard makes
 * `runAgentTask` return a skipped result before any session or agent turn exists.
 */

import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'

import type { TaskGuard } from '@shared/data/api/schemas/agents'

/** A guard command is a cheap check, not a job — bound it so a hung command cannot hold the run slot. */
const GUARD_COMMAND_TIMEOUT_MS = 30_000
/** Grace between SIGTERM and SIGKILL so a signal-ignoring command still terminates in bounded time. */
const GUARD_KILL_GRACE_MS = 5_000

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

        let timer: ReturnType<typeof setTimeout> | undefined
        // The SIGKILL escalation timer deliberately outlives settlement: it is
        // part of the bounded-termination contract, so `cleanup` never clears it.
        let settled = false

        const cleanup = () => {
          if (timer) clearTimeout(timer)
          child.removeAllListeners('error')
          child.removeAllListeners('exit')
        }
        const settleAbort = () => {
          if (settled) return
          settled = true
          const reason = options.signal?.reason
          cleanup()
          // Cancellation is not a failed predicate: propagate it so the job
          // finalizes as cancelled instead of recording a guard skip.
          reject(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
        }
        const settleOutcome = (outcome: TaskGuardOutcome) => {
          if (settled) return
          settled = true
          cleanup()
          resolve(outcome)
        }
        const escalateKill = () => {
          const killTimer = setTimeout(() => {
            try {
              child.kill('SIGKILL')
            } catch {
              // Already reaped between SIGTERM and the escalation deadline.
            }
          }, GUARD_KILL_GRACE_MS)
          killTimer.unref?.()
        }

        // Manual timeout (not spawn's `timeout` option) so the skip reason can
        // distinguish our own timeout kill from an external signal.
        timer = setTimeout(() => {
          // Cancellation wins a timeout race deterministically.
          if (options.signal?.aborted) return settleAbort()
          // Timeout is an irreversible skip outcome: settle now rather than
          // waiting for the process to exit, so a command that handles SIGTERM
          // by exiting 0 cannot turn the deadline into an approval. The
          // SIGTERM/SIGKILL pair below is the disclosed bounded-termination
          // follow-through for the shell we own; it does not claim to reap
          // descendants the command spawned (tracked as a separate residual).
          settleOutcome({ proceed: false, reason: `command failed (timed out): ${guard.command}` })
          try {
            child.kill()
          } catch {
            // Already gone between the deadline and the kill.
          }
          escalateKill()
        }, GUARD_COMMAND_TIMEOUT_MS)

        child.once('error', (error) => {
          if (options.signal?.aborted) return settleAbort()
          settleOutcome({ proceed: false, reason: `command failed (${error.message}): ${guard.command}` })
        })
        child.once('exit', (code, exitSignal) => {
          if (options.signal?.aborted) return settleAbort()
          // A timeout already settled the skip; nothing here may reopen it.
          if (settled) return
          if (code === 0) return settleOutcome({ proceed: true })
          const detail = typeof code === 'number' ? `exit code ${code}` : `signal ${exitSignal}`
          settleOutcome({ proceed: false, reason: `command failed (${detail}): ${guard.command}` })
        })
      })
  }
}
