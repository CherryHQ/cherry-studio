/** Resolve an entity-image file entry to a renderer-ready file URL. */

import { application } from '@application'
import type { FileUrlString } from '@shared/types/file'

export function resolveEntityImageSrc(fileId: string | null | undefined): FileUrlString | undefined {
  return fileId ? application.get('FileManager').getUrl(fileId) : undefined
}
