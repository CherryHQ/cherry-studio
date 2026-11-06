import { describe, expect, it, vi } from 'vitest'

import { serializeError } from '../../../utils/serializeError'

vi.mock('@main/i18n', () => ({
  t: (key: string) =>
    key === 'agent.session.claude.linux_session_bus_unavailable'
      ? 'Claude Code cannot start on Linux without a desktop session bus (DBUS_SESSION_BUS_ADDRESS is missing). Open Cherry Studio from your desktop session so the bus address is inherited, then try again.'
      : key
}))

const {
  createClaudeCodeProcessDiagnostics,
  createClaudeCodeProcessExitError,
  hasSessionBusAddress,
  isClaudeCodeProcessFailure,
  recordClaudeCodeProcessExit,
  resetClaudeCodeProcessDiagnostics
} = await import('../processExitDiagnostics')

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
    ['MCP server connection failed', 'mcp'],
    // Geo-blocks and oversized prompts also ship as bare 4xx; the shared ladder's precedence
    // is what keeps them out of the permission / unknown buckets.
    ['API Error: 403 {"error":{"message":"unsupported_country_region_territory"}}', 'region'],
    ['API Error: 400 prompt is too long: 210000 tokens > 200000 maximum', 'context_length']
  ] as const)('maps %s to the %s recovery category', (terminalReason, category) => {
    const diagnostics = createClaudeCodeProcessDiagnostics('known-ref')
    diagnostics.terminalReason = terminalReason
    diagnostics.exitCode = 1

    const serialized = serializeError(createClaudeCodeProcessExitError(new Error('process exited'), diagnostics))

    expect(serialized.claudeCodeExitCategory).toBe(category)
    expect(serialized.diagnosticReference).toBe('known-ref')
  })

  it('preserves runtime connection recovery without exposing private stderr', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('connection-ref')
    const stderr =
      'API Error: Unable to connect to API (ConnectionRefused); api_key=sk-ant-private https://private.example/internal'

    recordClaudeCodeProcessExit(diagnostics, 1, null, stderr)

    const serialized = serializeError(createClaudeCodeProcessExitError(new Error('process exited'), diagnostics))
    const rendererPayload = JSON.stringify(serialized)

    expect(serialized).toMatchObject({
      message: 'Claude Code process exited with code 1',
      claudeCodeExitCategory: 'network',
      diagnosticReference: 'connection-ref',
      processExitCode: 1
    })
    expect(rendererPayload).not.toContain('sk-ant-private')
    expect(rendererPayload).not.toContain('https://private.example/internal')
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

  it('does not classify a process exit code as an HTTP status', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('exit-code-ref')

    recordClaudeCodeProcessExit(diagnostics, 429, null, 'unexpected CLI termination')

    expect(diagnostics.category).toBe('unknown')
    expect(diagnostics.terminalReason).toContain('exited with code 429')
  })

  it('clears a prior process result before a resume recovery spawns again', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('retry-ref')
    Object.assign(diagnostics, {
      terminalReason: 'first process failed',
      category: 'auth',
      exitCode: 1,
      spawnFailed: true
    })

    resetClaudeCodeProcessDiagnostics(diagnostics)

    expect(diagnostics).toEqual({ reference: 'retry-ref' })
  })

  it('treats a closed transport after a recorded exit as a process failure', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('zypak-ref')
    recordClaudeCodeProcessExit(diagnostics, 1, null, 'zypak-helper failed to connect to the session bus')

    expect(isClaudeCodeProcessFailure(new Error('TransportClosedError: JSON-RPC input closed'), diagnostics)).toBe(true)
  })

  it('leaves a closed transport without a recorded exit as a generic error', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('no-exit-ref')

    expect(isClaudeCodeProcessFailure(new Error('TransportClosedError: JSON-RPC input closed'), diagnostics)).toBe(
      false
    )
  })

  it('leaves a transport close after a clean exit as a generic error', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('clean-exit-ref')
    recordClaudeCodeProcessExit(diagnostics, 0, null, '')

    expect(isClaudeCodeProcessFailure(new Error('TransportClosedError: JSON-RPC input closed'), diagnostics)).toBe(
      false
    )
  })

  it('attaches the session-bus remediation when a bus-less child actually fails', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('bus-ref')
    diagnostics.sessionBusUnavailable = true
    recordClaudeCodeProcessExit(diagnostics, 1, null, 'zypak-helper failed to connect to the session bus')

    const surfaced = createClaudeCodeProcessExitError(
      new Error('TransportClosedError: JSON-RPC input closed'),
      diagnostics
    )

    expect(surfaced.message).toContain('Claude Code process exited with code 1')
    expect(surfaced.message).toContain('DBUS_SESSION_BUS_ADDRESS')
  })

  it('keeps the bare exit message when the launch env provided a session bus', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('bus-ok-ref')
    recordClaudeCodeProcessExit(diagnostics, 1, null, 'segfault')

    const surfaced = createClaudeCodeProcessExitError(
      new Error('TransportClosedError: JSON-RPC input closed'),
      diagnostics
    )

    expect(surfaced.message).toBe('Claude Code process exited with code 1')
  })

  it('clears the bus fact with the rest of the process result before a respawn', () => {
    const diagnostics = createClaudeCodeProcessDiagnostics('bus-retry-ref')
    diagnostics.sessionBusUnavailable = true

    resetClaudeCodeProcessDiagnostics(diagnostics)

    expect(diagnostics).toEqual({ reference: 'bus-retry-ref' })
  })

  it('treats absent, empty and whitespace-only bus addresses as unavailable', () => {
    expect(hasSessionBusAddress({})).toBe(false)
    expect(hasSessionBusAddress({ DBUS_SESSION_BUS_ADDRESS: undefined })).toBe(false)
    expect(hasSessionBusAddress({ DBUS_SESSION_BUS_ADDRESS: '' })).toBe(false)
    expect(hasSessionBusAddress({ DBUS_SESSION_BUS_ADDRESS: ' ' })).toBe(false)
    expect(hasSessionBusAddress({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' })).toBe(true)
  })
})
