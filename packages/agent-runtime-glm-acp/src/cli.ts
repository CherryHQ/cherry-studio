import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const glmCli = {
  modelConfig: { tool: 'glm-acp-agent', target: 'glm-credentials', overrides: [] },
  id: 'glm-acp-agent',
  permissionMode: {
    values: { default: 'default', accept_edits: 'acceptEdits', bypass_permissions: 'bypassPermissions' }
  } satisfies AcpPermissionModes,
  externalCredentialMethods: ['z-ai-api-key', 'z_ai_api_key'],
  name: 'GLM Agent',
  protocol: 'acp',
  executable: 'glm-acp-agent',
  args: [],
  helpUrl: 'https://github.com/stefandevo/glm-acp-agent'
} as const
