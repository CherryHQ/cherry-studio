import type { AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const openClawCli = {
  id: 'openclaw',
  gatewayProviderId: 'api-gateway',
  name: 'OpenClaw',
  placeholderTitle: /^(?:(?:agent:[^:]+:)?acp-bridge:|\[Working directory:)/i,
  protocol: 'acp',
  executable: 'openclaw',
  args: ['acp'],
  npmPackage: 'openclaw',
  helpUrl: 'https://docs.openclaw.ai/cli/acp'
} as const satisfies AcpCliPreset
