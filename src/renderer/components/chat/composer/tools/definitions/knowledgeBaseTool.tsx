import {
  defineTool,
  registerTool,
  type ToolRenderContext,
  TopicType
} from '@renderer/components/chat/composer/tools/types'
import { isSupportedToolUse } from '@renderer/utils/assistant'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { useCallback } from 'react'

import { chatComposerTokenId } from '../../variants/chatComposerTokens'
import { getComposerTokenIds } from '../../variants/shared/composerTokens'
import { KnowledgeBaseToolRuntime } from '../components/KnowledgeBaseButton'

type KnowledgeBaseToolContext = ToolRenderContext<
  readonly ['selectedKnowledgeBases', 'files', 'selectableKnowledgeBases'],
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
    state: ['selectedKnowledgeBases', 'files', 'selectableKnowledgeBases'] as const,
    actions: ['setSelectedKnowledgeBases'] as const
  },

  composer: {
    runtime: ({ context }) => <KnowledgeBaseComposerRuntime context={context} />,
    // Editor→state: prune deselected knowledge bases and re-add ones whose marker was pasted,
    // resolved against the scope's selectable knowledge bases.
    tokens: {
      reconcile: (draftTokens, { state, actions }) => {
        const knowledgeTokenIds = getComposerTokenIds(draftTokens, 'knowledge')
        actions.setSelectedKnowledgeBases?.((prev) => {
          const next = prev.filter((base) => knowledgeTokenIds.has(chatComposerTokenId.knowledge(base)))
          const nextIds = new Set(next.map(chatComposerTokenId.knowledge))
          let changed = next.length !== prev.length

          for (const base of state.selectableKnowledgeBases) {
            const tokenId = chatComposerTokenId.knowledge(base)
            if (!knowledgeTokenIds.has(tokenId) || nextIds.has(tokenId)) continue
            next.push(base)
            nextIds.add(tokenId)
            changed = true
          }

          return changed ? next : prev
        })
      }
    }
  }
})

registerTool(knowledgeBaseTool)

export default knowledgeBaseTool
