import { useAssistant } from '@renderer/hooks/useAssistant'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import type { KnowledgeBase } from '@renderer/types'
import { isPromptToolUse, isSupportedToolUse } from '@renderer/utils/mcp-tools'
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
  // ✅ 移除 icon 属性，不在 ToolDefinition 类型中
  // icon: FileSearch,

  visibleInScopes: [TopicType.Chat],
  condition: ({ assistant }) => isSupportedToolUse(assistant) || isPromptToolUse(assistant),

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
      [updateAssistant, actions]
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
