import type { FileMetadata } from '@renderer/types/file'
import { FilePathSchema, type FileUrlString } from '@shared/types/file'
import { toSafeFileUrl } from '@shared/utils/file'

type PaintingFileUrlSource = Pick<FileMetadata, 'path' | 'ext'>

/**
 * Build a renderable URL for painting outputs while the painting state still
 * carries v1 `FileMetadata`. The path itself is resolved by main process via
 * `getPhysicalPath`; renderer only applies shared file-url formatting/safety.
 */
export function getPaintingFileUrl(file: PaintingFileUrlSource): FileUrlString | undefined {
  if (!file.path) return undefined
  const parsedPath = FilePathSchema.safeParse(file.path)
  if (!parsedPath.success) return undefined
  return toSafeFileUrl(parsedPath.data, file.ext || null)
}
