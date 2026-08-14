import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import {
  composerFileTokenIdFromSourceId,
  getComposerFileTokenSourceId
} from '@renderer/utils/message/composerFileTokenSource'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { ComposerDraftToken, ComposerSerializedToken } from '../../tokens'

export const composerFileTokenId = (file: Pick<ComposerAttachment, 'fileTokenSourceId'>) => {
  const sourceId = getComposerFileTokenSourceId(file)
  if (!sourceId) {
    throw new Error('fileTokenSourceId is required to create a composer file token id')
  }
  return composerFileTokenIdFromSourceId(sourceId)
}

export const composerKnowledgeBaseTokenId = (base: Pick<KnowledgeBase, 'id'>) => `knowledge:${base.id}`

export function fileToComposerToken(file: ComposerAttachment): ComposerDraftToken {
  return {
    id: composerFileTokenId(file),
    kind: 'file',
    label: file.origin_name || file.name,
    payload: file
  }
}

/**
 * The pick has to reach the model as text, because nothing else tells it a base was attached: the
 * `data-knowledge-scope` part only gates which bases the kb_* tools accept, and it is dropped before
 * the model ever sees the message. Left unsaid, the model falls back to the kb_* tools' own
 * descriptions, which are deliberately conservative ("use this when the user references *my
 * notes*") — so it skips retrieval until the user says the words out loud.
 *
 * It states the fact and points at the tool family, but names no individual tool and gives no
 * timing. Two reasons. "The user attached knowledge base X" IS the user referencing their own
 * materials, so it *satisfies* that conservative condition rather than arguing with it — the tool
 * descriptions (tuned against EnterpriseRAG-Bench) stay the single place deciding when to retrieve.
 * And which tool comes next is genuinely open: `kb_read` and `kb_list` are as often right as
 * `kb_search`, so pinning one here would narrow the model for no gain.
 *
 * The id is load-bearing, not decoration — every kb_* tool addresses a base by id, and `kb_search`
 * requires a non-empty `baseIds` documented as "picked from the result of kb_list", so carrying it
 * here saves an otherwise mandatory kb_list round-trip.
 *
 * Each picked base contributes its own sentence (chips serialize independently, separated by the
 * space the editor inserts after each one), so this must stay short and self-contained.
 */
export function knowledgeBaseToComposerToken(base: KnowledgeBase): ComposerDraftToken {
  return {
    id: composerKnowledgeBaseTokenId(base),
    kind: 'knowledge',
    label: base.name,
    promptText: `The user attached knowledge base "${base.name}" (id: ${base.id}) — use that id with the kb_* tools.`,
    payload: base
  }
}

export function getComposerTokenIds(tokens: readonly ComposerSerializedToken[], kind?: ComposerDraftToken['kind']) {
  return new Set(tokens.filter((token) => !kind || token.kind === kind).map((token) => token.id))
}

export function hasComposerToken(tokens: readonly ComposerSerializedToken[], id: string) {
  return tokens.some((token) => token.id === id)
}
