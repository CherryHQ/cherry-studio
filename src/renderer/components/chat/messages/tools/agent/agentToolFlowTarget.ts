import { type AgentLaunchIndex, resolveResumeReceiptState } from '../shared/agentToolTypes'
import { getPartLaunchToolCallId } from '../toolParentMetadata'
import type { ToolResponseLike } from '../toolResponse'

/**
 * Whether a call roots a flow of its own — child content streams under it, or the runtime bound a
 * dsh task to it. Such a call is a flow entry even when its historical launch is out of the window.
 */
export function ownsItsFlowCall(launchIndex: AgentLaunchIndex | null | undefined, callId: string): boolean {
  return launchIndex?.childRootCallIds.has(callId) === true || launchIndex?.dshTaskRootCallIds.has(callId) === true
}

/**
 * The flow a tool row opens. A resume receipt that owns its flow keeps its own call; one that
 * resolves to a launch opens that launch; every other row opens itself. The row's click and the
 * subtask disclosure both read this, so a flow can never be "active" in one and not the other.
 */
export function resolveAgentToolFlowTarget(
  toolResponse: ToolResponseLike,
  launchIndex: AgentLaunchIndex | null,
  canNavigate: boolean
): string | undefined {
  const callId = toolResponse.toolCallId
  if (!callId) return undefined
  const state = resolveResumeReceiptState(
    toolResponse.response,
    getPartLaunchToolCallId(toolResponse),
    launchIndex,
    canNavigate
  )
  if (state.kind !== 'navigable') return callId
  return ownsItsFlowCall(launchIndex, callId) ? callId : state.toolCallId
}
