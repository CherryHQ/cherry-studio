import type { AcpGatewayModel, AcpLaunch } from '@cherrystudio/agent-runtime-acp/profile'

import { deepAgentsCli } from './cli'

export const deepAgentsPreset = {
  id: deepAgentsCli.id,
  applyGatewayModel(launch: AcpLaunch, gateway: AcpGatewayModel): void {
    launch.args = [...launch.args, '--model', `openai:${gateway.model}`]
    launch.env.OPENAI_BASE_URL = `${gateway.baseUrl}/v1`
    launch.env.OPENAI_API_KEY = gateway.apiKey
  }
}
