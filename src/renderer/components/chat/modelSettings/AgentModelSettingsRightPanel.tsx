import type { RightPanelComponentProps } from '@renderer/components/chat/panes/Shell'

import { ConversationModelSettingsPanel } from './ConversationModelSettingsPanel'
import { useAgentModelSettingsPanel } from './useAgentModelSettingsPanel'

type AgentModelSettingsScope = {
  meta: { agentId?: string; sessionId?: string }
}

export function AgentModelSettingsRightPanel({ active, scope }: RightPanelComponentProps<AgentModelSettingsScope>) {
  const panel = useAgentModelSettingsPanel(scope.meta.agentId, scope.meta.sessionId)

  return (
    <ConversationModelSettingsPanel
      active={active}
      model={panel.model}
      modelPending={panel.pending}
      missingAssistant={!scope.meta.agentId}
      reasoningEffort={panel.reasoningEffort}
      serviceTier={panel.serviceTier}
      fastMode={panel.fastMode}
      onReasoningEffortChange={panel.handleReasoningEffortChange}
      onServiceTierChange={panel.handleServiceTierChange}
      onFastModeChange={panel.onFastModeChange}
      onPatchSettings={() => undefined}
    />
  )
}
