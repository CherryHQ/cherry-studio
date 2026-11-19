import { randomUUID } from 'node:crypto'

import { classifyErrorCategory, type ErrorCategory, extractHttpStatus } from '@shared/utils/errorCategory'

export interface ClaudeCodeProcessDiagnostics {
  readonly reference: string
  exited?: Promise<void>
  terminalReason?: string
  category?: ErrorCategory
  exitCode?: number
  exitSignal?: NodeJS.Signals
  spawnFailed?: true
}

export function createClaudeCodeProcessDiagnostics(reference: string = randomUUID()): ClaudeCodeProcessDiagnostics {
  return { reference }
}

export function resetClaudeCodeProcessDiagnostics(diagnostics: ClaudeCodeProcessDiagnostics): void {
  delete diagnostics.terminalReason
  delete diagnostics.category
  delete diagnostics.exitCode
  delete diagnostics.exitSignal
  delete diagnostics.spawnFailed
}

/** CLI stderr carries no structured status, so the status is recovered from the text itself. */
export function classifyClaudeCodeTerminalReason(reason: string): ErrorCategory {
  return classifyErrorCategory({ text: reason, status: extractHttpStatus(reason) })
}

export function recordClaudeCodeProcessExit(
  diagnostics: ClaudeCodeProcessDiagnostics,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrTail: string
): void {
  const stderr = stderrTail.trim()
  const status = code !== null ? `exited with code ${code}` : `terminated by signal ${String(signal)}`
  diagnostics.terminalReason = `Claude Code process ${status}${stderr ? `. stderr: ${stderr}` : ''}`
  diagnostics.category = classifyClaudeCodeTerminalReason(stderr)
  if (code !== null) diagnostics.exitCode = code
  if (signal !== null) diagnostics.exitSignal = signal
}

export function recordClaudeCodeSpawnError(diagnostics: ClaudeCodeProcessDiagnostics, error: Error): void {
  diagnostics.terminalReason = `Failed to spawn Claude Code process: ${error.message}`
  diagnostics.category = classifyClaudeCodeTerminalReason(diagnostics.terminalReason)
  diagnostics.spawnFailed = true
}

export function isClaudeCodeProcessFailure(error: unknown, diagnostics?: ClaudeCodeProcessDiagnostics): error is Error {
  return (
    error instanceof Error &&
    (diagnostics?.spawnFailed === true ||
      /Claude Code process (?:exited with code|terminated by signal|failed to spawn)|Failed to spawn Claude Code process/i.test(
        error.message
      ))
  )
}

export function createClaudeCodeProcessExitError(
  originalError: Error,
  diagnostics: ClaudeCodeProcessDiagnostics
): Error {
  const status =
    diagnostics.exitCode !== undefined
      ? `exited with code ${diagnostics.exitCode}`
      : diagnostics.exitSignal
        ? `terminated by signal ${diagnostics.exitSignal}`
        : 'failed to start'
  const error = Object.assign(new Error(`Claude Code process ${status}`), {
    name: 'ClaudeCodeProcessExitError',
    claudeCodeExitCategory:
      diagnostics.category ?? classifyClaudeCodeTerminalReason(diagnostics.terminalReason ?? originalError.message),
    diagnosticReference: diagnostics.reference
  })
  if (diagnostics.exitCode !== undefined) Object.assign(error, { processExitCode: diagnostics.exitCode })
  if (diagnostics.exitSignal) Object.assign(error, { processExitSignal: diagnostics.exitSignal })
  return error
}

/** Preserve interrupted output only when native abortion or a truncated JSON frame proves the boundary. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Process and stream failures are untyped; only verified string diagnostics can establish a truncated JSON frame.
export function canSalvageClaudeOutput(error: unknown, bufferedChars: number, aborted: boolean): boolean {
  if (aborted) return true
  if (bufferedChars >= 512 && typeof error === 'object' && error !== null) {
    try {
      const name = 'name' in error ? error.name : undefined
      const message = 'message' in error ? error.message : undefined
      return (
        typeof name === 'string' &&
        name.toLowerCase() === 'syntaxerror' &&
        typeof message === 'string' &&
        /unexpected end of (?:json input|input|string)|unexpected eof|end of file|unterminated string/i.test(message)
      )
    } catch {
      return false
    }
  }
  return false
}
