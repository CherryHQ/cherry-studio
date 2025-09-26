import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import KnowledgeBaseButton from '@renderer/pages/home/Inputbar/KnowledgeBaseButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { KnowledgeBase } from '@renderer/types'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/mcp-tools'
import { useCallback } from 'react'

const knowledgeBaseTool = defineTool({
  key: 'knowledge_base',
  label: (t) => t('chat.input.knowledge_base'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ features, assistant }) =>
    features.enableKnowledge && (isSupportedToolUse(assistant) || isPromptToolUse(assistant)),
  dependencies: {
    state: ['selectedKnowledgeBases', 'files'] as const,
    actions: ['setSelectedKnowledgeBases'] as const
  },
  render: function KnowledgeBaseToolRender(context) {
    const { assistant, state, actions, quickPanel } = context
    const knowledgeSidebarEnabled = useSidebarIconShow('knowledge')
    const { updateAssistant } = useAssistant(assistant.id)

    const handleSelect = useCallback(
      (bases: KnowledgeBase[]) => {
        updateAssistant({ knowledge_bases: bases })
        actions.setSelectedKnowledgeBases?.(bases)
      },
      [actions, updateAssistant]
    )

    if (!knowledgeSidebarEnabled) {
      return null
    }

    return (
      <KnowledgeBaseButton
        quickPanel={quickPanel}
        selectedBases={state.selectedKnowledgeBases}
        onSelect={handleSelect}
        disabled={Array.isArray(state.files) && state.files.length > 0}
      />
    )
  }
})

registerTool(knowledgeBaseTool)

export default knowledgeBaseTool
