import type { CliAccountProbe, CliInstaller } from '@cherrystudio/agent-runtime/cli'

export const kiroCli = {
  id: 'kiro',
  account: { methods: [] },
  loginArgs: ['login'],
  accountProbe: {
    args: ['whoami', '--format', 'json'],
    signedOutExitCode: 1,
    parse(output) {
      try {
        const reply: unknown = JSON.parse(output.trimStart().split('\n', 1)[0] ?? '')
        if (!reply || typeof reply !== 'object') return { status: 'unknown' }
        if ('account' in reply && reply.account === null) return { status: 'signed-out' }
        const account = 'account' in reply ? reply.account : reply
        if (!account || typeof account !== 'object' || Array.isArray(account)) return { status: 'unknown' }
        if (
          account === reply &&
          (!('accountType' in reply) || typeof reply.accountType !== 'string' || !reply.accountType)
        )
          return { status: 'unknown' }
        const email = 'email' in account && typeof account.email === 'string' ? account.email : undefined
        return { status: 'signed-in', ...(email ? { account: { email } } : {}) }
      } catch {
        return { status: 'unknown' }
      }
    }
  } satisfies CliAccountProbe,
  terminalArgs: ['chat'],
  name: 'Kiro',
  protocol: 'acp',
  executable: 'kiro-cli',
  args: ['acp'],
  helpUrl: 'https://kiro.dev/docs/cli/acp/'
} as const

export const kiroInstaller = {
  executable: kiroCli.executable,
  script(platform) {
    if (platform !== 'darwin' && platform !== 'linux') return undefined
    return {
      manager: 'script',
      command: 'bash',
      args: ['-o', 'pipefail', '-c', 'curl -fsSL https://cli.kiro.dev/install | bash']
    }
  },
  removal: { kind: 'file', identity: /\bkiro-cli\b/i }
} satisfies CliInstaller
