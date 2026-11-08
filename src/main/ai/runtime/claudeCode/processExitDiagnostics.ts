import { randomUUID } from 'node:crypto'

import { classifyErrorCategory, type ErrorCategory, extractHttpStatus } from '@shared/utils/errorCategory'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

export interface ClaudeCodeProcessDiagnostics {
  readonly reference: string
  exited?: Promise<void>
  terminalReason?: string
  output?: string
  category?: ErrorCategory
  exitCode?: number
  exitSignal?: NodeJS.Signals
  spawnFailed?: true
}

export function createClaudeCodeProcessDiagnostics(reference: string = randomUUID()): ClaudeCodeProcessDiagnostics {
  return { reference }
}

export function resetClaudeCodeProcessDiagnostics(diagnostics: ClaudeCodeProcessDiagnostics): void {
  delete diagnostics.output
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
  diagnostics.output = stderr
  diagnostics.category = classifyClaudeCodeTerminalReason(stderr)
  if (code !== null) diagnostics.exitCode = code
  if (signal !== null) diagnostics.exitSignal = signal
  if (code !== 0) notifyProcessFailure(diagnostics)
}

export function recordClaudeCodeSpawnError(diagnostics: ClaudeCodeProcessDiagnostics, error: Error): void {
  diagnostics.terminalReason = `Failed to spawn Claude Code process: ${error.message}`
  diagnostics.category = classifyClaudeCodeTerminalReason(diagnostics.terminalReason)
  diagnostics.output = error.message
  diagnostics.spawnFailed = true
  notifyProcessFailure(diagnostics)
}

const failureListeners = new WeakMap<ClaudeCodeProcessDiagnostics, Set<() => void>>()

export function hasClaudeCodeProcessFailure(diagnostics?: ClaudeCodeProcessDiagnostics): boolean {
  return (
    diagnostics?.spawnFailed === true ||
    diagnostics?.exitSignal !== undefined ||
    (diagnostics?.exitCode !== undefined && diagnostics.exitCode !== 0)
  )
}

function notifyProcessFailure(diagnostics: ClaudeCodeProcessDiagnostics): void {
  for (const listener of failureListeners.get(diagnostics) ?? []) listener()
}

/** Separate from the SDK transport stream, including failures recorded during prewarm. */
export function subscribeClaudeCodeProcessFailure(
  diagnostics: ClaudeCodeProcessDiagnostics,
  listener: () => void
): () => void {
  const listeners = failureListeners.get(diagnostics) ?? new Set()
  failureListeners.set(diagnostics, listeners)
  listeners.add(listener)
  if (hasClaudeCodeProcessFailure(diagnostics)) listener()
  return () => listeners.delete(listener)
}

export function isClaudeCodeProcessFailure(error: unknown, diagnostics?: ClaudeCodeProcessDiagnostics): error is Error {
  return (
    error instanceof Error && (error.name === 'ClaudeCodeProcessExitError' || hasClaudeCodeProcessFailure(diagnostics))
  )
}

function safeProcessOutput(output: string): string {
  // An unquoted path's end is ambiguous when it contains spaces. Prefer losing
  // the remainder of that diagnostic line to exposing a private path suffix.
  const ansiColor = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g')
  const text = output
    .replace(ansiColor, '')
    .replace(/https?:\/\/[^\s"']+/gi, '<redacted-url>')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n]*/g, '<redacted-path>')
    .replace(/(^|[\s"'=(:[{,;~`<>)])\/[^\r\n]*/g, '$1<redacted-path>')
  return redactSecretTokens(redactSecretText(text)).slice(0, 1000)
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
  return Object.assign(new Error(`Claude Code process ${status}`), {
    name: 'ClaudeCodeProcessExitError',
    processExitDetail: safeProcessOutput(diagnostics.output ?? ''),
    claudeCodeExitCategory:
      diagnostics.category ?? classifyClaudeCodeTerminalReason(diagnostics.terminalReason ?? originalError.message),
    diagnosticReference: diagnostics.reference,
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
