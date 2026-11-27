import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const qwenCli = {
  modelConfig: { target: 'qwen-settings', overrides: [] },
  id: 'qwen',
  permissionMode: {
    values: { default: 'default', plan: 'plan', 'auto-edit': 'acceptEdits', auto: 'auto', yolo: 'bypassPermissions' }
  },
  externalCredentialMethods: ['openai'],
  terminalArgs: [],
  loginArgs: [],
  registryId: 'qwen-code',
  name: 'Qwen Code',
  protocol: 'acp',
  executable: 'qwen',
  args: ['--acp'],
  helpUrl: 'https://qwenlm.github.io/qwen-code-docs/'
} as const satisfies AcpCliPreset<'qwen-settings'>
