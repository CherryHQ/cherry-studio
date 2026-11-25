import { describe, expect, it, vi } from 'vitest'

import { CommandFailedError, executeCommand } from '@main/utils/processRunner'

import { getLocalAgentAuthStatus, parseCursorAuthStatus, parseOpenCodeAuthStatus } from '../authStatus'
import { resolveLocalAgentLaunch } from '../launch'

vi.mock('../launch', () => ({ resolveLocalAgentLaunch: vi.fn() }))
vi.mock(import('@main/utils/processRunner'), async (original) => ({ ...(await original()), executeCommand: vi.fn() }))

const config = { protocol: 'acp' as const, presetId: 'cursor', enabled: true, args: [], env: {} }
const explicitCursorCli = { ...config, executableOverride: '/system/cursor-agent' }

describe('native authentication status', () => {
  it.each([
    ['\u001b[32m✓\u001b[0m Logged in as user@example.com\n', 'signed-in'],
    ['Not logged in\n', 'signed-out'],
    ['Partially authenticated (missing refresh token)', 'signed-out'],
    ['✓ Login successful!\nLogged in (unable to fetch user details)', 'unknown'],
    ['Checking authentication status...', 'unknown'],
    ['Unknown command: status', 'unknown']
  ])('does not confuse account verification with generic success: %s', (output, expected) => {
    expect(parseCursorAuthStatus(output)).toBe(expected)
  })

  it('uses the resolved CLI environment and never mistakes an execution failure for signed out', async () => {
    vi.mocked(resolveLocalAgentLaunch).mockResolvedValue({
      executable: '/system/cursor-agent',
      source: 'system',
      args: ['acp'],
      env: { PATH: '/system' }
    })
    vi.mocked(executeCommand).mockResolvedValue('✓ Logged in as user@example.com')
    expect(await getLocalAgentAuthStatus({ ...explicitCursorCli, args: ['acp'] })).toBe('signed-in')
    expect(executeCommand).toHaveBeenCalledWith(
      '/system/cursor-agent',
      ['status'],
      expect.objectContaining({ env: { PATH: '/system' }, timeout: 10000, maxOutputBytes: 16384 })
    )
    vi.mocked(executeCommand).mockRejectedValue(new Error('network unavailable'))
    expect(await getLocalAgentAuthStatus(explicitCursorCli)).toBe('unknown')
  })

  it.each([
    ['codex', 'codex', ['login', 'status'], 'Logged in using ChatGPT', 'signed-in'],
    ['codex', 'codex', ['login', 'status'], 'Logged in using an API key - sk-...1234', 'signed-in'],
    ['claude', 'claude', ['auth', 'status', '--json'], '{"loggedIn":true}', 'signed-in'],
    ['claude', 'claude', ['auth', 'status', '--json'], '{"loggedIn":"false"}', 'unknown'],
    ['qoder', 'acp', ['status', '-o', 'json'], '{"logged_in":false}', 'signed-out'],
    ['qoder', 'acp', ['status', '-o', 'json'], '{"logged_in":true}', 'signed-in'],
    ['opencode', 'acp', ['auth', 'list', '--format', 'json'], '[]', 'signed-out'],
    [
      'opencode',
      'acp',
      ['auth', 'list', '--format', 'json'],
      '[{"id":"opencode-go","name":"OpenCode Go","connections":[{"type":"credential","id":"cred_1"}]}]',
      'signed-in'
    ]
  ] as const)(
    'reads %s account status from its configured CLI: %s %j %s',
    async (presetId, protocol, args, output, expected) => {
      vi.mocked(resolveLocalAgentLaunch).mockResolvedValue({
        executable: '/configured/cli',
        source: 'system',
        args: [],
        env: { PATH: '/configured' }
      })
      vi.mocked(executeCommand).mockResolvedValue(output)
      expect(await getLocalAgentAuthStatus({ ...config, presetId, protocol })).toBe(expected)
      expect(executeCommand).toHaveBeenCalledWith(
        '/configured/cli',
        args,
        expect.objectContaining({ env: { PATH: '/configured' }, ...(presetId === 'codex' && { includeStderr: true }) })
      )
    }
  )

  it.each([
    ['codex', '', 'Not logged in', 'signed-out'],
    ['codex', '', 'Unknown command', 'unknown'],
    ['codex', '', 'Logged in using ChatGPT', 'unknown'],
    ['claude', '{"loggedIn":false}', '', 'signed-out'],
    ['claude', '', 'Invalid credentials file', 'unknown']
  ] as const)(
    'recognizes only explicit signed-out results on a failed %s check',
    async (presetId, stdout, stderr, expected) => {
      vi.mocked(resolveLocalAgentLaunch).mockResolvedValue({
        executable: '/configured/cli',
        source: 'system',
        args: [],
        env: {}
      })
      vi.mocked(executeCommand).mockRejectedValue(new CommandFailedError(1, stdout, stderr))
      expect(await getLocalAgentAuthStatus({ ...config, presetId, protocol: presetId })).toBe(expected)
    }
  )

  it('does not probe unsupported agents, customized arguments or API-key authentication with an OAuth-only command', async () => {
    vi.mocked(executeCommand).mockClear()
    expect(await getLocalAgentAuthStatus({ ...config, presetId: 'pi' })).toBe('unsupported')
    expect(await getLocalAgentAuthStatus({ ...config, args: ['acp', '--api-key', 'key'] })).toBe('unsupported')
    vi.mocked(resolveLocalAgentLaunch).mockResolvedValue({
      executable: '/system/cursor-agent',
      source: 'system',
      args: ['acp'],
      env: { CURSOR_API_KEY: 'key' }
    })
    expect(await getLocalAgentAuthStatus(explicitCursorCli)).toBe('unsupported')
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it.each([
    ['[]', 'signed-out'],
    ['[{"id":"empty","connections":[]}]', 'signed-out'],
    ['\u001b[32m[{"id":"opencode-go","connections":[{"id":"cred_1"}]}]\u001b[0m\n', 'signed-in'],
    ['not json at all', 'unknown']
  ])('parses OpenCode auth list JSON status cleanly: %s', (output, expected) => {
    expect(parseOpenCodeAuthStatus(output)).toBe(expected)
  })
})
