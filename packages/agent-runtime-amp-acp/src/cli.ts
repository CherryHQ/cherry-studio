import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const ampCli = {
  id: 'amp-acp',
  permissionMode: { approvalConfigId: 'permission', values: { default: 'default', bypass: 'bypassPermissions' } },
  terminalCli: { executable: 'amp', npmPackage: '@ampcode/cli', requiredForChat: true },
  terminalArgs: [],
  loginArgs: ['login'],
  accountProbe: {
    args: ['account', 'list', '--json'],
    parse(output, env) {
      if (env.AMP_API_KEY) return { status: 'unknown' }
      let result: unknown
      try {
        result = JSON.parse(output)
      } catch {
        return { status: 'unknown' }
      }
      if (!result || typeof result !== 'object' || !('accounts' in result) || !Array.isArray(result.accounts))
        return { status: 'unknown' }

      const accounts: unknown[] = result.accounts
      for (const account of accounts) {
        if (!account || typeof account !== 'object' || !('active' in account) || typeof account.active !== 'boolean')
          return { status: 'unknown' }
        if (account.active) {
          const id = 'userID' in account && typeof account.userID === 'string' ? account.userID : undefined
          const email = 'email' in account && typeof account.email === 'string' ? account.email : undefined
          return { status: 'signed-in', ...(id || email ? { account: { id, email } } : {}) }
        }
      }
      return { status: 'signed-out' }
    }
  },
  name: 'Amp',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'amp-acp',
  args: [],
  helpUrl: 'https://github.com/tao12345666333/amp-acp'
} as const satisfies AcpCliPreset
