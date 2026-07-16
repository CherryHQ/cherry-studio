/**
 * Bounded bash tool for the `ai-sdk` agent runtime (plan D6).
 *
 * There is no OS-level sandbox (documented tradeoff): confinement is
 * best-effort — cwd pinned to the workspace, bounded output, bounded
 * runtime, process-tree cleanup on timeout/abort, and an execution
 * environment without credential-shaped variables. The hard denial of
 * global installs and the approval gate live in `toolPolicy` (the policy
 * wrapper is built with {@link bashDenyReason}); `rtkRewrite` runs here,
 * after the gates and before the spawn, mirroring pi's gate order.
 */

import { spawn } from 'node:child_process'

import { loggerService } from '@logger'
import { getBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { rtkRewrite } from '@main/utils/rtk'
import type { Tool } from 'ai'
import * as z from 'zod'

import { detectGlobalInstall } from '../../toolApproval/dependencyGuard'

const logger = loggerService.withContext('AiSdkAgentBashTool')

export const DEFAULT_BASH_TIMEOUT_MS = 120_000
export const MAX_BASH_TIMEOUT_MS = 600_000
/** Combined stdout+stderr cap; excess is discarded, not buffered. */
export const MAX_BASH_OUTPUT_CHARS = 30_000

/** Substrings marking credential-shaped env keys (superset of codeCli's
 *  `SENSITIVE_ENV_KEYS` log redaction, kept separate so stripping here can
 *  tighten independently). A denylist cannot be complete — this covers
 *  provider keys (`*_API_KEY`), cloud credentials (`AWS_ACCESS_KEY_ID`,
 *  `GOOGLE_APPLICATION_CREDENTIALS`), and the common token/secret shapes. */
const SENSITIVE_ENV_KEY_FRAGMENTS = [
  'API_KEY',
  'APIKEY',
  'ACCESS_KEY',
  'AUTHORIZATION',
  'CREDENTIAL',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD'
]

export const BashToolSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  timeout: z
    .number()
    .optional()
    .describe(`Timeout in milliseconds (default ${DEFAULT_BASH_TIMEOUT_MS}, max ${MAX_BASH_TIMEOUT_MS})`)
})

/**
 * Hard denial evaluated by the policy wrapper in every permission mode —
 * before any approval prompt, so a doomed install never surfaces a card.
 */
export function bashDenyReason(input: unknown): string | null {
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== 'string' || !command.trim()) return null
  const reason = detectGlobalInstall(command)
  if (!reason) return null
  return `Blocked to avoid cross-agent dependency pollution: ${reason}. Install into the current project instead (e.g. \`bun install <pkg>\`, or \`uv run --with <pkg> python\`); for one-off tools use \`bun x <tool>\` / \`uvx <tool>\`.`
}

/**
 * Execution env: login-shell basics plus Cherry's managed-binary paths, with
 * credential-shaped variables stripped so a prompt-injected command cannot
 * exfiltrate provider keys or tokens riding in the app environment.
 */
export function buildBashEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...process.env, ...getBinaryExecutionEnv() })) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (SENSITIVE_ENV_KEY_FRAGMENTS.some((fragment) => upper.includes(fragment))) continue
    env[key] = value
  }
  return env
}

export function createBashTool(opts: { workspacePath: string }): Tool {
  return {
    description: `Executes a shell command in the session workspace.

- The working directory is always the workspace root; it cannot be changed per call
- Combined output is capped at ${MAX_BASH_OUTPUT_CHARS} characters (excess is truncated)
- Commands are killed (with their whole process tree) on timeout or turn abort
- Global package installs (npm -g, pipx, uv tool, …) are blocked — install into the project instead`,
    inputSchema: BashToolSchema,
    execute: async (input: unknown, options) => {
      const parsed = BashToolSchema.safeParse(input)
      if (!parsed.success) throw new Error(`Invalid arguments for bash: ${parsed.error}`)
      let command = parsed.data.command
      const timeoutMs = Math.min(Math.max(parsed.data.timeout ?? DEFAULT_BASH_TIMEOUT_MS, 1), MAX_BASH_TIMEOUT_MS)

      const rewritten = await rtkRewrite(command)
      if (rewritten) {
        logger.info('rtk rewrote bash command', { original: command, rewritten })
        command = rewritten
      }

      return runBoundedCommand(command, {
        cwd: opts.workspacePath,
        timeoutMs,
        signal: options?.abortSignal
      })
    }
  }
}

interface BoundedRunOptions {
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}

/** Run one shell command with output cap, timeout, and tree-kill semantics. */
export async function runBoundedCommand(command: string, opts: BoundedRunOptions): Promise<string> {
  if (opts.signal?.aborted) throw new Error('Command aborted before start')

  // `detached` puts the child in its own process group on POSIX so a timeout
  // or abort can SIGKILL the whole tree via the negative pid; Windows gets
  // the equivalent through `taskkill /T /F`.
  const child = spawn(command, {
    shell: true,
    cwd: opts.cwd,
    env: buildBashEnv(),
    detached: process.platform !== 'win32',
    windowsHide: true
  })

  let stdout = ''
  let stderr = ''
  let truncated = false
  let capacity = MAX_BASH_OUTPUT_CHARS
  const append = (target: 'stdout' | 'stderr', data: Buffer) => {
    if (capacity <= 0) {
      truncated = true
      return
    }
    const text = data.toString('utf-8')
    const slice = text.length > capacity ? text.slice(0, capacity) : text
    if (slice.length < text.length) truncated = true
    capacity -= slice.length
    if (target === 'stdout') stdout += slice
    else stderr += slice
  }
  child.stdout?.on('data', (data: Buffer) => append('stdout', data))
  child.stderr?.on('data', (data: Buffer) => append('stderr', data))

  let timedOut = false
  let aborted = false
  const killTree = () => {
    if (child.pid === undefined) return
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
  }
  const timer = setTimeout(() => {
    timedOut = true
    killTree()
  }, opts.timeoutMs)
  const onAbort = () => {
    aborted = true
    killTree()
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      // `close` (not `exit`) so the capped output streams have flushed.
      child.once('close', (code) => resolve(code))
    })

    const output = composeOutput(stdout, stderr, truncated)
    if (aborted) throw new Error(`Command aborted.\n${output}`.trim())
    if (timedOut) throw new Error(`Command timed out after ${opts.timeoutMs}ms.\n${output}`.trim())
    if (exitCode !== 0) return `${output}\n\nExit code: ${exitCode}`.trim()
    return output
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

function composeOutput(stdout: string, stderr: string, truncated: boolean): string {
  const sections: string[] = []
  if (stdout) sections.push(stdout.trimEnd())
  if (stderr) sections.push(`stderr:\n${stderr.trimEnd()}`)
  if (truncated) sections.push(`[output truncated at ${MAX_BASH_OUTPUT_CHARS} characters]`)
  return sections.join('\n\n') || '(no output)'
}
