import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { getComposerTextFromParts } from '@renderer/utils/message/composerTokens'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'

import { createComposerUserMessageParts, trimComposerDraftBoundaryBlankLines } from '../../composerDraft'
import type { ComposerSerializedDraft } from '../../tokens'
import { getComposerTokenIds } from './composerTokens'

interface BuildComposerQueuedPayloadOptions {
  /** Files currently held by the composer; filtered down to those still present as draft tokens. */
  files: ComposerAttachment[]
  /** Maps a file to its composer token id (variant-specific namespace). */
  fileTokenId: (file: ComposerAttachment) => string
  /**
   * When true, textual content is required even when files are attached.
   * When false, a file-only draft is allowed.
   */
  requireText?: boolean
  /** Variant-specific extra payload fields (chat: `mentionedModels` + `reasoningEffort`). */
  extra?: (tokenIds: Set<string>, attachedFiles: ComposerAttachment[]) => Partial<ComposerQueuedMessagePayload>
}

/**
 * Shared spine for turning a serialized composer draft into a queued message payload:
 * trims boundary blank lines, filters attached files by the draft's token ids, and
 * builds the text part. The attachments are carried as-is; the `FileEntry` + file
 * parts are created at send time via `buildFilePartsForAttachments`. Variant-specific
 * fields are layered on via `extra`.
 */
export function buildComposerQueuedPayload(
  draft: ComposerSerializedDraft,
  { files, fileTokenId, requireText = false, extra }: BuildComposerQueuedPayloadOptions
): ComposerQueuedMessagePayload | null {
  const normalizedDraft = trimComposerDraftBoundaryBlankLines(draft)
  const hasText = normalizedDraft.text.trim().length > 0
  const text = hasText ? normalizedDraft.text : ''
  const tokenIds = getComposerTokenIds(normalizedDraft.tokens)
  const attachedFiles = files.filter((file) => tokenIds.has(fileTokenId(file)))
  if (hasUnsyncedComposerAttachments(files, attachedFiles)) return null
  if (requireText ? !hasText : !hasText && attachedFiles.length === 0) return null

  const userMessageParts = createComposerUserMessageParts(normalizedDraft)

  return {
    text,
    attachments: attachedFiles.length ? (attachedFiles as unknown as Array<Record<string, unknown>>) : undefined,
    userMessageParts,
    ...extra?.(tokenIds, attachedFiles)
  }
}

/**
 * The text an input-history entry should carry. History persists a bare string and replays it as
 * `{ text, tokens: [] }`, so a knowledge token's sentence would come back as ordinary prose: a claim
 * that a base is attached, naming an id the kb_* tools will reject, with no `data-knowledge-scope`
 * left to authorize it — and an empty scope reads as "no narrowing" and widens to the assistant's
 * full binding. Every other kind's prompt text is self-contained (a skill's `Use the X skill.` needs
 * no accompanying part), so it survives verbatim.
 *
 * The identity mapper is load-bearing twice over: the default one rewrites tokens to clipboard
 * markers, and returning anything but `''` for a token without prompt text would insert text at an
 * offset the span never occupied.
 */
export function getComposerHistoryText(userMessageParts: CherryMessagePart[]): string {
  return getComposerTextFromParts(userMessageParts, (token) =>
    token.kind === 'knowledge' ? '' : (token.promptText ?? '')
  )
}

export function hasUnsyncedComposerAttachments(files: ComposerAttachment[], attachedFiles: ComposerAttachment[]) {
  return attachedFiles.length !== files.length
}
