import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const zcodeCli = {
  modelConfig: { tool: 'zcode', target: 'zcode-config', overrides: ['ZCODE_HOME'] },
  id: 'zcode',
  permissionMode: {
    values: { plan: 'plan', guarded: 'default', edit: 'acceptEdits', build: 'acceptEdits', yolo: 'bypassPermissions' }
  } satisfies AcpPermissionModes,
  externalCredentialMethods: ['zcode-credentials'],
  name: 'ZCode',
  protocol: 'acp',
  executable: 'zcode-acp',
  args: ['server'],
  terminalArgs: [],
  npmPackage: 'zcode-acp-server',
  env: { ZCODE_ACP_MODE: 'build' },
  helpUrl: 'https://github.com/william0wang/zcode-acp'
} as const
