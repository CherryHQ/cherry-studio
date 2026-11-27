import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const gooseCli = {
  id: 'goose',
  credentialScope: 'provider',
  permissionMode: {
    values: { auto: 'bypassPermissions', approve: 'default', smart_approve: 'auto' },
    labels: { auto: 'bypassPermissions' }
  },
  modelEndpoints: ['anthropic-messages', 'openai-responses', 'openai-chat-completions'],
  terminalArgs: ['session'],
  modelConfig: {
    tool: 'goose',
    target: 'goose-config',
    overrides: (platform: string) => (platform === 'win32' ? ['GOOSE_PATH_ROOT', 'APPDATA'] : ['GOOSE_PATH_ROOT'])
  },
  name: 'goose',
  protocol: 'acp',
  executable: 'goose',
  args: ['acp'],
  helpUrl: 'https://block.github.io/goose/'
} as const satisfies AcpCliPreset<'goose-config'>
