import type { TFunction } from 'i18next'

import type { AgentSessionForkFailureReason } from '@shared/ai/agentSessionFork'

/** Static keys keep all unavailable states visible to the translation tooling. */
export function agentSessionForkReasonLabel(t: TFunction, reason: AgentSessionForkFailureReason): string {
  switch (reason) {
    case 'legacy_history':
      return t('agent_session_fork.legacy_history')
    case 'not_turn_boundary':
      return t('agent_session_fork.not_turn_boundary')
    case 'checkpoint_failed':
      return t('agent_session_fork.checkpoint_failed')
    case 'history_missing':
      return t('agent_session_fork.history_missing')
    case 'history_corrupt':
      return t('agent_session_fork.history_corrupt')
    case 'unsupported_checkpoint':
      return t('agent_session_fork.unsupported_checkpoint')
    case 'history_changed':
      return t('agent_session_fork.history_changed')
    case 'workspace_changed':
      return t('agent_session_fork.workspace_changed')
    case 'workspace_unsupported_file':
      return t('agent_session_fork.workspace_unsupported_file')
    case 'operation_failed':
      return t('agent_session_fork.operation_failed')
  }
}
