import { getFileType, stat as fsStat } from '@main/utils/file'
import type { FilePath, PhysicalFileMetadata } from '@shared/types/file'
import mime from 'mime'

type FsStatResult = Awaited<ReturnType<typeof fsStat>>

/**
 * Map an already-obtained stat result for `path` onto the shared
 * `PhysicalFileMetadata` shape. Both the path-arm (`getMetadataByPath`) and the
 * entry-arm (`FileManager.getMetadata`) funnel through here, so kind/type/mime
 * derivation — and any future per-kind enrichment — lives in ONE place. The
 * caller supplies the stat, so each keeps its own read semantics (a plain read
 * here vs. FileManager's external-access-observed read).
 *
 * **Module-internal**: shared across the file module via relative import only;
 * the barrel deliberately re-exports just `getMetadataByPath` (the public
 * path-arm), never this helper.
 */
export async function buildPhysicalFileMetadata(path: FilePath, s: FsStatResult): Promise<PhysicalFileMetadata> {
  if (s.isDirectory) {
    return { kind: 'directory', size: s.size, createdAt: s.createdAt || s.modifiedAt, modifiedAt: s.modifiedAt }
  }
  // Extension-derived type, with a content sniff upgrading extension-unknown
  // files to text (see `@main/utils/file/metadata`). Every per-type enrichment
  // field (width/height/pageCount/encoding) is optional, so this base object —
  // which omits them all — is assignable to the `PhysicalFileMetadata` union for
  // whichever `type` getFileType returns, without a cast.
  return {
    kind: 'file',
    type: await getFileType(path),
    size: s.size,
    createdAt: s.createdAt || s.modifiedAt,
    modifiedAt: s.modifiedAt,
    mime: mime.getType(path) ?? 'application/octet-stream'
  }
}

/**
 * Path-arm metadata read for file-module IPC adapters.
 *
 * This is higher-level than `@main/utils/file/fs.stat`: it returns the shared
 * `PhysicalFileMetadata` shape and applies file-module MIME defaults, but it
 * deliberately has no FileEntry/DanglingCache side effects. Entry-aware callers
 * should use `FileManager.getMetadata(entryId)` instead.
 */
export async function getMetadataByPath(path: FilePath): Promise<PhysicalFileMetadata> {
  return buildPhysicalFileMetadata(path, await fsStat(path))
}
