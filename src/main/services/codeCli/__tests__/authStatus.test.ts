import { describe, expect, it, vi } from 'vitest'

import { CommandFailedError, executeCommand } from '@main/utils/processRunner'

import { readCliAccount } from '../localAgentAuthStatus'
import { resolveLocalAgentCli } from '../localAgentCli'

vi.mock('../localAgentCli', () => ({ resolveLocalAgentCli: vi.fn() }))
vi.mock(import('@main/utils/processRunner'), async (original) => ({ ...(await original()), executeCommand: vi.fn() }))

const config = { presetId: 'opencode', enabled: true, args: [], env: {} }
describe('native authentication status', () => {
  it.each([
    ['claude', ['auth', 'status', '--json'], '{"loggedIn":true}', 'signed-in'],
    ['claude', ['auth', 'status', '--json'], '{"loggedIn":"false"}', 'unknown'],
    ['qoder', ['status', '-o', 'json'], '{"logged_in":false}', 'signed-out'],
    ['qoder', ['status', '-o', 'json'], '{"logged_in":true}', 'signed-in'],
    ['command-code', ['status', '--json'], '{"authenticated":true}', 'signed-in'],
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
    expect(await readCliAccount({ ...config, presetId })).toEqual({ status: expected })
    expect(executeCommand).toHaveBeenCalledWith(
      '/configured/cli',
      args,
      expect.objectContaining({ env: { PATH: '/configured' } })
    )
  })

  it.each([
    ['claude', '{"loggedIn":false}', '', 'signed-out'],
    ['claude', '', 'Invalid credentials file', 'unknown'],
    ['trae', '', 'Not logged in', 'signed-out'],
    ['kiro', '{"account":null}', '', 'signed-out'],
    ['command-code', '{"authenticated":false}', '', 'signed-out']
  ] as const)(
    'recognizes only explicit signed-out results on a failed %s check',
    async (presetId, stdout, stderr, expected) => {
      vi.mocked(resolveLocalAgentCli).mockResolvedValue({
        executable: '/configured/cli',
        source: 'system',
        env: {}
      })
      vi.mocked(executeCommand).mockRejectedValue(new CommandFailedError(1, stdout, stderr))
      expect(await readCliAccount({ ...config, presetId })).toEqual({ status: expected })
    }
  )

  it('does not probe unsupported agents or customized arguments', async () => {
    vi.mocked(executeCommand).mockClear()
    expect(await readCliAccount({ ...config, presetId: 'pi' })).toEqual({ status: 'unsupported' })
    expect(await readCliAccount({ ...config, args: ['acp', '--api-key', 'key'] })).toEqual({ status: 'unsupported' })
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it.each<{ output: string; env: Record<string, string>; expected: string }>([
    { output: '{"accounts":[{"active":false},{"active":true}]}', env: {}, expected: 'signed-in' },
    { output: '{"accounts":[{"active":false}]}', env: {}, expected: 'signed-out' },
    { output: '{"accounts":[]}', env: {}, expected: 'signed-out' },
    { output: '{"accounts":[{"active":"true"}]}', env: {}, expected: 'unknown' },
    { output: '{"accounts":[{"active":true}]}', env: { AMP_API_KEY: 'configured-key' }, expected: 'unknown' }
  ])('reads Amp status for the active account ($expected)', async ({ output, env, expected }) => {
    vi.mocked(resolveLocalAgentCli).mockResolvedValue({ executable: '/configured/amp', source: 'system', env })
    vi.mocked(executeCommand).mockResolvedValue(output)
    expect(await readCliAccount({ ...config, presetId: 'amp-acp' })).toEqual({ status: expected })
  })

  it.each([
    [
      'amp-acp',
      '{"accounts":[{"active":false,"email":"inactive@example.test"},{"active":true,"userID":"amp-user","email":"active@example.test","token":"private"}]}',
      { id: 'amp-user', email: 'active@example.test' }
    ],
    [
      'claude',
      '{"loggedIn":true,"email":"active@example.test","orgId":"org-id","orgName":"Example Team","token":"private"}',
      { email: 'active@example.test', workspace: { id: 'org-id', name: 'Example Team' } }
    ],
    [
      'kiro',
      '{"accountType":"IdentityCenter","provider":"test","email":"kiro@example.test"}\nProfile:\nDefault',
      { email: 'kiro@example.test' }
    ],
    [
      'codebuddy-code',
      '{"type":"control_response","response":{"request_id":"cherry-account","subtype":"success","response":{"account":{"nickname":"Example User","token":"private"}}}}',
      { displayName: 'Example User' }
    ]
  ] as const)('returns only the active %s account identity', async (presetId, output, account) => {
    vi.mocked(resolveLocalAgentCli).mockResolvedValue({ executable: '/configured/cli', source: 'system', env: {} })
    vi.mocked(executeCommand).mockResolvedValue(output)
    expect(await readCliAccount({ ...config, presetId })).toEqual({ status: 'signed-in', account })
  })

  it.each([
    ['[]', 'signed-out'],
    ['[{"id":"empty","connections":[]}]', 'signed-out'],
    ['\u001b[32m[{"id":"opencode-go","connections":[{"id":"cred_1"}]}]\u001b[0m\n', 'signed-in'],
    ['not json at all', 'unknown']
  ])('reads OpenCode account status from its decorated CLI output: %s', async (output, expected) => {
    vi.mocked(resolveLocalAgentCli).mockResolvedValue({ executable: '/configured/cli', source: 'system', env: {} })
    vi.mocked(executeCommand).mockResolvedValue(output)
    expect(await readCliAccount(config)).toEqual({ status: expected })
  })
})
