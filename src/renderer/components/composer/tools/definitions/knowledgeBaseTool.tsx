import { useCallback, useMemo, useRef } from 'react'

import { loggerService } from '@logger'
import { defineTool, type ToolRenderContext } from '@renderer/components/composer/tools/types'
import { useAssistantMutations } from '@renderer/hooks/useAssistant'
import { isSupportedToolUse } from '@renderer/utils/assistant'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import { composerKnowledgeBaseTokenId, getComposerTokenIds } from '../../variants/shared/composerTokens'
import { KnowledgeBaseToolRuntime } from '../components/KnowledgeBaseButton'
import { KNOWLEDGE_BASE_TOOLBAR_MANIFEST } from '../toolbarManifests'

const logger = loggerService.withContext('KnowledgeBaseTool')

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
  const { updateAssistant } = useAssistantMutations()
  // Sessions skip the model tool-use probe: an Agent session reaches its knowledge bases through the
  // runtime's own kb_* MCP tools, not through the model's function-calling support, so the composer
  // model here (which may be a sub-model) says nothing about whether the picker is usable.
  const isToolUseAvailable = context.session ? true : !!context.assistant && isSupportedToolUse(context.model)
  // Chat scope shows every loaded base and auto-links an unconfigured pick to the assistant (#20238).
  // Agent sessions keep the configured intersection — linking would edit the agent definition,
  // widening the ceiling for every session of that agent.
  const isChatScope = !!context.assistant
  const assistantKnowledgeBaseIds = context.assistant?.knowledgeBaseIds
  // Links still awaiting their PATCH: a rapid second click reads a pre-PATCH assistant
  // snapshot, and without merging these ids the second PATCH would drop the first link.
  const pendingLinkBaseIdsRef = useRef<Set<string>>(new Set())

  const unconfiguredBaseIds = useMemo(() => {
    if (!isChatScope) return new Set<string>()
    const configured = new Set(assistantKnowledgeBaseIds ?? [])
    return new Set(state.selectableKnowledgeBases.filter((base) => !configured.has(base.id)).map((base) => base.id))
  }, [assistantKnowledgeBaseIds, isChatScope, state.selectableKnowledgeBases])

  const handleLinkBase = useCallback(
    async (base: KnowledgeBase): Promise<boolean> => {
      const assistant = context.assistant
      if (!assistant) return false
      pendingLinkBaseIdsRef.current.add(base.id)
      const knowledgeBaseIds = [...new Set([...(assistant.knowledgeBaseIds ?? []), ...pendingLinkBaseIdsRef.current])]
      try {
        await updateAssistant(assistant.id, { knowledgeBaseIds })
        return true
      } catch (error) {
        logger.error('Failed to auto-link knowledge base to assistant', error as Error, {
          assistantId: assistant.id,
          knowledgeBaseId: base.id
        })
        return false
      } finally {
        pendingLinkBaseIdsRef.current.delete(base.id)
      }
    },
    [context.assistant, updateAssistant]
  )

  return (
    <KnowledgeBaseToolRuntime
      launcher={launcher}
      bases={state.selectableKnowledgeBases}
      unconfiguredBaseIds={unconfiguredBaseIds}
      onLinkBase={isChatScope ? handleLinkBase : undefined}
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
