export const zcodeCli = {
  modelConfig: { tool: 'zcode', target: 'zcode-config', overrides: ['ZCODE_HOME'] },
  id: 'zcode',
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
