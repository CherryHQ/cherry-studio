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
  /** Resolved runtime executable the spawn was attempted against (main-process log only). */
  executable?: string
  /** Raw `code` of a synchronous spawn failure (e.g. ENOENT, EACCES). */
  spawnErrorCode?: string
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
  delete diagnostics.executable
  delete diagnostics.spawnErrorCode
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
  const code = (error as NodeJS.ErrnoException).code
  if (typeof code === 'string' && code) diagnostics.spawnErrorCode = code
  const executable = diagnostics.executable ? ` executable: ${diagnostics.executable}` : ''
  const suffix = typeof code === 'string' && code ? ` (code: ${code})` : ''
  diagnostics.terminalReason = `Failed to spawn Claude Code process${executable}${suffix}: ${error.message}`
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
  // A spawn failure means the executable was resolved but the OS refused to launch it
  // (missing file deleted after validation, EACCES, antivirus quarantine, broken install).
  // The renderer headline prefers an app-owned i18nKey over the `unknown` category, so surface
  // actionable recovery copy here while the description keeps the diagnostic reference.
  // The resolved path and raw spawn cause stay in the main-process log only (`terminalReason`).
  const spawnRecovery =
    diagnostics.spawnFailed === true
      ? {
          i18nKey: 'claude_code_spawn_failed',
          detailI18nKey: 'claude_code_spawn_failed_detail'
        }
      : {}
  return Object.assign(new Error(`Claude Code process ${status}`), {
    name: 'ClaudeCodeProcessExitError',
    claudeCodeExitCategory:
      diagnostics.category ?? classifyClaudeCodeTerminalReason(diagnostics.terminalReason ?? originalError.message),
    diagnosticReference: diagnostics.reference,
    ...spawnRecovery,
    ...(diagnostics.exitCode !== undefined ? { processExitCode: diagnostics.exitCode } : {}),
    ...(diagnostics.exitSignal ? { processExitSignal: diagnostics.exitSignal } : {})
  })
}

/** Preserve interrupted output only when native abortion or a truncated JSON frame proves the boundary. */
export function canSalvageClaudeOutput(error: unknown, bufferedChars: number, aborted: boolean): boolean {
  if (aborted) return true
  const value = error as { name?: string; message?: string } | null
  return (
    bufferedChars >= 512 &&
    value?.name?.toLowerCase() === 'syntaxerror' &&
    /unexpected end of (?:json input|input|string)|unexpected eof|end of file|unterminated string/i.test(
      value.message ?? ''
    )
  )
}
