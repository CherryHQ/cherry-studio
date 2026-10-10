import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types/file'
import { AbsoluteFilePathSchema, type FileUrlString } from '@shared/types/file'
import { toSafeFileUrl } from '@shared/utils/file'

const logger = loggerService.withContext('paintingFileUrl')

// `getPaintingFileUrl` runs on every painting render; dedupe the warn per
// offending path so a bad path can't flood the log across rerenders.
const warnedPaintingPaths = new Set<string>()

type PaintingFileUrlSource = Pick<FileMetadata, 'path' | 'ext'>

/**
 * Build a renderable URL for painting outputs while the painting state still
 * carries v1 `FileMetadata`. The path itself is resolved by main process via
 * `getPhysicalPath`; renderer only applies shared file-url formatting/safety.
 */
export function getPaintingFileUrl(file: PaintingFileUrlSource): FileUrlString | undefined {
  if (!file.path) return undefined
  const parsedPath = AbsoluteFilePathSchema.safeParse(file.path)
  if (!parsedPath.success) {
    if (!warnedPaintingPaths.has(file.path)) {
      warnedPaintingPaths.add(file.path)
      logger.warn('getPaintingFileUrl: non-canonical/invalid painting path', { path: file.path })
    }
    return undefined
  }
  return toSafeFileUrl(parsedPath.data, file.ext || null)
}
