export const qwenCli = {
  modelConfig: { target: 'qwen-settings', overrides: [] },
  id: 'qwen',
  externalCredentialMethods: ['openai'],
  terminalArgs: [],
  registryId: 'qwen-code',
  name: 'Qwen Code',
  protocol: 'acp',
  executable: 'qwen',
  args: ['--acp'],
  helpUrl: 'https://qwenlm.github.io/qwen-code-docs/'
} as const
