import { useAssistantMutations } from '@renderer/hooks/useAssistant'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { isSupportedToolUse } from '@renderer/utils/assistant'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'
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
  condition: ({ model }) => isSupportedToolUse(model),

  dependencies: {
    state: ['selectedKnowledgeBases', 'availableKnowledgeBases', 'files'] as const,
    actions: ['setSelectedKnowledgeBases'] as const
  },

  render: function KnowledgeBaseToolRender(context) {
    const { assistant, state, actions, quickPanel } = context
    const { updateAssistant } = useAssistantMutations()

    const handleSelect = useCallback(
      (bases: KnowledgeBaseListItem[]) => {
        void updateAssistant(assistant.id, { knowledgeBaseIds: bases.map((b) => b.id) })
        actions.setSelectedKnowledgeBases?.(bases)
      },
      [updateAssistant, assistant.id, actions]
    )

    return (
      <KnowledgeBaseButton
        quickPanel={quickPanel}
        bases={state.availableKnowledgeBases}
        selectedBases={state.selectedKnowledgeBases}
        onSelect={handleSelect}
        disabled={Array.isArray(state.files) && state.files.length > 0}
      />
    )
  }
})

registerTool(knowledgeBaseTool)

export default knowledgeBaseTool
