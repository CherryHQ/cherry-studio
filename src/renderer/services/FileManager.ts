import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import type { FileMetadata } from '@renderer/types'
import { getFileDirectory } from '@renderer/utils'
import dayjs from 'dayjs'

const logger = loggerService.withContext('FileManager')

/**
 * @deprecated Slated for deletion — do not add new call sites.
 *
 * v2 moves all file state to the main process; the renderer no longer
 * needs a stateful "manager" — IPC is the service. Replacement targets:
 *
 * - **React components** → TanStack Query hooks (e.g. `useFileEntry(id)`)
 * - **Imperative code** (thunks, callbacks) → `window.api.file.*` directly
 * - **Display logic** → pure utilities in `@renderer/utils/file`
 *
 * See each method's JSDoc for its specific v2 replacement.
 */
class FileManager {
  /** @deprecated Dead code (0 callers). v2: `window.api.file.openSelectDialog(options)` */
  static async selectFiles(options?: Electron.OpenDialogOptions): Promise<FileMetadata[] | null> {
    return await window.api.legacyFile.select(options)
  }

  /**
   * @deprecated v2: **delete the call site** — db writes are now main-side.
   *
   * The only real consumer is `imageCallbacks`. In that context, replacing
   * `saveBase64Image` with `window.api.file.createInternalEntry` already
   * creates the `file_entry` on the main side — the separate `addFile`
   * step becomes redundant and should simply be removed.
   */
  static async addFile(file: FileMetadata): Promise<FileMetadata> {
    const fileRecord = await db.files.get(file.id)

    if (fileRecord) {
      await db.files.update(fileRecord.id, { ...fileRecord, count: fileRecord.count + 1 })
      return fileRecord
    }

    await db.files.add(file)

    return file
  }

  /** @deprecated v2: **delete the call site** — more callers than `addFile` but similar migration path. See {@link addFile}. */
  static async addFiles(files: FileMetadata[]): Promise<FileMetadata[]> {
    return Promise.all(files.map((file) => this.addFile(file)))
  }

  /** @deprecated Dead code (0 callers). v2: `window.api.file.read(id, { encoding: 'binary' })` */
  static async readBinaryImage(file: FileMetadata): Promise<Buffer> {
    const fileData = await window.api.legacyFile.binaryImage(file.id + file.ext)
    return fileData.data
  }

  /** @deprecated Dead code (0 callers). v2: `window.api.file.read(id, { encoding: 'base64' })` */
  static async readBase64File(file: FileMetadata): Promise<string> {
    const fileData = await window.api.legacyFile.base64File(file.id + file.ext)
    return fileData.data
  }

  /** @deprecated Dead code (0 callers). v2: `window.api.file.createInternalEntry({ source: 'base64' })` + `fileRefService.create(...)` */
  static async addBase64File(file: FileMetadata): Promise<FileMetadata> {
    logger.info(`Adding base64 file: ${JSON.stringify(file)}`)

    const base64File = await window.api.legacyFile.base64File(file.id + file.ext)
    const fileRecord = await db.files.get(base64File.id)

    if (fileRecord) {
      await db.files.update(fileRecord.id, { ...fileRecord, count: fileRecord.count + 1 })
      return fileRecord
    }

    await db.files.add(base64File)

    return base64File
  }

  /**
   * @deprecated v2: `window.api.file.createInternalEntry({ source: 'path' })` + `fileRefService.create(...)`
   *
   * v2 handles disk copy + entry creation in one IPC call; no separate
   * "upload then record" step.
   */
  static async uploadFile(file: FileMetadata): Promise<FileMetadata> {
    logger.info(`Uploading file: ${JSON.stringify(file)}`)

    const uploadFile = await window.api.legacyFile.upload(file)
    logger.info('Uploaded file:', uploadFile)
    const fileRecord = await db.files.get(uploadFile.id)

    if (fileRecord) {
      await db.files.update(fileRecord.id, { ...fileRecord, count: fileRecord.count + 1 })
      return fileRecord
    }

    await db.files.add(uploadFile)

    return uploadFile
  }

  /** @deprecated v2: `window.api.file.batchCreateInternalEntries(...)` + batch ref. See {@link uploadFile}. */
  static async uploadFiles(files: FileMetadata[]): Promise<FileMetadata[]> {
    return Promise.all(files.map((file) => this.uploadFile(file)))
  }

  /**
   * @deprecated v2: `window.api.file.getMetadata(id)` or DataApi `GET /files/entries/:id`
   *
   * v1 reads Dexie + runtime-patches `path`. v2 returns `FileEntry` from
   * SQLite; use `window.api.file.getPhysicalPath(id)` if you need the path.
   */
  static async getFile(id: string): Promise<FileMetadata | undefined> {
    const file = await db.files.get(id)

    if (file) {
      const filesPath = cacheService.get('app.path.files') ?? ''
      file.path = filesPath + '/' + file.id + file.ext
    }

    return file
  }

  /**
   * @deprecated v2: `window.api.file.getPhysicalPath(id)`
   *
   * Renderer must not construct physical paths from `id + ext` — the
   * storage layout is a main-side concern.
   */
  static getFilePath(file: FileMetadata) {
    const filesPath = cacheService.get('app.path.files') ?? ''
    return filesPath + '/' + file.id + file.ext
  }

  /**
   * @deprecated
   * - `force=false`: `fileRefService.delete(sourceType, sourceId, entryId)` —
   *   ref removal only; OrphanRefScanner handles cleanup at zero refs.
   * - `force=true`: `window.api.file.permanentDelete(id)` — immediate
   *   physical deletion regardless of refs.
   */
  static async deleteFile(id: string, force: boolean = false): Promise<void> {
    const file = await this.getFile(id)

    logger.info('Deleting file:', file)

    if (!file) {
      return
    }

    if (!force) {
      if (file.count > 1) {
        await db.files.update(id, { ...file, count: file.count - 1 })
        return
      }
    }

    await db.files.delete(id)

    try {
      await window.api.legacyFile.delete(id + file.ext)
    } catch (error) {
      logger.error('Failed to delete file:', error as Error)
    }
  }

  /** @deprecated v2: `fileRefService.cleanupBySource(sourceType, sourceId)` or `window.api.file.batchPermanentDelete(ids)` depending on force semantics. */
  static async deleteFiles(files: FileMetadata[]): Promise<void> {
    if (!files || files.length === 0) return

    const results = await Promise.allSettled(files.map((file) => this.deleteFile(file.id)))

    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      logger.warn(`File deletions completed with ${failed.length} files failed to delete:`, failed)
    }
  }

  /** @deprecated Dead code (0 callers). v2: DataApi `GET /files/entries` */
  static async allFiles(): Promise<FileMetadata[]> {
    return db.files.toArray()
  }

  /** @deprecated Dead code (0 callers). v2: `isDangerExt(ext)` from `@shared/file/urlUtil` */
  static isDangerFile(file: FileMetadata) {
    return ['.sh', '.bat', '.cmd', '.ps1', '.vbs', 'reg'].includes(file.ext)
  }

  /** @deprecated v2: `toSafeFileUrl(path, ext)` from `@shared/file/urlUtil` — already implemented with a more complete dangerous-ext list. */
  static getSafePath(file: FileMetadata) {
    // use the path from the file metadata instead
    // this function is used to get path for files which are not in the filestorage
    return this.isDangerFile(file) ? getFileDirectory(file.path) : file.path
  }

  /** @deprecated v2: `window.api.file.getPhysicalPath(id)` + `toFileUrl()` from `@shared/file/urlUtil` */
  static getFileUrl(file: FileMetadata) {
    const filesPath = cacheService.get('app.path.files') ?? ''
    return 'file://' + filesPath + '/' + file.name
  }

  /** @deprecated v2: `window.api.file.rename(id, newName)` — only caller is the rename handler. */
  static async updateFile(file: FileMetadata) {
    if (!file.origin_name.includes(file.ext)) {
      file.origin_name = file.origin_name + file.ext
    }

    await db.files.update(file.id, file)
  }

  /** @deprecated v2: move to `@renderer/utils/file` with `FileEntry` input — change `file.origin_name` to `entry.name + entry.ext`. */
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
