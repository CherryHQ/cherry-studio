export const ampCli = {
  id: 'amp-acp',
  permissionMode: { values: { default: 'default', bypass: 'bypassPermissions' } },
  terminalCli: { executable: 'amp', npmPackage: '@ampcode/cli', requiredForChat: true },
  terminalArgs: [],
  loginArgs: ['login'],
  name: 'Amp',
  protocol: 'acp',
  executable: 'amp-acp',
  args: [],
  helpUrl: 'https://github.com/tao12345666333/amp-acp'
} as const
