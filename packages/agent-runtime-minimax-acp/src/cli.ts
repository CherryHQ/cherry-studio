import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const minimaxCli = {
  modelConfig: { target: 'minimax-config', overrides: [] },
  id: 'minimax',
  terminalArgs: [],
  permissionMode: {
    values: { ask: 'default', auto: 'auto', full_access: 'bypassPermissions' },
    labels: { ask: 'default' }
  } satisfies AcpPermissionModes,
  name: 'MiniMax Code',
  protocol: 'acp',
  executable: 'mcode',
  args: ['acp'],
  // The registry ships the code-acp launcher, whose global install does not expose mcode.
  npmPackage: '@minimax-ai/code',
  helpUrl: 'https://github.com/MiniMax-AI/minimax-code'
} as const
