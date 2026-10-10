import type { TFunction } from 'i18next'

import type { ActionAvailabilityInput } from '@renderer/components/chat/actions/actionTypes'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import type { AgentSessionForkFailureReason } from '@shared/ai/agentSessionFork'

export function agentSessionForkAvailability(t: TFunction, message: MessageListItem): ActionAvailabilityInput {
  if (message.role !== 'assistant') return false
  const enabled = message.status === 'success'
  return {
    visible: true,
    enabled,
    reason: enabled ? undefined : agentSessionForkReasonLabel(t, 'not_turn_boundary')
  }
}

/** Static keys keep runtime errors visible to the translation tooling. */
export function agentSessionForkReasonLabel(t: TFunction, reason: AgentSessionForkFailureReason): string {
  switch (reason) {
    case 'cancelled':
      return t('message.tools.cancelled')
    case 'legacy_history':
      return t('agent_session_fork.legacy_history')
    case 'not_turn_boundary':
      return t('agent_session_fork.not_turn_boundary')
    case 'history_missing':
      return t('agent_session_fork.history_missing')
    case 'history_corrupt':
      return t('agent_session_fork.history_corrupt')
    case 'unsupported_checkpoint':
      return t('agent_session_fork.unsupported_checkpoint')
    case 'source_changed':
    case 'history_changed':
      return t('agent_session_fork.history_changed')
    case 'workspace_changed':
      return t('agent_session_fork.workspace_changed')
    case 'workspace_unsupported_file':
      return t('agent_session_fork.workspace_unsupported_file')
    case 'source_missing':
    case 'operation_failed':
      return t('agent_session_fork.operation_failed')
  }
}
