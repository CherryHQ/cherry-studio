import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const kimiCli = {
  nativeCliInstall: true,
  modelConfig: { target: 'kimi-config', overrides: ['KIMI_CODE_HOME'] },
  id: 'kimi',
  permissionMode: {
    values: { default: 'default', plan: 'plan', auto: 'auto', yolo: 'bypassPermissions' }
  },
  account: { canReadAccount: true },
  externalCredentialMethods: ['login'],
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
  subscriptionUsage: true,
  executable: 'kimi',
  args: ['acp'],
  helpUrl: 'https://moonshotai.github.io/kimi-code/'
} as const satisfies AcpCliPreset<'kimi-config'>
