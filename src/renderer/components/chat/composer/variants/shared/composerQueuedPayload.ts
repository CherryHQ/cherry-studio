import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import type { ComposerQueuedMessagePayload } from '@shared/ai/transport'

import { createComposerUserMessageParts } from '../../composerDraft'
import type { ComposerSerializedDraft } from '../../tokens'
import { getComposerTokenIds } from './composerTokens'

interface BuildComposerQueuedPayloadOptions {
  /** Files currently held by the composer; filtered down to those still present as draft tokens. */
  files: ComposerAttachment[]
  /** Maps a file to its composer token id (variant-specific namespace). */
  fileTokenId: (file: ComposerAttachment) => string
  /**
   * When true, an empty trimmed text yields `null` (chat — text is mandatory).
   * When false, a file-only draft is allowed (agent).
   */
  requireText?: boolean
  /** Variant-specific extra payload fields (chat: `mentionedModels` + `knowledgeBaseIds`). */
  extra?: (tokenIds: Set<string>, attachedFiles: ComposerAttachment[]) => Partial<ComposerQueuedMessagePayload>
}

/**
 * Shared spine for turning a serialized composer draft into a queued message payload:
 * trims the text, filters attached files by the draft's token ids, and builds the text
 * part. The attachments are carried as-is; the `FileEntry` + file parts are created at
 * send time via `buildFilePartsForAttachments`. Variant-specific fields are layered on
 * via `extra`.
 */
export function buildComposerQueuedPayload(
  draft: ComposerSerializedDraft,
  { files, fileTokenId, requireText = false, extra }: BuildComposerQueuedPayloadOptions
): ComposerQueuedMessagePayload | null {
  const text = draft.text.trim()
  if (requireText ? !text : !text && files.length === 0) return null

  const tokenIds = getComposerTokenIds(draft.tokens)
  const attachedFiles = files.filter((file) => tokenIds.has(fileTokenId(file)))
  const userMessageParts = createComposerUserMessageParts(draft)

  return {
    text,
    attachments: attachedFiles.length ? (attachedFiles as unknown as Array<Record<string, unknown>>) : undefined,
    userMessageParts,
    ...extra?.(tokenIds, attachedFiles)
  }
}
