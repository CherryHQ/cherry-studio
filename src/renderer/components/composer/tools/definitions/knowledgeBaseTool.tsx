import { useCallback, useMemo, useRef } from 'react'

import { loggerService } from '@logger'
import { defineTool, type ToolRenderContext } from '@renderer/components/composer/tools/types'
import { useAssistantMutations } from '@renderer/hooks/useAssistant'
import { isSupportedToolUse } from '@renderer/utils/assistant'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import { composerKnowledgeBaseTokenId, getComposerTokenIds } from '../../variants/shared/composerTokens'
import { KnowledgeBaseToolRuntime } from '../components/KnowledgeBaseButton'
import { KNOWLEDGE_BASE_TOOLBAR_MANIFEST } from '../toolbarManifests'

const logger = loggerService.withContext('KnowledgeBaseTool')

/** Tolerates the serialized shape (plain object with `code`) crossing IPC boundaries. */
const isRequestTimeout = (error: unknown): boolean =>
  error instanceof DataApiError
    ? error.code === ErrorCode.TIMEOUT
    : (error as { code?: unknown })?.code === ErrorCode.TIMEOUT

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
  // Chat scope shows every loaded base and auto-links an unconfigured pick to the assistant
  // (#20238); Agent scope keeps the configured intersection (linking edits the agent definition).
  const isChatScope = !!context.assistant
  const assistantKnowledgeBaseIds = context.assistant?.knowledgeBaseIds
  // Latest ids this runtime has settled on: the assistant snapshot, or the last PATCH's
  // own write while React Query has not delivered a fresher assistant yet.
  const assistantSnapshotRef = useRef(context.assistant)
  const latestKnowledgeBaseIdsRef = useRef<string[] | null>(null)
  if (assistantSnapshotRef.current !== context.assistant) {
    const nextIds = context.assistant?.knowledgeBaseIds ?? null
    const settled = latestKnowledgeBaseIdsRef.current
    // A same-assistant delivery missing ids this runtime already persisted predates
    // those writes (stale fetch); accepting it would resurrect the loss in the next
    // full PATCH. A different assistant's delivery is a new scope, not staleness.
    const sameAssistant = context.assistant?.id === assistantSnapshotRef.current?.id
    const isStaleDelivery =
      sameAssistant && settled != null && nextIds != null && !settled.every((id) => nextIds.includes(id))
    assistantSnapshotRef.current = context.assistant
    if (!isStaleDelivery) {
      latestKnowledgeBaseIdsRef.current = nextIds
    }
  }
  // Auto-link PATCHes run strictly one at a time, each body computed from the previous
  // outcome: a failed link must not leak into the next pick's body, and a carried one forward.
  const linkQueueRef = useRef<Promise<boolean>>(Promise.resolve(true))

  const unconfiguredBaseIds = useMemo(() => {
    if (!isChatScope) return new Set<string>()
    const configured = new Set(assistantKnowledgeBaseIds ?? [])
    return new Set(state.selectableKnowledgeBases.filter((base) => !configured.has(base.id)).map((base) => base.id))
  }, [assistantKnowledgeBaseIds, isChatScope, state.selectableKnowledgeBases])

  const handleLinkBase = useCallback(
    (base: KnowledgeBase): Promise<boolean> => {
      // The pick belongs to this assistant; if the user switches before the queued
      // PATCH runs, dropping the link beats silently widening another assistant.
      const assistantAtPick = assistantSnapshotRef.current
      // Scope is the assistant id, not the snapshot object: refresh deliveries mint new
      // same-id snapshots mid-flight and must not read as a switch.
      const pickStillInScope = () => assistantSnapshotRef.current?.id === assistantAtPick?.id
      const run = async (): Promise<boolean> => {
        if (!assistantAtPick || !pickStillInScope()) return false
        const currentIds = latestKnowledgeBaseIdsRef.current ?? assistantAtPick.knowledgeBaseIds ?? []
        if (currentIds.includes(base.id)) return true
        const knowledgeBaseIds = [...currentIds, base.id]
        try {
          await updateAssistant(assistantAtPick.id, { knowledgeBaseIds })
          // A mid-PATCH switch already re-scoped the settled ids to the new assistant;
          // writing the old list back would leak this assistant's bases into its next PATCH.
          if (pickStillInScope()) {
            latestKnowledgeBaseIdsRef.current = knowledgeBaseIds
          }
          return true
        } catch (error) {
          logger.error('Failed to auto-link knowledge base to assistant', error as Error, {
            assistantId: assistantAtPick.id,
            knowledgeBaseId: base.id
          })
          // A renderer-side timeout abandons the wait, not the write: the IPC PATCH may
          // still commit in the main process. Treating it as failed would let the next
          // full-array PATCH delete that committed link; keeping the pick settled (and
          // checked) retries the id idempotently in the next PATCH instead.
          if (isRequestTimeout(error) && pickStillInScope()) {
            latestKnowledgeBaseIdsRef.current = knowledgeBaseIds
            return true
          }
          return false
        }
      }
      const result = linkQueueRef.current.then(run, run)
      linkQueueRef.current = result.catch(() => false)
      return result
    },
    [updateAssistant]
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
