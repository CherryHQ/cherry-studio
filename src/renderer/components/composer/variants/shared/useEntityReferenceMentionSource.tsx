import { dataApiService } from '@data/DataApiService'
import { toast } from '@renderer/services/toast'
import type { Editor } from '@tiptap/core'
import { MessageSquare, MousePointerClick } from 'lucide-react'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { serializeComposerDocument } from '../../composerDraft'
import type { ComposerSuggestionItem, ComposerSuggestionSource } from '../../quickPanel'
import { fetchEntityReferencePromptText } from './entityReferenceContext'

const REFERENCE_RESULT_LIMIT = 50
// List endpoints page pinned-first in manual order, so recency sorting happens client-side
// over the first page; entities beyond it are reachable by typing a name query instead.
const REFERENCE_LIST_FETCH_LIMIT = 200

const referenceTokenId = (entityType: 'topic' | 'session', id: string) => `reference:${entityType}:${id}`

interface EntityReferenceHit {
  id: string
  title: string
  subtitle?: string
  agentId: string | null
}

async function fetchReferenceHits(entityType: 'topic' | 'session', q: string): Promise<EntityReferenceHit[]> {
  if (!q) {
    // Empty query lists every conversation (most recently updated first); /search/entities
    // requires a non-empty q, so the plain list endpoints back the initial panel.
    if (entityType === 'topic') {
      const page = await dataApiService.get('/topics', { query: { limit: REFERENCE_LIST_FETCH_LIMIT } })
      return page.items
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, REFERENCE_RESULT_LIMIT)
        .map((topic) => ({ id: topic.id, title: topic.name, agentId: null }))
    }
    const page = await dataApiService.get('/agent-sessions', { query: { limit: REFERENCE_LIST_FETCH_LIMIT } })
    return page.items
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, REFERENCE_RESULT_LIMIT)
      .map((session) => ({ id: session.id, title: session.name, agentId: session.agentId }))
  }

  const response = await dataApiService.get('/search/entities', {
    query: { q, types: [entityType], limitPerType: REFERENCE_RESULT_LIMIT }
  })
  const hits: EntityReferenceHit[] = []
  for (const group of response.groups) {
    if (group.type === 'topic') {
      for (const hit of group.items) {
        hits.push({ id: hit.id, title: hit.title, subtitle: hit.subtitle, agentId: null })
      }
    } else if (group.type === 'session') {
      for (const hit of group.items) {
        hits.push({ id: hit.id, title: hit.title, subtitle: hit.subtitle, agentId: hit.target.agentId })
      }
    }
  }
  return hits
}

export interface EntityReferenceMentionOptions {
  /** Which conversation entity this composer references: chat → topics, agent → sessions. */
  entityType: 'topic' | 'session'
  /** The current conversation's id, excluded from results to avoid self-reference. */
  excludeId?: string
}

/**
 * Builds the `@`-mention items that reference past conversations: an empty query lists the
 * most recently updated entities (via the list endpoints), a non-empty query searches by
 * name (via `/search/entities`). Picking an item fetches the conversation's transcript and
 * inserts it as a `reference` composer token whose promptText is the formatted context
 * block. Consumed directly as a suggestion source by the chat composer (topics), and
 * appended to the agent composer's existing `@` file panel via `getAdditionalItems`
 * (sessions).
 */
export function useEntityReferenceMentionItems({ entityType, excludeId }: EntityReferenceMentionOptions) {
  const { t } = useTranslation()
  const stateRef = useRef({ entityType, excludeId, t })
  stateRef.current = { entityType, excludeId, t }

  return useCallback(
    async ({ query, editor }: { query: string; editor: Editor }): Promise<ComposerSuggestionItem[]> => {
      const { entityType, excludeId, t } = stateRef.current
      const icon = entityType === 'topic' ? <MessageSquare size={16} /> : <MousePointerClick size={16} />
      const untitledLabel = entityType === 'topic' ? t('chat.conversation.new') : t('agent.session.new')

      const hits = await fetchReferenceHits(entityType, query.trim())
      const insertedTokenIds = new Set(serializeComposerDocument(editor).tokens.map((token) => token.id))

      const items = hits
        .filter((hit) => hit.id !== excludeId)
        .map((hit): ComposerSuggestionItem => {
          const tokenId = referenceTokenId(entityType, hit.id)
          const title = hit.title.trim() || untitledLabel
          return {
            id: tokenId,
            label: title,
            description: hit.subtitle,
            icon,
            filterText: `${title} ${hit.subtitle ?? ''}`,
            disabled: insertedTokenIds.has(tokenId),
            command: ({ editor }) => {
              void (async () => {
                try {
                  const promptText = await fetchEntityReferencePromptText(
                    entityType === 'topic'
                      ? { entityType, id: hit.id, name: title }
                      : { entityType, id: hit.id, name: title, agentId: hit.agentId }
                  )
                  if (editor.isDestroyed) return
                  const exists = serializeComposerDocument(editor).tokens.some((token) => token.id === tokenId)
                  if (exists) return
                  editor
                    .chain()
                    .focus()
                    .insertComposerToken({
                      id: tokenId,
                      kind: 'reference',
                      label: title,
                      description: hit.subtitle ? `${title} · ${hit.subtitle}` : title,
                      promptText,
                      payload: { entityType, id: hit.id, name: title }
                    })
                    .insertContent(' ')
                    .run()
                } catch {
                  toast.error(t('chat.input.reference_panel.load_failed'))
                }
              })()
            }
          }
        })

      return items
    },
    []
  )
}

/** The chat composer's standalone `@` suggestion source for topic references. */
export function useEntityReferenceMentionSource(options: EntityReferenceMentionOptions): ComposerSuggestionSource[] {
  const { entityType } = options
  const { t } = useTranslation()
  const getItems = useEntityReferenceMentionItems(options)

  // The standalone panel shows a disabled empty-state row; when merged into another
  // panel (agent `@`), the raw item list stays empty so the host's empty handling wins.
  const getItemsWithEmptyState = useCallback(
    async (args: { query: string; editor: Editor }): Promise<ComposerSuggestionItem[]> => {
      const items = await getItems(args)
      if (items.length > 0) return items
      return [
        {
          id: 'entity-reference:no-results',
          label: t(`chat.input.reference_panel.${entityType}.no_results.label`),
          description: t(`chat.input.reference_panel.${entityType}.no_results.description`),
          icon: entityType === 'topic' ? <MessageSquare size={16} /> : <MousePointerClick size={16} />,
          disabled: true,
          command: () => undefined
        }
      ]
    },
    [entityType, getItems, t]
  )

  return useMemo(
    () => [
      {
        pluginKey: 'entity-reference-mention-suggestion',
        char: '@',
        title: t(`chat.input.reference_panel.${entityType}.title`),
        allowedPrefixes: [' ', '\n'],
        items: getItemsWithEmptyState
      }
    ],
    [entityType, getItemsWithEmptyState, t]
  )
}
