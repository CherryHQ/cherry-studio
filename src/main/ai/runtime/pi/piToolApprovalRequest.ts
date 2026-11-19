import type { JsonValue } from '@cherrystudio/agent-runtime'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { ToolGuardInteractionState } from '@main/ai/toolApproval/toolGuards'

import type { AgentRuntimeEvent } from '../types'
import { PI_TRANSPORT } from './PiMessageMetadata'

export async function requestPiToolApproval(request: {
  id: string
  sessionId: string
  toolCallId: string
  parentToolCallId?: string
  name: string
  args: Record<string, JsonValue>
  signal: AbortSignal
  details?: JsonValue
  presentation: ToolGuardInteractionState['userResponse']
  emit(event: AgentRuntimeEvent): void
}): Promise<DispatchDecision | undefined> {
  const { id, sessionId, toolCallId, parentToolCallId, name, args, signal, details, presentation } = request
  signal.throwIfAborted()
  if (presentation === 'unavailable') return undefined
  const decision = await new Promise<DispatchDecision>((resolve) => {
    const pending = toolApprovalRegistry.register({
      approvalId: id,
      sessionId,
      toolCallId,
      toolName: name,
      originalInput: args,
      presentation,
      signal,
      resolve
    })
    if (pending)
      request.emit({
        type: 'tool-approval-request',
        request: {
          approvalId: id,
          toolCallId,
          toolName: name,
          input: args,
          presentation,
          providerMetadata: {
            cherry: {
              transport: PI_TRANSPORT,
              toolName: name,
              ...(parentToolCallId ? { parentToolCallId } : {}),
              ...(details === undefined ? {} : { commandPolicy: details })
            }
          }
        }
      })
  })
  signal.throwIfAborted()
  return decision
}
