import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const poolsideEnvironmentKeys = {
  apiKey: 'POOLSIDE_API_KEY',
  baseUrl: 'POOLSIDE_STANDALONE_BASE_URL',
  model: 'POOLSIDE_STANDALONE_MODEL'
} as const

export const poolsideCli = {
  id: 'poolside',
  modelEndpoints: ['openai-chat-completions'],
  terminalArgs: [],
  loginArgs: ['login'],
  modelConfig: { tool: 'poolside', target: 'poolside-settings', overrides: Object.values(poolsideEnvironmentKeys) },
  name: 'Poolside',
  protocol: 'acp',
  executable: 'pool',
  args: ['acp'],
  helpUrl: 'https://poolside.ai'
} as const satisfies AcpCliPreset<'poolside-settings'>
