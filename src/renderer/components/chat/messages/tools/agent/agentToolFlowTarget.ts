import { type AgentLaunchIndex, getPartLaunchToolCallId, resolveResumeReceiptState } from '../shared/agentToolTypes'
import type { ToolResponseLike } from '../toolResponse'

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
  const ownsItsFlow =
    launchIndex?.childRootCallIds.has(callId) === true || launchIndex?.dshTaskRootCallIds.has(callId) === true
  return ownsItsFlow ? callId : state.toolCallId
}
