export const vibeCli = {
  id: 'mistral-vibe',
  name: 'Mistral Vibe',
  protocol: 'acp',
  executable: 'vibe-acp',
  modelConfig: { tool: 'mistral-vibe', target: 'vibe-config', overrides: ['VIBE_HOME', 'VIBE_ACTIVE_MODEL'] },
  args: [],
  helpUrl: 'https://mistral.ai/products/vibe'
} as const
