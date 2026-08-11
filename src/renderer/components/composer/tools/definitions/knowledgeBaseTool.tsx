import { defineTool, type ToolRenderContext } from '@renderer/components/composer/tools/types'
import { isSupportedToolUse } from '@renderer/utils/assistant'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { useCallback } from 'react'

import { composerKnowledgeBaseTokenId, getComposerTokenIds } from '../../variants/shared/composerTokens'
import { KnowledgeBaseToolRuntime } from '../components/KnowledgeBaseButton'
import { KNOWLEDGE_BASE_TOOLBAR_MANIFEST } from '../toolbarManifests'

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
  // Sessions skip the model tool-use probe: an Agent session reaches its knowledge bases through the
  // runtime's own kb_* MCP tools, not through the model's function-calling support, so the composer
  // model here (which may be a sub-model) says nothing about whether the picker is usable.
  const isToolUseAvailable = context.session ? true : !!context.assistant && isSupportedToolUse(context.model)

  return (
    <KnowledgeBaseToolRuntime
      launcher={launcher}
      configuredKnowledgeBaseIds={context.assistant?.knowledgeBaseIds ?? context.session?.knowledgeBaseIds ?? []}
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
 * Visible in the Chat and Session scopes (see `KNOWLEDGE_BASE_TOOLBAR_MANIFEST`).
 */
const knowledgeBaseTool = defineTool({
  key: 'knowledge_base',
  label: KNOWLEDGE_BASE_TOOLBAR_MANIFEST.label,
  visibleInScopes: KNOWLEDGE_BASE_TOOLBAR_MANIFEST.visibleInScopes,

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
          const next = prev.filter((base) => knowledgeTokenIds.has(composerKnowledgeBaseTokenId(base)))
          const nextIds = new Set(next.map(composerKnowledgeBaseTokenId))
          let changed = next.length !== prev.length

          for (const base of state.selectableKnowledgeBases) {
            const tokenId = composerKnowledgeBaseTokenId(base)
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

export default knowledgeBaseTool
