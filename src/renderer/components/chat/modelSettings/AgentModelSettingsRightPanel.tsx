import type { RightPanelComponentProps } from '@renderer/components/chat/panes/Shell'

import { ConversationModelSettingsPanel } from './ConversationModelSettingsPanel'
import { useAgentModelSettingsPanel } from './useAgentModelSettingsPanel'

type AgentModelSettingsScope = {
  meta: { agentId?: string; sessionId?: string }
}

export function AgentModelSettingsRightPanel({ active, scope }: RightPanelComponentProps<AgentModelSettingsScope>) {
  const panel = useAgentModelSettingsPanel(scope.meta.agentId, scope.meta.sessionId)
  const missingAgent =
    !scope.meta.agentId || (Boolean(scope.meta.agentId) && !panel.pending && !panel.agent)

  return (
    <ConversationModelSettingsPanel
      active={active}
      model={panel.model}
      modelPending={panel.pending}
      missingAssistant={missingAgent}
      missingEntity="agent"
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
