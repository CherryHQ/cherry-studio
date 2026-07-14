import { stat as fsStat } from '@main/utils/file'
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
  return {
    kind: 'file',
    type: 'other',
    size: s.size,
    createdAt: s.createdAt || s.modifiedAt,
    modifiedAt: s.modifiedAt,
    mime: mime.getType(path) ?? 'application/octet-stream'
  }
}
