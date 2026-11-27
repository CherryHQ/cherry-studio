import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'
import type { CliAccountProbe } from '@cherrystudio/agent-runtime/cli'

export const openCodeCli = {
  modelConfig: {
    target: 'opencode-config',
    overrides: ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT']
  },
  id: 'opencode',
  permissionMode: { values: { build: 'default', plan: 'plan' } } satisfies AcpPermissionModes,
  cliLogin: [
    {
      id: 'opencode-console',
      args: ['auth', 'login', 'opencode', '--method', 'device'],
      autoOpenUrl: true,
      nameKey: 'local_agents.auth_opencode_console',
      hintKey: 'local_agents.auth_opencode_console_hint',
      kind: 'browser'
    },
    {
      id: 'opencode-openai',
      args: ['auth', 'login', 'openai', '--method', 'chatgpt-browser'],
      autoOpenUrl: true,
      nameKey: 'local_agents.auth_opencode_openai',
      hintKey: 'local_agents.auth_opencode_openai_hint',
      kind: 'browser'
    },
    {
      id: 'opencode-copilot',
      args: ['auth', 'login', 'github-copilot', '--method', 'device'],
      autoOpenUrl: true,
      nameKey: 'local_agents.auth_opencode_copilot',
      hintKey: 'local_agents.auth_opencode_copilot_hint',
      kind: 'browser'
    }
  ],
  accountProbe: {
    signedOutExitCode: 1,
    args: ['auth', 'list', '--format', 'json'],
    parse(output) {
      try {
        const parsed: unknown = JSON.parse(output.trim())
        if (!Array.isArray(parsed)) return { status: 'unknown' }
        const hasConnection = parsed.some((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return false
          const connections: unknown = Reflect.get(entry, 'connections')
          return Array.isArray(connections) ? connections.length > 0 : true
        })
        return { status: hasConnection ? 'signed-in' : 'signed-out' }
      } catch {
        return { status: 'unknown' }
      }
    }
  } satisfies CliAccountProbe,
  loginArgs: ['auth', 'login'],
  externalCredentialMethods: ['opencode-login'],
  terminalArgs: [],
  name: 'OpenCode',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'opencode',
  args: ['acp'],
  helpUrl: 'https://opencode.ai/docs/acp/'
} as const
