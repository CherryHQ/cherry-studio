import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const clineCli = {
  modelConfig: { tool: 'cline', target: 'cline-providers', overrides: ['CLINE_DATA_DIR', 'CLINE_DIR'] },
  id: 'cline',
  terminalArgs: [],
  loginArgs: ['auth'],
  permissionMode: {
    bypassArgs: ['--acp', '--auto-approve', 'true'],
    values: { act: 'default', plan: 'plan' },
    approvalConfigId: 'auto_approve',
    legacyPlan: true
  },
  name: 'Cline',
  protocol: 'acp',
  executable: 'cline',
  args: ['--acp'],
  helpUrl: 'https://cline.bot/cli'
} as const satisfies AcpCliPreset<'cline-providers'>
