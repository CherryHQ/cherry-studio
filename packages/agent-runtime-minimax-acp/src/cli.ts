export const minimaxCli = {
  modelConfig: { target: 'minimax-config', overrides: [] },
  id: 'minimax',
  terminalArgs: [],
  permissionMode: { labels: { ask: { canonicalMode: 'default', priority: 1 } } },
  name: 'MiniMax Code',
  protocol: 'acp',
  executable: 'mcode',
  args: ['acp'],
  // The registry ships the code-acp launcher, whose global install does not expose mcode.
  npmPackage: '@minimax-ai/code',
  helpUrl: 'https://github.com/MiniMax-AI/minimax-code'
} as const
