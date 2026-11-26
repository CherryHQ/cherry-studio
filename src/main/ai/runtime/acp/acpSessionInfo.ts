import { acpAuthMethods, type AcpInitializeResponse } from '@cherrystudio/agent-runtime-acp/v1'
import type { LocalAgentProtocolInfo } from '@shared/ai/localAgent'

export function acpProtocolInfo(response: AcpInitializeResponse): LocalAgentProtocolInfo {
  return {
    protocolVersion: response.protocolVersion,
    agent: response.agentInfo
      ? {
          name: response.agentInfo.name,
          version: response.agentInfo.version,
          ...(response.agentInfo.title ? { title: response.agentInfo.title } : {})
        }
      : undefined,
    capabilities: response.agentCapabilities ?? {},
    authMethods: acpAuthMethods(response),
    verified: ['handshake']
  }
}
