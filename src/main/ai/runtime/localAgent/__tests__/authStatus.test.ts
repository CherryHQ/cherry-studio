import { describe, expect, it, vi } from 'vitest'

import { CommandFailedError, executeCommand } from '@main/utils/processRunner'

import { getLocalAgentAuthStatus } from '../authStatus'
import { resolveLocalAgentCli } from '../launch'

vi.mock('../launch', () => ({ resolveLocalAgentCli: vi.fn() }))
vi.mock(import('@main/utils/processRunner'), async (original) => ({ ...(await original()), executeCommand: vi.fn() }))

const config = { protocol: 'acp' as const, presetId: 'opencode', enabled: true, args: [], env: {} }
describe('native authentication status', () => {
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
      vi.mocked(resolveLocalAgentCli).mockResolvedValue({
        executable: '/configured/cli',
        source: 'system',
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
      vi.mocked(resolveLocalAgentCli).mockResolvedValue({
        executable: '/configured/cli',
        source: 'system',
        env: {}
      })
      vi.mocked(executeCommand).mockRejectedValue(new CommandFailedError(1, stdout, stderr))
      expect(await getLocalAgentAuthStatus({ ...config, presetId, protocol: presetId })).toBe(expected)
    }
  )

  it('does not probe unsupported agents or customized arguments', async () => {
    vi.mocked(executeCommand).mockClear()
    expect(await getLocalAgentAuthStatus({ ...config, presetId: 'pi' })).toBe('unsupported')
    expect(await getLocalAgentAuthStatus({ ...config, args: ['acp', '--api-key', 'key'] })).toBe('unsupported')
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it.each([
    ['[]', 'signed-out'],
    ['[{"id":"empty","connections":[]}]', 'signed-out'],
    ['\u001b[32m[{"id":"opencode-go","connections":[{"id":"cred_1"}]}]\u001b[0m\n', 'signed-in'],
    ['not json at all', 'unknown']
  ])('reads OpenCode account status from its decorated CLI output: %s', async (output, expected) => {
    vi.mocked(resolveLocalAgentCli).mockResolvedValue({ executable: '/configured/cli', source: 'system', env: {} })
    vi.mocked(executeCommand).mockResolvedValue(output)
    expect(await getLocalAgentAuthStatus(config)).toBe(expected)
  })
})
