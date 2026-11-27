import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const dimcodeCli = {
  id: 'dimagent',
  name: 'DimAgent',
  protocol: 'acp',
  executable: 'dim',
  aliases: ['dimcode'],
  npmPackage: 'dimcode',
  args: ['acp'],
  terminalArgs: [],
  loginArgs: ['auth', 'login'],
  helpUrl: 'https://dimagent.cn/docs/acp'
} as const satisfies AcpCliPreset
