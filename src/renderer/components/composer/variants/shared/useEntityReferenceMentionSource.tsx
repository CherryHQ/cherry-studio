import { dataApiService } from '@data/DataApiService'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { MessageSquare, MousePointerClick } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toast } from '@renderer/services/toast'

import { COMPOSER_INPUT_MAX_LENGTH, serializeComposerDocument } from '../../composerDraft'
import { COMPOSER_TOKEN_NODE_NAME } from '../../ComposerTokenNode'
import type { ComposerSuggestionItem, ComposerSuggestionSource } from '../../quickPanel'
import { fetchEntityReferencePromptText } from './entityReferenceContext'

const REFERENCE_RESULT_LIMIT = 50
// List endpoints page pinned-first in manual order, so recency sorting happens client-side
// over the first page; entities beyond it are reachable by typing a name query instead.
const REFERENCE_LIST_FETCH_LIMIT = 200
// Below this much room left in the draft a reference block carries too little of the
// conversation to be worth inserting.
const REFERENCE_MIN_ROOM_CHARS = 1000

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

/**
 * Fills the placeholder reference token with the loaded transcript (or removes it when
 * `promptText` is null). A no-op once the draft no longer holds the token — the message was
 * sent, the draft was cleared, or the user deleted the chip — so a late transcript can never
 * land in an unrelated draft.
 */
function settlePendingReferenceToken(editor: Editor, tokenId: string, promptText: string | null) {
  if (editor.isDestroyed) return

  const matches: Array<{ position: number; node: ProseMirrorNode }> = []
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === COMPOSER_TOKEN_NODE_NAME && node.attrs.id === tokenId) {
      matches.push({ position, node })
    }
  })
  const match = matches[0]
  if (!match) return

  const transaction = editor.state.tr
  if (promptText === null) {
    transaction.delete(match.position, match.position + match.node.nodeSize)
  } else {
    transaction.setNodeMarkup(match.position, undefined, { ...match.node.attrs, promptText })
  }
  editor.view.dispatch(transaction)
}

export interface EntityReferenceMentionOptions {
  /** Which conversation entity this composer references: chat → topics, agent → sessions. */
  entityType: 'topic' | 'session'
  /** The current conversation's id, excluded from results to avoid self-reference. */
  excludeId?: string
}

export interface EntityReferenceMentionItems {
  getItems: (options: { query: string; editor: Editor }) => Promise<ComposerSuggestionItem[]>
  /** True while a picked reference is still loading; the host composer must block sending. */
  hasPendingReference: boolean
}

/**
 * Builds the `@`-mention items that reference past conversations: an empty query lists the
 * most recently updated entities (via the list endpoints), a non-empty query searches by
 * name (via `/search/entities`). Picking an item inserts a `reference` composer token at once
 * and fills it in place with the conversation's transcript when it loads. Consumed directly as
 * a suggestion source by the chat composer (topics), and appended to the agent composer's
 * existing `@` file panel via `getAdditionalItems` (sessions).
 */
export function useEntityReferenceMentionItems({
  entityType,
  excludeId
}: EntityReferenceMentionOptions): EntityReferenceMentionItems {
  const { t } = useTranslation()
  const stateRef = useRef({ entityType, excludeId, t })
  stateRef.current = { entityType, excludeId, t }
  const [pendingCount, setPendingCount] = useState(0)

  const getItems = useCallback(
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
              const draft = serializeComposerDocument(editor)
              if (draft.tokens.some((token) => token.id === tokenId)) return

              // Token insertion bypasses the composer's input-length guards (they sit on the
              // typing and paste paths), so the block is budgeted against what the draft has left.
              const remainingChars = COMPOSER_INPUT_MAX_LENGTH - draft.text.length
              if (remainingChars < REFERENCE_MIN_ROOM_CHARS) {
                toast.error(t('chat.input.reference_panel.no_room'))
                return
              }

              // Insert synchronously so the chip is bound to this draft and position; the
              // transcript fills it in place later. Sending stays blocked until then, so a
              // message can never go out holding an empty reference.
              editor
                .chain()
                .focus()
                .insertComposerToken({
                  id: tokenId,
                  kind: 'reference',
                  label: title,
                  description: hit.subtitle ? `${title} · ${hit.subtitle}` : title,
                  promptText: '',
                  payload: { entityType, id: hit.id, name: title }
                })
                .insertContent(' ')
                .run()
              setPendingCount((count) => count + 1)

              void (async () => {
                try {
                  const promptText = await fetchEntityReferencePromptText(
                    entityType === 'topic'
                      ? { entityType, id: hit.id, name: title }
                      : { entityType, id: hit.id, name: title, agentId: hit.agentId },
                    { maxTotalChars: remainingChars }
                  )
                  settlePendingReferenceToken(editor, tokenId, promptText)
                } catch {
                  settlePendingReferenceToken(editor, tokenId, null)
                  toast.error(t('chat.input.reference_panel.load_failed'))
                } finally {
                  setPendingCount((count) => count - 1)
                }
              })()
            }
          }
        })

      return items
    },
    []
  )

  return { getItems, hasPendingReference: pendingCount > 0 }
}

export interface EntityReferenceMentionSource {
  sources: ComposerSuggestionSource[]
  /** True while a picked reference is still loading; the host composer must block sending. */
  hasPendingReference: boolean
}

/** The chat composer's standalone `@` suggestion source for topic references. */
export function useEntityReferenceMentionSource(options: EntityReferenceMentionOptions): EntityReferenceMentionSource {
  const { entityType } = options
  const { t } = useTranslation()
  const { getItems, hasPendingReference } = useEntityReferenceMentionItems(options)

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

  const sources = useMemo(
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

  return { sources, hasPendingReference }
}
