import { describe, expect, it } from 'vitest'

import { serializeError } from '../../../utils/serializeError'
import {
  createClaudeCodeProcessDiagnostics,
  createClaudeCodeProcessExitError,
  resetClaudeCodeProcessDiagnostics
} from '../processExitDiagnostics'

describe('Claude Code process exit diagnostics', () => {
  it.each([
    ['Authentication failed', 'auth'],
    ['model claude-sonnet-4 was not found', 'model'],
    ['HTTP 402 billing quota exhausted', 'quota'],
    ['HTTP 403 forbidden', 'permission'],
    ['HTTP 429 rate limit exceeded', 'rate_limit'],
    ['connect ETIMEDOUT api.anthropic.com', 'network'],
    ['proxy certificate verification failed', 'proxy'],
    ['HTTP 503 service overloaded', 'server'],
    ['MCP server connection failed', 'mcp']
  ] as const)('maps %s to the %s recovery category', (terminalReason, category) => {
    const diagnostics = createClaudeCodeProcessDiagnostics('known-ref')
    diagnostics.terminalReason = terminalReason
    diagnostics.exitCode = 1

    const serialized = serializeError(createClaudeCodeProcessExitError(new Error('process exited'), diagnostics))

    expect(serialized.claudeCodeExitCategory).toBe(category)
    expect(serialized.diagnosticReference).toBe('known-ref')
  })

  it('keeps an unknown raw terminal reason out of the renderer payload', () => {
    const raw = 'unexpected failure at /Users/alice/private; api_key=sk-ant-private'
    const diagnostics = createClaudeCodeProcessDiagnostics('unknown-ref')
    diagnostics.terminalReason = raw
    diagnostics.exitCode = 1

    const serialized = serializeError(createClaudeCodeProcessExitError(new Error('process exited'), diagnostics))
    const rendererPayload = JSON.stringify(serialized)

    expect(serialized).toMatchObject({
      claudeCodeExitCategory: 'unknown',
      diagnosticReference: 'unknown-ref',
      processExitCode: 1
    })
    expect(rendererPayload).not.toContain(raw)
    expect(rendererPayload).not.toContain('sk-ant-private')
    expect(rendererPayload).not.toContain('/Users/alice/private')
    expect(diagnostics.terminalReason).toBe(raw)
  })

  it('clears a prior process result before a resume recovery spawns again', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('retry-ref')
    Object.assign(diagnostics, {
      terminalReason: 'first process failed',
      category: 'auth',
      exitCode: 1
    })

    resetClaudeCodeProcessDiagnostics(diagnostics)

    expect(diagnostics).toEqual({ reference: 'retry-ref' })
  })
})
