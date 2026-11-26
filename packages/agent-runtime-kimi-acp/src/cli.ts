export const kimiCli = {
  modelConfig: { target: 'kimi-config', overrides: ['KIMI_CODE_HOME'] },
  id: 'kimi',
  windowsShell: { variable: 'KIMI_SHELL_PATH', allowSh: true },
  cliLogin: [
    {
      id: 'kimi-cn',
      args: ['login', '--region', 'mainland-cn'],
      autoOpenUrl: true,
      nameKey: 'local_agents.auth_kimi_cn',
      hintKey: 'local_agents.auth_kimi_cn_hint',
      kind: 'browser'
    },
    {
      id: 'kimi-global',
      args: ['login', '--region', 'global'],
      autoOpenUrl: true,
      nameKey: 'local_agents.auth_kimi_global',
      hintKey: 'local_agents.auth_kimi_global_hint',
      kind: 'browser'
    }
  ],
  loginArgs: ['login'],
  terminalArgs: [],
  name: 'Kimi',
  protocol: 'acp',
  executable: 'kimi',
  args: ['acp'],
  helpUrl: 'https://moonshotai.github.io/kimi-code/'
} as const
