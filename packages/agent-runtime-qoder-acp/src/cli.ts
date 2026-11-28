import type { RuntimeAccountResult } from '@cherrystudio/agent-runtime'
import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'
import { parseBooleanLoginStatus } from '@cherrystudio/agent-runtime/cli'

export const qoderCli = {
  id: 'qoder',
  accountProbe: {
    signedOutExitCode: 1,
    args: ['status', '-o', 'json'],
    parse: (output): RuntimeAccountResult => parseBooleanLoginStatus(output, 'logged_in')
  },
  loginArgs: ['login'],
  terminalArgs: [],
  name: 'Qoder CN',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'qoderclicn',
  aliases: ['qodercn'],
  npmPackage: '@qodercn-ai/qoderclicn',
  args: ['--acp'],
  permissionMode: {
    values: {
      default: 'default',
      accept_edits: 'acceptEdits',
      acceptedits: 'acceptEdits',
      auto: 'auto',
      plan: 'plan',
      bypass_permissions: 'bypassPermissions',
      bypasspermissions: 'bypassPermissions',
      yolo: 'bypassPermissions'
    }
  },
  helpUrl: 'https://docs.qoder.com/cli/acp'
} as const satisfies AcpCliPreset

export const qoderGlobalCli = {
  ...qoderCli,
  id: 'qoder-global',
  name: 'Qoder',
  executable: 'qodercli',
  aliases: ['qoder'],
  npmPackage: '@qoder-ai/qodercli'
} as const satisfies AcpCliPreset
