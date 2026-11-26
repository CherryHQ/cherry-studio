export const museCodeCli = {
  id: 'muse-code',
  name: 'Muse Code',
  protocol: 'acp',
  executable: 'muse',
  args: ['acp'],
  env: { MUSE_EXPERIMENTAL_ACP: 'on' },
  terminalArgs: [],
  loginArgs: ['login'],
  credentialEnvironment: ['META_API_KEY'],
  helpUrl: 'https://dev.meta.ai/docs/muse-code'
} as const
