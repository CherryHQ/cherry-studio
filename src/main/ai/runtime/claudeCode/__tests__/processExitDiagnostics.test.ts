import { describe, expect, it } from 'vitest'

import { serializeError } from '../../../utils/serializeError'
import {
  canSalvageClaudeOutput,
  createClaudeCodeProcessDiagnostics,
  createClaudeCodeProcessExitError,
  recordClaudeCodeProcessExit,
  resetClaudeCodeProcessDiagnostics
} from '../processExitDiagnostics'

describe('Claude Code process exit diagnostics', () => {
  it('keeps interrupted partial output without hiding unrelated failures', () => {
    expect(canSalvageClaudeOutput(new Error('interrupted'), 0, true)).toBe(true)
    expect(canSalvageClaudeOutput(new SyntaxError('Unterminated string in JSON'), 1024, false)).toBe(true)
    expect(canSalvageClaudeOutput(new SyntaxError('Unexpected end of JSON input'), 12, false)).toBe(false)
    expect(canSalvageClaudeOutput(new Error('Authentication failed'), 4096, false)).toBe(false)
    expect(canSalvageClaudeOutput(new SyntaxError('Unexpected token'), 4096, false)).toBe(false)
  })

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
})

it('projects actual stderr through serialization with credentials, paths and URLs removed', () => {
  const diagnostics = createClaudeCodeProcessDiagnostics('safe-ref')
  recordClaudeCodeProcessExit(
    diagnostics,
    1,
    null,
    'native loader failed\napi_key=sk-ant-private\nhttps://user:password@private.example/path?token=private\n/Users/alice/private/file\nC:\\Users\\alice\\private\\file'
  )
  const serialized = serializeError(createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics))
  expect(serialized.processExitDetail).toContain('native loader failed')
  expect(JSON.stringify(serialized)).not.toMatch(/sk-ant-private|private\.example|alice|password@|token=private/)
})

it('does not invent a D-Bus cause for an unrelated recorded failure', () => {
  const diagnostics = createClaudeCodeProcessDiagnostics('no-cause')
  recordClaudeCodeProcessExit(diagnostics, 1, null, 'native library missing')
  const error = createClaudeCodeProcessExitError(new Error('transport closed'), diagnostics)
  expect(JSON.stringify(serializeError(error))).not.toMatch(/DBUS|session.bus/i)
})

it.each([
  '/Users/alice/Secret Project/client.env',
  'C:\\Users\\alice\\Secret Project\\client.env',
  'C:/Users/alice/Secret Project/client.env',
  '\\\\private-server\\Secret Project\\client.env',
  '"/Users/alice/Secret Project/client.env"',
  "'/Users/alice/Secret Project/client.env'"
])('redacts the complete private suffix of a path containing spaces: %s', (path) => {
  const diagnostics = createClaudeCodeProcessDiagnostics('space-path-ref')
  recordClaudeCodeProcessExit(diagnostics, 1, null, `loader failed at ${path}\nretry unavailable`)
  const serialized = serializeError(createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics))
  expect(serialized.processExitDetail).toContain('loader failed at ')
  expect(serialized.processExitDetail).toContain('<redacted-path>')
  expect(serialized.processExitDetail).toContain('retry unavailable')
  expect(JSON.stringify(serialized)).not.toMatch(/alice|Secret|Project|client\.env|private-server/)
})

it('strips ANSI color sequences before displaying process output', () => {
  const diagnostics = createClaudeCodeProcessDiagnostics('ansi-ref')
  recordClaudeCodeProcessExit(diagnostics, 1, null, '\u001b[31mloader failed\u001b[0m')
  const serialized = serializeError(createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics))
  expect(serialized.processExitDetail).toBe('loader failed')
})

it.each([
  'I/O error while reading',
  'HTTP/1.1 500 Internal Server Error',
  'failed 1/2 times',
  'n/a for this run',
  'and/or',
  '24/7',
  'km/h'
])('preserves a non-path slash in diagnostic text: %s', (output) => {
  const diagnostics = createClaudeCodeProcessDiagnostics('non-path-ref')
  recordClaudeCodeProcessExit(diagnostics, 1, null, output)
  expect(serializeError(createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics)).processExitDetail).toBe(
    output
  )
})

it.each(['', 'at ', '=', '(', ':', '"', "'", '[', '{', ',', ';'])(
  'redacts a Unix space path after a token delimiter: %s',
  (prefix) => {
    const diagnostics = createClaudeCodeProcessDiagnostics('delimiter-ref')
    recordClaudeCodeProcessExit(diagnostics, 1, null, `${prefix}/Users/alice/Secret Project/client.env`)
    expect(
      serializeError(createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics)).processExitDetail
    ).not.toMatch(/alice|Secret|Project|client/)
  }
)

it.each([
  '~/Secret/client.env',
  '/Users/alice/Secret\\ Project/client.env',
  '//private-server/share Secret/file',
  '/Users/alice/Secret\tProject/client.env',
  '/Users/ali\u001b[0mce/secret.env'
])('redacts adversarial absolute paths: %s', (path) => {
  const diagnostics = createClaudeCodeProcessDiagnostics('adversarial-ref')
  recordClaudeCodeProcessExit(diagnostics, 1, null, `fail at ${path} done`)
  const detail = serializeError(
    createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics)
  ).processExitDetail
  expect(detail).not.toMatch(/alice|Secret|Project|client|private-server|secret.env/)
})

it.each([
  '/a'.repeat(100_000),
  '/start ' + 'x '.repeat(100_000),
  'z'.repeat(200_000),
  '/' + 'a'.repeat(200_000),
  '\u001b[31m'.repeat(20_000) + 'end',
  'ok /p q r\n'.repeat(20_000)
])('bounds long diagnostic output and processing time', (output) => {
  const diagnostics = createClaudeCodeProcessDiagnostics('perf-ref')
  const start = performance.now()
  recordClaudeCodeProcessExit(diagnostics, 1, null, output)
  const detail = serializeError(
    createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics)
  ).processExitDetail
  expect(detail.length).toBeLessThanOrEqual(1000)
  expect(performance.now() - start).toBeLessThan(500)
})

it.each([
  'failed to load `/Users/alice/Secret Project/client.env`',
  'see </Users/alice/Secret Project/x>',
  'err)/Users/alice/Secret Project/x',
  '{"path":"/Users/alice/Secret Project/client.env"}',
  'at run (/Users/alice/Secret Project/client.ts:123:4)'
])('redacts paths in diagnostic wrappers: %s', (output) => {
  const diagnostics = createClaudeCodeProcessDiagnostics('wrapped-ref')
  recordClaudeCodeProcessExit(diagnostics, 1, null, output)
  const detail = serializeError(
    createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics)
  ).processExitDetail
  expect(detail).not.toMatch(/alice|Secret|Project|client/)
})

it.each(['2 / 3', 'yes / no'])('conservatively redacts a spaced slash: %s', (output) => {
  const diagnostics = createClaudeCodeProcessDiagnostics('ambiguous-ref')
  recordClaudeCodeProcessExit(diagnostics, 1, null, output)
  const detail = serializeError(
    createClaudeCodeProcessExitError(new Error('SDK closed'), diagnostics)
  ).processExitDetail
  expect(detail).toMatch(/<redacted-path>$/)
})
