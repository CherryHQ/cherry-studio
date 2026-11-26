export const glmCli = {
  modelConfig: { tool: 'glm-acp-agent', target: 'glm-credentials', overrides: [] },
  id: 'glm-acp-agent',
  externalCredentialMethods: ['z-ai-api-key', 'z_ai_api_key'],
  name: 'GLM Agent',
  protocol: 'acp',
  executable: 'glm-acp-agent',
  args: [],
  helpUrl: 'https://github.com/stefandevo/glm-acp-agent'
} as const
