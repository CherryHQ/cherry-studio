import { encodeCanonical } from '../encoding'
import { agentMethods, type AgentMutation, type AgentParams } from './methods'

export function encodeAgentCommand<M extends AgentMutation>(method: M, params: AgentParams<M>): Uint8Array {
  agentMethods[method].params.parse(params)
  const { commandId: _commandId, ...body } = params
  return encodeCanonical({ method, params: body })
}
