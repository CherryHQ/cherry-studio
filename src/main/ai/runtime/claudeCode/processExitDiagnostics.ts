import { randomUUID } from 'node:crypto'

import { classifyErrorCategory, type ErrorCategory, extractHttpStatus } from '@shared/utils/errorCategory'

import {
  formatLaunchSizeSummary,
  launchSizeErrno,
  summarizeLaunchInput,
  type ClaudeCodeLaunchInput,
  type ClaudeCodeLaunchSize
} from './claudeCodeLaunchSize'

export interface ClaudeCodeProcessDiagnostics {
  readonly reference: string
  exited?: Promise<void>
  terminalReason?: string
  category?: ErrorCategory
  exitCode?: number
  exitSignal?: NodeJS.Signals
  launchSize?: ClaudeCodeLaunchSize
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
  delete diagnostics.launchSize
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

export function recordClaudeCodeSpawnError(
  diagnostics: ClaudeCodeProcessDiagnostics,
  error: Error,
  launch?: ClaudeCodeLaunchInput
): void {
  const errno = launch && launchSizeErrno(error)
  if (launch && errno) {
    diagnostics.category = 'launch_size'
    diagnostics.launchSize = summarizeLaunchInput(launch, errno)
    diagnostics.terminalReason = `Failed to spawn Claude Code process: ${formatLaunchSizeSummary(diagnostics.launchSize)}`
    diagnostics.spawnFailed = true
    return
  }
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
  return Object.assign(new Error(`Claude Code process ${status}`), {
    name: 'ClaudeCodeProcessExitError',
    claudeCodeExitCategory:
      diagnostics.category ?? classifyClaudeCodeTerminalReason(diagnostics.terminalReason ?? originalError.message),
    diagnosticReference: diagnostics.reference,
    ...(diagnostics.exitCode !== undefined ? { processExitCode: diagnostics.exitCode } : {}),
    ...(diagnostics.exitSignal ? { processExitSignal: diagnostics.exitSignal } : {})
  })
}
