import type { ComposerFileKind, FileMetadata, FileType } from '@renderer/types'
import {
  createComposerFileTokenSourceId,
  getComposerFileTokenSourceId
} from '@renderer/utils/messageUtils/composerFileTokenSource'

/**
 * Lean, composer-owned v2 attachment descriptor. Replaces legacy `FileMetadata`
 * inside composer state / tokens / UI / send. Carries only the fields the
 * composer, tokens, attachment UI, and the send-time `FileEntry` bridge
 * (`buildFilePartsForAttachments`) actually read.
 *
 * `fileTokenSourceId` is the stable identity: it maps to the composer file
 * token id `file:<sourceId>`. The v2 `FileEntry` is created at send time, so the
 * attachment never holds an entry id while it lives in the composer.
 */
export interface ComposerAttachment {
  /** Identity → token id `file:<sourceId>`. */
  fileTokenSourceId: string
  /** Temp-or-real absolute path; used at send (`createInternalEntry source:'path'`) + image preview. */
  path: string
  name: string
  /** Display label. */
  origin_name: string
  /** File extension (includes the leading dot). Type label + mediaType hint. */
  ext: string
  /** Size in bytes. Tooltip. */
  size: number
  /** File type → icon / variant (FILE_TYPE). */
  type: FileType
  /** Pasted-text marker (existing composer-only kind). */
  composerFileKind?: ComposerFileKind
}

/**
 * Project a legacy `FileMetadata` (produced by the file IPC layer) onto a lean
 * `ComposerAttachment` at the producer boundary so `FileMetadata` never enters
 * composer state. Reuses a valid existing `fileTokenSourceId`, otherwise mints one.
 */
export function toComposerAttachment(meta: FileMetadata): ComposerAttachment {
  return {
    fileTokenSourceId: getComposerFileTokenSourceId(meta) ?? createComposerFileTokenSourceId(),
    path: meta.path,
    name: meta.name,
    origin_name: meta.origin_name,
    ext: meta.ext,
    size: meta.size,
    type: meta.type,
    ...(meta.composerFileKind && { composerFileKind: meta.composerFileKind })
  }
}

export function toComposerAttachments(metas: readonly FileMetadata[]): ComposerAttachment[] {
  return metas.map(toComposerAttachment)
}
