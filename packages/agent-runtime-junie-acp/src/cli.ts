import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const junieCli = {
  id: 'junie',
  name: 'Junie',
  protocol: 'acp',
  gatewayModelEndpoint: 'openai-chat-completions',
  executable: 'junie',
  args: ['--acp=true'],
  permissionMode: {
    approvalConfigId: 'brave_mode',
    workflowConfigId: 'mode',
    values: { default: 'default', plan: 'plan', off: 'default', 'brave-auto': 'auto', on: 'bypassPermissions' }
  },
  loginArgs: [],
  credentialEnvironment: [
    'JUNIE_API_KEY',
    'JUNIE_LLM_PROVIDER',
    'JUNIE_ANTHROPIC_API_KEY',
    'JUNIE_OPENAI_API_KEY',
    'JUNIE_GOOGLE_API_KEY',
    'JUNIE_GROK_API_KEY',
    'JUNIE_META_API_KEY',
    'JUNIE_OPENROUTER_API_KEY',
    'JUNIE_LITELLM_URL',
    'JUNIE_LITELLM_API_KEY'
  ],
  helpUrl: 'https://junie.jetbrains.com'
} as const satisfies AcpCliPreset
