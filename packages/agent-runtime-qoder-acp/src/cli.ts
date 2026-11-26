import { parseBooleanLoginStatus, type CliAuthStatusProbe } from '@cherrystudio/agent-runtime/cli'

export const qoderCli = {
  id: 'qoder',
  authStatus: {
    args: ['status', '-o', 'json'],
    parse: (output) => parseBooleanLoginStatus(output, 'logged_in')
  } satisfies CliAuthStatusProbe,
  loginArgs: ['login'],
  terminalArgs: [],
  name: 'Qoder',
  protocol: 'acp',
  executable: 'qoderclicn',
  aliases: ['qoder', 'qodercli'],
  args: ['--acp'],
  helpUrl: 'https://docs.qoder.com/cli/acp'
} as const
