import { cacheService } from '@data/CacheService'
import type { FileMetadata } from '@renderer/types/file'

/**
 * @deprecated Slated for v2 redesign — do not extend.
 *
 * Only `getFileUrl` remains for paintings image rendering. Move it to focused
 * renderer/shared file utilities as its consumers migrate.
 *
 * Do not add new call sites — write straight to File IPC
 * (`window.api.file.createInternalEntry` etc.) from new code.
 */
class FileManager {
  static getFileUrl(file: FileMetadata) {
    const filesPath = cacheService.get('app.path.files') ?? ''
    return 'file://' + filesPath + '/' + file.name
  }
}

export default FileManager
