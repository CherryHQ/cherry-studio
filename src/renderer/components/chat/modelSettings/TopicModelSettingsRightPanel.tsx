import type { RightPanelComponentProps } from '@renderer/components/chat/panes/Shell'

import { ConversationModelSettingsPanel } from './ConversationModelSettingsPanel'
import { useAssistantModelSettingsPanel } from './useAssistantModelSettingsPanel'

export type TopicModelSettingsScope = {
  assistantId?: string
  topicId?: string
}

export function TopicModelSettingsRightPanel({ active, scope }: RightPanelComponentProps<TopicModelSettingsScope>) {
  const panel = useAssistantModelSettingsPanel(scope.assistantId, scope.topicId)
  const missingAssistant = !scope.assistantId || (!panel.pending && !panel.assistant)

  return (
    <ConversationModelSettingsPanel
      active={active}
      model={panel.model}
      modelPending={panel.pending}
      missingAssistant={missingAssistant}
      settings={panel.settings}
      reasoningEffort={panel.reasoningEffort}
      reasoningSummary={panel.reasoningSummary}
      serviceTier={panel.serviceTier}
      fastMode={panel.fastMode}
      onReasoningEffortChange={panel.handleReasoningEffortChange}
      onReasoningSummaryChange={panel.handleReasoningSummaryChange}
      onServiceTierChange={panel.handleServiceTierChange}
      onFastModeChange={panel.onFastModeChange}
      onPatchSettings={panel.patchSettings}
    />
  )
}
