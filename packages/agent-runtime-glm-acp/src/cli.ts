import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const glmCli = {
  modelConfig: { tool: 'glm-acp-agent', target: 'glm-credentials', overrides: [] },
  id: 'glm-acp-agent',
  permissionMode: {
    values: { default: 'default', accept_edits: 'acceptEdits', bypass_permissions: 'bypassPermissions' }
  },
  externalCredentialMethods: ['z-ai-api-key', 'z_ai_api_key'],
  name: 'GLM Agent',
  protocol: 'acp',
  subscriptionUsage: true,
  executable: 'glm-acp-agent',
  args: [],
  helpUrl: 'https://github.com/stefandevo/glm-acp-agent'
} as const satisfies AcpCliPreset<'glm-credentials'>
