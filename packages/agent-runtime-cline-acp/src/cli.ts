import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const clineCli = {
  modelConfig: { tool: 'cline', target: 'cline-providers', overrides: ['CLINE_DATA_DIR', 'CLINE_DIR'] },
  id: 'cline',
  terminalArgs: [],
  loginArgs: ['auth'],
  permissionMode: { values: { act: 'default', plan: 'plan' } } satisfies AcpPermissionModes,
  name: 'Cline',
  protocol: 'acp',
  executable: 'cline',
  args: ['--acp'],
  helpUrl: 'https://cline.bot/cli'
} as const
