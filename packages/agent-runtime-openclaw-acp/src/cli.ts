export const openClawCli = {
  id: 'openclaw',
  name: 'OpenClaw',
  placeholderTitle: /^(?:(?:agent:[^:]+:)?acp-bridge:|\[Working directory:)/i,
  protocol: 'acp',
  executable: 'openclaw',
  args: ['acp'],
  npmPackage: 'openclaw',
  helpUrl: 'https://docs.openclaw.ai/cli/acp'
} as const
