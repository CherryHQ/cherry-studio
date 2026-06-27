import type { FileMetadata } from '@renderer/types/file'
import type { FilePath, FileUrlString } from '@shared/types/file'
import { toSafeFileUrl } from '@shared/utils/file'

type PaintingFileUrlSource = Pick<FileMetadata, 'path' | 'ext'>

/**
 * Build a renderable URL for painting outputs while the painting state still
 * carries v1 `FileMetadata`. The path itself is resolved by main process via
 * `getPhysicalPath`; renderer only applies shared file-url formatting/safety.
 */
export function getPaintingFileUrl(file: PaintingFileUrlSource): FileUrlString | '' {
  if (!file.path) return ''
  return toSafeFileUrl(file.path as FilePath, file.ext || null)
}
