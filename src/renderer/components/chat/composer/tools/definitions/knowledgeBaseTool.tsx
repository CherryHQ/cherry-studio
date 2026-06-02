import {
  defineTool,
  registerTool,
  type ToolRenderContext,
  TopicType
} from '@renderer/components/chat/composer/tools/types'
import { isSupportedToolUse } from '@renderer/utils/assistant'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { useCallback } from 'react'

import { KnowledgeBaseToolRuntime } from '../components/KnowledgeBaseButton'

type KnowledgeBaseToolContext = ToolRenderContext<
  readonly ['selectedKnowledgeBases', 'files'],
  readonly ['setSelectedKnowledgeBases']
>

const useKnowledgeBaseSelect = (context: KnowledgeBaseToolContext) => {
  const { actions } = context

  return useCallback(
    (bases: KnowledgeBase[]) => {
      actions.setSelectedKnowledgeBases?.(bases)
    },
    [actions]
  )
}

const KnowledgeBaseComposerRuntime = ({ context }: { context: KnowledgeBaseToolContext }) => {
  const { state, launcher } = context
  const handleSelect = useKnowledgeBaseSelect(context)
  const isToolUseAvailable = !!context.assistant && isSupportedToolUse(context.model)

  return (
    <KnowledgeBaseToolRuntime
      launcher={launcher}
      configuredKnowledgeBaseIds={context.assistant?.knowledgeBaseIds ?? []}
      selectedBases={state.selectedKnowledgeBases}
      onSelect={handleSelect}
      disabled={!isToolUseAvailable || (Array.isArray(state.files) && state.files.length > 0)}
      disabledReason={isToolUseAvailable ? undefined : context.t('chat.input.knowledge_base_unavailable')}
    />
  )
}

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

  dependencies: {
    state: ['selectedKnowledgeBases', 'files'] as const,
    actions: ['setSelectedKnowledgeBases'] as const
  },

  composer: {
    runtime: ({ context }) => <KnowledgeBaseComposerRuntime context={context} />
  }
})

registerTool(knowledgeBaseTool)

export default knowledgeBaseTool
