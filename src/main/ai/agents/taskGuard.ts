/**
 * Fire-time precondition for `agent.task` runs. A failing guard makes
 * `runAgentTask` return a skipped result before any session or agent turn exists.
 */

import { execFile, spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import type { TaskGuard } from '@shared/data/api/schemas/agents'

/** A guard command is a cheap check, not a job — bound it so a hung command cannot hold the run slot. */
const GUARD_COMMAND_TIMEOUT_MS = 30_000
/** Grace between SIGTERM and SIGKILL so a signal-ignoring command still terminates in bounded time. */
const GUARD_KILL_GRACE_MS = 5_000

/**
 * File authority for a guard path an agent (not the user) proposes: the target must lie inside the
 * session workspace. Decided lexically, before any filesystem access, so a rejected path never
 * triggers a host lookup (including a Windows network path that could start SMB authentication).
 */
export function resolveAgentGuardPath(workspaceRoot: string, requested: string): string {
  const trimmed = requested.trim()
  // UNC (\\host\share, //host/share) and Windows device namespaces (\\?\, \\.\) leave the local workspace.
  if (/^[\\/]{2}/.test(trimmed)) {
    throw new Error(`file_changed guard path must be inside the session workspace: ${requested}`)
  }
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(root, trimmed)
  const relative = path.relative(root, target)
  if (!isStrictlyInside(relative)) {
    throw new Error(`file_changed guard path must be inside the session workspace: ${requested}`)
  }
  return target
}

/** `relative` is a path.relative(root, target) result. Whole `..` components escape; `..report.json` does not. */
function isStrictlyInside(relative: string): boolean {
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * Resolve a guard file for stat. A guard that carries its proposing workspace is confined there by
 * `realpath` (symlinks followed on both sides); otherwise the saved path is used as the user wrote it.
 */
async function resolveGuardFileForStat(guard: {
  path: string
  workspaceRoot?: string
}): Promise<{ kind: 'stat'; path: string } | { kind: 'outside' } | { kind: 'missing' }> {
  if (!guard.workspaceRoot) return { kind: 'stat', path: guard.path }
  let realRoot: string
  try {
    realRoot = await realpath(guard.workspaceRoot)
  } catch {
    // Without the root the confinement cannot be confirmed, so nothing is statted.
    return { kind: 'outside' }
  }
  let realTarget: string
  try {
    realTarget = await realpath(guard.path)
  } catch {
    return { kind: 'missing' }
  }
  return isStrictlyInside(path.relative(realRoot, realTarget))
    ? { kind: 'stat', path: realTarget }
    : { kind: 'outside' }
}

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
      // Tasks saved before save-time file authority existed may still hold a network path: never stat it.
      if (/^[\\/]{2}/.test(guard.path.trim())) {
        return { proceed: false, reason: 'file guard path is not allowed' }
      }
      const resolved = await resolveGuardFileForStat(guard)
      if (resolved.kind === 'outside') {
        return { proceed: false, reason: 'file guard path is outside the workspace' }
      }
      let mtimeMs: number
      try {
        if (resolved.kind === 'missing') throw new Error('missing')
        mtimeMs = (await stat(resolved.path)).mtimeMs
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
        if (options.signal?.aborted) {
          const reason = options.signal.reason
          throw reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted'))
        }
        const child = spawn(guard.command, {
          shell: true,
          stdio: 'ignore',
          detached: process.platform !== 'win32',
          windowsHide: true
        })

        // The SIGKILL escalation timer deliberately outlives settlement: it is
        // part of the bounded-termination contract, so settling never clears it.
        let settled = false
        let stopping = false
        const startedAt = performance.now()
        const signalTree = (force: boolean) => {
          if (!child.pid) return
          if (process.platform === 'win32') {
            // Force the whole live tree before its shell can disappear; Windows has no process groups.
            execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
          } else {
            try {
              process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
            } catch {
              // The process group may already have exited.
            }
          }
        }
        const stopTree = () => {
          if (stopping) return
          stopping = true
          signalTree(false)
          const killTimer = setTimeout(() => signalTree(true), GUARD_KILL_GRACE_MS)
          killTimer.unref?.()
        }

        const settleAbort = () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const reason = options.signal?.reason
          // Cancellation is not a failed predicate: propagate it so the job
          // finalizes as cancelled instead of recording a guard skip.
          reject(reason instanceof Error ? reason : new Error(String(reason ?? 'Task aborted')))
        }
        const settleOutcome = (outcome: TaskGuardOutcome) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(outcome)
        }

        // Manual timeout (not spawn's `timeout` option) so the skip reason can
        // distinguish our own timeout kill from an external signal.
        const timer = setTimeout(() => {
          // Cancellation wins a timeout race deterministically.
          if (options.signal?.aborted) {
            stopTree()
            return settleAbort()
          }
          // Timeout is an irreversible skip outcome: settle now rather than
          // waiting for the process to exit, so a command that handles SIGTERM
          // by exiting 0 cannot turn the deadline into an approval. The
          // SIGTERM/SIGKILL pair below is the disclosed bounded-termination
          // follow-through for the owned process group (Windows uses taskkill /T /F).
          settleOutcome({ proceed: false, reason: `command failed (timed out): ${guard.command}` })
          stopTree()
        }, GUARD_COMMAND_TIMEOUT_MS)

        // Retain child error/exit listeners through its close event, including the kill grace.
        const onError = (error: Error) => {
          if (settled) return
          if (options.signal?.aborted) return settleAbort()
          settleOutcome({ proceed: false, reason: `command failed (${error.message}): ${guard.command}` })
        }
        const onExit = (code: number | null, exitSignal: NodeJS.Signals | null) => {
          if (options.signal?.aborted) {
            stopTree()
            return settleAbort()
          }
          // A timeout already settled the skip; nothing here may reopen it.
          if (settled) return
          // A stalled main loop can deliver this callback before the overdue timer; the deadline binds anyway.
          if (performance.now() - startedAt >= GUARD_COMMAND_TIMEOUT_MS) {
            stopTree()
            return settleOutcome({ proceed: false, reason: `command failed (timed out): ${guard.command}` })
          }
          // A background child must not survive the predicate's normal shell exit either.
          signalTree(true)
          if (code === 0) return settleOutcome({ proceed: true })
          const detail = typeof code === 'number' ? `exit code ${code}` : `signal ${exitSignal}`
          settleOutcome({ proceed: false, reason: `command failed (${detail}): ${guard.command}` })
        }
        const onAbort = () => {
          stopTree()
          settleAbort()
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })
        if (options.signal?.aborted) onAbort()
        child.on('error', onError)
        child.on('exit', onExit)
        child.once('close', () => {
          options.signal?.removeEventListener('abort', onAbort)
          child.removeListener('error', onError)
          child.removeListener('exit', onExit)
        })
      })
  }
}
