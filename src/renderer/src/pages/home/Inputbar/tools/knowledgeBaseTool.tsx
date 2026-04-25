import { useAssistantMutations } from '@renderer/hooks/useAssistantDataApi'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type { KnowledgeBase } from '@renderer/types'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/assistant'
import { useCallback } from 'react'

import KnowledgeBaseButton from './components/KnowledgeBaseButton'

/**
 * Knowledge Base Tool
 *
 * Allows users to select knowledge bases to provide context for their messages.
 * Only visible when knowledge base sidebar is enabled.
 */
const knowledgeBaseTool = defineTool({
  key: 'knowledge_base',
  label: (t) => t('chat.input.knowledge_base'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ assistant, model }) => isSupportedToolUse(assistant, model) || isPromptToolUse(assistant),

  dependencies: {
    state: ['selectedKnowledgeBases', 'files'] as const,
    actions: ['setSelectedKnowledgeBases'] as const
  },

  render: function KnowledgeBaseToolRender(context) {
    const { assistant, state, actions, quickPanel } = context
    const { updateAssistant } = useAssistantMutations()

    const handleSelect = useCallback(
      (bases: KnowledgeBase[]) => {
        void updateAssistant(assistant.id, { knowledgeBaseIds: bases.map((b) => b.id) })
        actions.setSelectedKnowledgeBases?.(bases)
      },
      [updateAssistant, assistant.id, actions]
    )

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
