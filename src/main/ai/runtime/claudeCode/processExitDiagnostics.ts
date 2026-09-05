import { randomUUID } from 'node:crypto'

import type { ClaudeCodeExitCategory } from '@shared/types/error'

export interface ClaudeCodeProcessDiagnostics {
  readonly reference: string
  terminalReason?: string
  category?: ClaudeCodeExitCategory
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

export function classifyClaudeCodeTerminalReason(reason: string): ClaudeCodeExitCategory {
  const text = reason.toLowerCase()
  if (/\b401\b|unauthori[sz]ed|authentication|invalid[_ ]api[_ ]key|not logged in/.test(text)) return 'auth'
  if (/\b404\b|model.{0,80}(?:not found|does not exist|unavailable|no access)/.test(text)) return 'model'
  if (/\b402\b|quota|billing|insufficient (?:balance|credit)|payment required/.test(text)) return 'quota'
  if (/\b403\b|forbidden|permission denied|access denied/.test(text)) return 'permission'
  if (/\b429\b|rate[_ -]?limit|too many requests/.test(text)) return 'rate_limit'
  if (/mcp (?:server|connection|transport|client|error|timeout)|\bmcp_/.test(text)) return 'mcp'
  if (/proxy|socks|certificate|self-signed|unable_to_verify_leaf_signature/.test(text)) return 'proxy'
  if (/econnrefused|etimedout|enotfound|network|fetch failed|connection (?:reset|timed out)/.test(text)) {
    return 'network'
  }
  if (/\b5\d\d\b|overload|service unavailable|internal server error/.test(text)) return 'server'
  return 'unknown'
}

export function recordClaudeCodeProcessExit(
  diagnostics: ClaudeCodeProcessDiagnostics,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrTail: string
): void {
  const status = code !== null ? `exited with code ${code}` : `terminated by signal ${String(signal)}`
  diagnostics.terminalReason = `Claude Code process ${status}${stderrTail.trim() ? `. stderr: ${stderrTail.trim()}` : ''}`
  diagnostics.category = classifyClaudeCodeTerminalReason(diagnostics.terminalReason)
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
  return Object.assign(new Error(`Claude Code process ${status}`), {
    name: 'ClaudeCodeProcessExitError',
    claudeCodeExitCategory:
      diagnostics.category ?? classifyClaudeCodeTerminalReason(diagnostics.terminalReason ?? originalError.message),
    diagnosticReference: diagnostics.reference,
    ...(diagnostics.exitCode !== undefined ? { processExitCode: diagnostics.exitCode } : {}),
    ...(diagnostics.exitSignal ? { processExitSignal: diagnostics.exitSignal } : {})
  })
}
