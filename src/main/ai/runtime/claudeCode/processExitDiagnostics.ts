import { randomUUID } from 'node:crypto'

import { t } from '@main/i18n'
import { classifyErrorCategory, type ErrorCategory, extractHttpStatus } from '@shared/utils/errorCategory'

export interface ClaudeCodeProcessDiagnostics {
  readonly reference: string
  exited?: Promise<void>
  terminalReason?: string
  category?: ErrorCategory
  exitCode?: number
  exitSignal?: NodeJS.Signals
  spawnFailed?: true
  /** Recorded at spawn: the launch env had no usable Linux session-bus address. */
  sessionBusUnavailable?: true
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
  delete diagnostics.sessionBusUnavailable
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
  if (!(error instanceof Error)) return false
  // An early child exit surfaces as a generic transport close, so attribute a recorded abnormal
  // exit instead of the closed-transport message. Clean exits and distant token pairs stay generic.
  if (
    diagnostics?.terminalReason &&
    diagnostics.exitCode !== 0 &&
    /(json-rpc|transport)[\s\S]{0,100}closed/i.test(error.message)
  ) {
    return true
  }
  return (
    diagnostics?.spawnFailed === true ||
    /Claude Code process (?:exited with code|terminated by signal|failed to spawn)|Failed to spawn Claude Code process/i.test(
      error.message
    )
  )
}

/**
 * Non-empty session-bus address check. Kept next to the failure attribution that consumes it:
 * a missing bus never blocks a launch (the native CLI runs bus-less), it only annotates an
 * actual child failure with the remediation.
 */
export function hasSessionBusAddress(env: Record<string, string | undefined>): boolean {
  const value = env.DBUS_SESSION_BUS_ADDRESS
  return typeof value === 'string' && value.trim().length > 0
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
  // The child demonstrably failed AND the launch env had no session bus: the bus is the prime
  // suspect (packaged zypak dies before JSON-RPC), so attach the remediation to the surfaced
  // error. Bus-less configs that work never see this — nothing is gated on the address.
  const remediation = diagnostics.sessionBusUnavailable
    ? `\n\n${t('agent.session.claude.linux_session_bus_unavailable')}`
    : ''
  return Object.assign(new Error(`Claude Code process ${status}${remediation}`), {
    name: 'ClaudeCodeProcessExitError',
    claudeCodeExitCategory:
      diagnostics.category ?? classifyClaudeCodeTerminalReason(diagnostics.terminalReason ?? originalError.message),
    diagnosticReference: diagnostics.reference,
    ...(diagnostics.exitCode !== undefined ? { processExitCode: diagnostics.exitCode } : {}),
    ...(diagnostics.exitSignal ? { processExitSignal: diagnostics.exitSignal } : {})
  })
}
