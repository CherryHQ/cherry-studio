import { stat as fsStat } from '@main/utils/file'
import { getFileType } from '@main/utils/file/metadata'
import type { FilePath, PhysicalFileMetadata } from '@shared/types/file'
import mime from 'mime'

/**
 * Path-arm metadata read for file-module IPC adapters.
 *
 * This is higher-level than `@main/utils/file/fs.stat`: it returns the shared
 * `PhysicalFileMetadata` shape and applies file-module MIME defaults, but it
 * deliberately has no FileEntry/DanglingCache side effects. Entry-aware callers
 * should use `FileManager.getMetadata(entryId)` instead.
 */
export async function getMetadataByPath(path: FilePath): Promise<PhysicalFileMetadata> {
  const s = await fsStat(path)
  if (s.isDirectory) {
    return { kind: 'directory', size: s.size, createdAt: s.createdAt || s.modifiedAt, modifiedAt: s.modifiedAt }
  }
  // Extension-derived type, with a content sniff upgrading extension-unknown
  // files to text (see `@main/utils/file/metadata`). Every per-type enrichment
  // field (width/height/pageCount/encoding) is optional, so this base object is
  // a valid `PhysicalFileMetadata` for whichever `type` getFileType returns —
  // the cast just tells TS which discriminated member without listing them all.
  return {
    kind: 'file',
    type: await getFileType(path),
    size: s.size,
    createdAt: s.createdAt || s.modifiedAt,
    modifiedAt: s.modifiedAt,
    mime: mime.getType(path) ?? 'application/octet-stream'
  } as PhysicalFileMetadata
}
