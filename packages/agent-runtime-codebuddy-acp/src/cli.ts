export const codeBuddyCli = {
  id: 'codebuddy-code',
  modelEndpoints: ['openai-chat-completions', 'openai-responses'],
  terminalArgs: [],
  modelConfig: { tool: 'codebuddy-code', target: 'codebuddy-settings', overrides: ['CODEBUDDY_MODEL'] },
  name: 'Codebuddy Code',
  protocol: 'acp',
  executable: 'codebuddy',
  npmPackage: '@tencent-ai/codebuddy-code',
  aliases: ['codebuddy-code', 'cbc'],
  args: ['--acp'],
  helpUrl: 'https://www.codebuddy.cn/cli/'
} as const
