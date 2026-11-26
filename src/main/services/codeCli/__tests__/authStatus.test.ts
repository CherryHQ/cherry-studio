import { describe, expect, it, vi } from 'vitest'

import { CommandFailedError, executeCommand } from '@main/utils/processRunner'

import { getLocalAgentAuthStatus } from '../localAgentAuthStatus'
import { resolveLocalAgentCli } from '../localAgentCli'

vi.mock('../localAgentCli', () => ({ resolveLocalAgentCli: vi.fn() }))
vi.mock(import('@main/utils/processRunner'), async (original) => ({ ...(await original()), executeCommand: vi.fn() }))

const config = { presetId: 'opencode', enabled: true, args: [], env: {} }
describe('native authentication status', () => {
  it.each([
    ['codex', ['login', 'status'], 'Logged in using ChatGPT', 'signed-in'],
    ['codex', ['login', 'status'], 'Logged in using an API key - sk-...1234', 'signed-in'],
    ['claude', ['auth', 'status', '--json'], '{"loggedIn":true}', 'signed-in'],
    ['claude', ['auth', 'status', '--json'], '{"loggedIn":"false"}', 'unknown'],
    ['qoder', ['status', '-o', 'json'], '{"logged_in":false}', 'signed-out'],
    ['qoder', ['status', '-o', 'json'], '{"logged_in":true}', 'signed-in'],
    ['opencode', ['auth', 'list', '--format', 'json'], '[]', 'signed-out'],
    [
      'opencode',
      ['auth', 'list', '--format', 'json'],
      '[{"id":"opencode-go","name":"OpenCode Go","connections":[{"type":"credential","id":"cred_1"}]}]',
      'signed-in'
    ]
  ] as const)('reads %s account status with %j for %s', async (presetId, args, output, expected) => {
    vi.mocked(resolveLocalAgentCli).mockResolvedValue({
      executable: '/configured/cli',
      source: 'system',
      env: { PATH: '/configured' }
    })
    vi.mocked(executeCommand).mockResolvedValue(output)
    expect(await getLocalAgentAuthStatus({ ...config, presetId })).toBe(expected)
    expect(executeCommand).toHaveBeenCalledWith(
      '/configured/cli',
      args,
      expect.objectContaining({ env: { PATH: '/configured' }, ...(presetId === 'codex' && { includeStderr: true }) })
    )
  })

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
      expect(await getLocalAgentAuthStatus({ ...config, presetId })).toBe(expected)
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
