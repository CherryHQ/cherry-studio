import { parseBooleanLoginStatus, type CliAccountProbe } from '@cherrystudio/agent-runtime/cli'

export const qoderCli = {
  id: 'qoder',
  accountProbe: {
    signedOutExitCode: 1,
    args: ['status', '-o', 'json'],
    parse: (output) => parseBooleanLoginStatus(output, 'logged_in')
  } satisfies CliAccountProbe,
  loginArgs: ['login'],
  terminalArgs: [],
  name: 'Qoder CN',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'qoderclicn',
  aliases: ['qodercn'],
  npmPackage: '@qodercn-ai/qoderclicn',
  args: ['--acp'],
  helpUrl: 'https://docs.qoder.com/cli/acp'
} as const

export const qoderGlobalCli = {
  ...qoderCli,
  id: 'qoder-global',
  name: 'Qoder',
  executable: 'qodercli',
  aliases: ['qoder'],
  npmPackage: '@qoder-ai/qodercli'
} as const
