/**
 * `shell__exec` tool — run a shell command.
 *
 * Cross-platform:
 *   Unix:    $SHELL -c <command>     (fallback /bin/bash)
 *   Windows: pwsh -Command <command> (fallback powershell.exe)
 *
 * Output is captured (stdout + stderr separately) and returned in one
 * tool result. Streaming preliminary results is deferred until a
 * concrete consumer asks — most cherry shell calls are short.
 *
 * Truncation: combined stdout + stderr capped at 100KB to protect
 * downstream context windows. Output beyond the cap is dropped (not
 * rotated) and `truncated: true` is reported.
 *
 * AbortSignal: when the AI SDK aborts the tool call (parent stream
 * cancelled), we send SIGTERM to the child. Models receive an
 * `aborted` error so they don't retry blindly.
 *
 * Out-of-scope this PR:
 *  - `run_in_background` (would need companion read/kill tools)
 *  - Per-command approval gate (will plug into `toolApprovalRegistry`
 *    once it covers builtin tools — today it's ClaudeCode-specific)
 *  - Sandbox / restricted env (desktop trust model)
 */

import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

import { type Tool, tool } from 'ai'
import * as z from 'zod'

import { BuiltinToolNamespace, ToolCapability, ToolDefer, type ToolEntry } from '../../types'
import { selectShell } from './shellSelection'

export const SHELL_EXEC_TOOL_NAME = 'shell__exec'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 10 * 60_000
const MAX_OUTPUT_BYTES = 100_000

const inputSchema = z.object({
  command: z.string().min(1).describe('The shell command to run.'),
  cwd: z.string().optional().describe('Absolute working directory. When omitted, uses the cherry process cwd.'),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe(`Timeout in milliseconds. Default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}.`)
})

const outputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('completed'),
    exitCode: z.number().int(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number().int(),
    truncated: z.boolean()
  }),
  z.object({
    kind: z.literal('timed-out'),
    stdout: z.string(),
    stderr: z.string(),
    timeoutMs: z.number().int()
  }),
  z.object({
    kind: z.literal('error'),
    code: z.enum(['relative-cwd', 'spawn-failed', 'aborted']),
    message: z.string()
  })
])

type ShellExecOutput = z.infer<typeof outputSchema>

function shellExecToModelOutput({
  output
}: {
  toolCallId: string
  input: unknown
  output: ShellExecOutput
}): { type: 'text'; value: string } | { type: 'error-text'; value: string } {
  if (output.kind === 'error') {
    return { type: 'error-text', value: `[Error: ${output.code}] ${output.message}` }
  }
  if (output.kind === 'timed-out') {
    const lines: string[] = [`[timed-out after ${output.timeoutMs}ms]`]
    if (output.stdout) lines.push(`--- stdout ---\n${output.stdout}`)
    if (output.stderr) lines.push(`--- stderr ---\n${output.stderr}`)
    return { type: 'error-text', value: lines.join('\n\n') }
  }
  // completed
  const header = `[exit ${output.exitCode}, ${output.durationMs}ms${output.truncated ? ', output truncated' : ''}]`
  const parts = [header]
  if (output.stdout) parts.push(output.stdout.trimEnd())
  if (output.stderr) parts.push(`--- stderr ---\n${output.stderr.trimEnd()}`)
  return { type: 'text', value: parts.join('\n') }
}

const shellExecTool = tool({
  description: `Run a shell command and return its stdout + stderr.

Use for:
- Running build / test / lint commands
- Inspecting environment or git state
- Listing or counting files via standard tools (\`find\`, \`ls\`, \`wc\`, etc.)

Behavior:
- Unix: invoked via \`$SHELL -c\` (fallback /bin/bash).
- Windows: invoked via \`pwsh -Command\` (fallback powershell.exe).
- Default timeout 30s, max 10 minutes.
- Combined output truncated at 100KB; the result reports \`truncated: true\` if hit.
- \`cwd\` must be absolute when provided.

The command runs in cherry's environment. Avoid commands that require interactive input — they'll hang until timeout.`,
  inputSchema,
  outputSchema,
  toModelOutput: shellExecToModelOutput,
  execute: async ({ command, cwd, timeout }, { abortSignal }): Promise<ShellExecOutput> => {
    if (cwd !== undefined && !isAbsolute(cwd)) {
      return { kind: 'error', code: 'relative-cwd', message: `cwd must be absolute. Got: ${cwd}` }
    }

    const { shell, flag } = selectShell()
    const start = Date.now()
    const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS

    return await new Promise<ShellExecOutput>((resolve) => {
      const child = spawn(shell, [flag, command], {
        cwd: cwd ?? process.cwd(),
        env: process.env
      })

      let stdout = ''
      let stderr = ''
      let truncated = false
      let timedOut = false
      let aborted = false

      const append = (which: 'stdout' | 'stderr', text: string): void => {
        const current = which === 'stdout' ? stdout : stderr
        const otherLen = which === 'stdout' ? stderr.length : stdout.length
        const remaining = MAX_OUTPUT_BYTES - current.length - otherLen
        if (remaining <= 0) {
          truncated = true
          return
        }
        const piece = text.length > remaining ? text.slice(0, remaining) : text
        if (text.length > remaining) truncated = true
        if (which === 'stdout') stdout = current + piece
        else stderr = current + piece
      }

      child.stdout.on('data', (buf: Buffer) => append('stdout', buf.toString('utf-8')))
      child.stderr.on('data', (buf: Buffer) => append('stderr', buf.toString('utf-8')))

      const onAbort = (): void => {
        aborted = true
        child.kill('SIGTERM')
      }
      abortSignal?.addEventListener('abort', onAbort, { once: true })

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeoutMs)

      child.on('error', (err) => {
        clearTimeout(timer)
        abortSignal?.removeEventListener('abort', onAbort)
        resolve({
          kind: 'error',
          code: 'spawn-failed',
          message: err.message
        })
      })

      child.on('close', (exitCode) => {
        clearTimeout(timer)
        abortSignal?.removeEventListener('abort', onAbort)

        if (aborted) {
          resolve({ kind: 'error', code: 'aborted', message: 'Command aborted by caller' })
          return
        }
        if (timedOut) {
          resolve({ kind: 'timed-out', stdout, stderr, timeoutMs })
          return
        }
        resolve({
          kind: 'completed',
          exitCode: exitCode ?? -1,
          stdout,
          stderr,
          durationMs: Date.now() - start,
          truncated
        })
      })
    })
  }
}) as Tool

export function createShellExecToolEntry(): ToolEntry {
  return {
    name: SHELL_EXEC_TOOL_NAME,
    namespace: BuiltinToolNamespace.Shell,
    description: 'Run a shell command (bash on Unix, pwsh on Windows). Returns stdout, stderr, exit code.',
    defer: ToolDefer.Auto,
    capability: ToolCapability.Compute,
    tool: shellExecTool
  }
}
