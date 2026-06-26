import { cacheService } from '@data/CacheService'
import i18n from '@renderer/i18n'
import type { FileMetadata } from '@renderer/types/file'
import { getFileDirectory } from '@renderer/utils/file'
import dayjs from 'dayjs'

/**
 * @deprecated Slated for v2 redesign — do not extend.
 *
 * Only legacy utility helpers with current renderer consumers remain here:
 * `getSafePath` / `formatFileName` for chat attachment rendering and
 * `getFileUrl` for paintings image rendering. Move these helpers to focused
 * renderer/shared file utilities as their consumers migrate.
 *
 * Do not add new call sites — write straight to File IPC
 * (`window.api.file.createInternalEntry` etc.) from new code.
 */
class FileManager {
  static isDangerFile(file: FileMetadata) {
    return ['.sh', '.bat', '.cmd', '.ps1', '.vbs', 'reg'].includes(file.ext)
  }

  static getSafePath(file: FileMetadata) {
    // use the path from the file metadata instead
    // this function is used to get path for files which are not in the filestorage
    return this.isDangerFile(file) ? getFileDirectory(file.path) : file.path
  }

  static getFileUrl(file: FileMetadata) {
    const filesPath = cacheService.get('app.path.files') ?? ''
    return 'file://' + filesPath + '/' + file.name
  }

  static formatFileName(file: FileMetadata) {
    if (!file || !file.origin_name) {
      return ''
    }

    const date = dayjs(file.created_at).format('YYYY-MM-DD')

    if (file.origin_name.includes('pasted_text')) {
      return date + ' ' + i18n.t('message.attachments.pasted_text') + file.ext
    }

    if (file.origin_name.startsWith('temp_file') && file.origin_name.includes('image')) {
      return date + ' ' + i18n.t('message.attachments.pasted_image') + file.ext
    }

    return file.origin_name
  }
}

export default FileManager
