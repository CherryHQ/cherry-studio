import * as fs from 'fs'
import { writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import * as path from 'path'

import type { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from 'electron'
import { BrowserWindow, dialog, shell } from 'electron'
import { v4 as uuidv4 } from 'uuid'

/**
 * @deprecated LEGACY v1 CODE — being migrated to `FileManager`
 * (`src/main/services/file/FileManager.ts`). This file will be DELETED once
 * the migration is complete.
 *
 * Do NOT add new features or new call sites here — route new file
 * functionality through `FileManager` instead. Existing consumers should be
 * migrated off this module as part of the ongoing migration.
 */
/* eslint-disable filepath-brand/no-as-filepath -- v1 raw-path regime: every
 * public method here takes a bare `string` path straight from legacy IPC or an
 * Electron dialog, with no validation layer of its own. Introducing
 * `AbsoluteFilePathSchema.parse()` would add new throw sites to a module that is
 * already `@deprecated` and slated for deletion, changing v1 behavior instead of
 * migrating it. The casts only feed `getFileType` (extension reads). */
import { application } from '@application'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import { assertOutsideManagedStorageMutation } from '@main/services/file'
import {
  assertNotesPathNotMutatingDuringMigration,
  assertNotesPathNotRetired,
  beginNotesBatchMarkdownUpload,
  endNotesBatchMarkdownUpload,
  isAllowedNotesDirectory,
  isNotesMigrationWriteBlockedError,
  isNotesRetiredRootWriteError,
  isNotesRootUnresolvedError,
  withNotesFilesystemMutation
} from '@main/services/notesRelocation'
import { getFileType } from '@main/utils/file'
import { extractLegacyDocText } from '@main/utils/legacyDoc'
import { checkName, getName, readTextFileWithAutoEncoding, sanitizeFilename } from '@main/utils/legacyFile'
import type { FileMetadata } from '@shared/data/types/legacyFile'
import type { AbsoluteFilePath } from '@shared/types/file'
import { parseDataUrl } from '@shared/utils/dataUrl'
import { documentExts } from '@shared/utils/file'

const logger = loggerService.withContext('FileStorage')

function normalizeTrashPath(filePath: string): string {
  return process.platform === 'win32' ? path.win32.normalize(filePath) : path.posix.normalize(filePath)
}

// Missing or destroyed sender window falls back to the unparented overload.
function resolveSaveDialogParent(event: Electron.IpcMainInvokeEvent): Electron.BrowserWindow | undefined {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window && !window.isDestroyed() ? window : undefined
}

class FileStorage {
  // TODO(v2): Lazy getter is a workaround, not a fix.
  //
  // The real problem is that `FileStorage` is exported as a top-level
  // singleton at the bottom of this file
  // (`export const fileStorage = new FileStorage()`). That singleton is
  // instantiated during the static import graph of `src/main/main.ts`
  // (via both `ipc.ts` and the `ApiGatewayService → ApiGateway → routes
  // → KnowledgeService` chain), BEFORE `application.bootstrap()` runs
  // and builds the path registry. The previous shape used field
  // initializers (`private storageDir = application.getPath(...)`),
  // which threw "PATHS not initialized" at module-load time.
  //
  // Lazy getters defer the path lookup until first *access*, by which
  // point bootstrap has finished — but the class itself is still being
  // constructed too early. We've merely moved the path lookup out of
  // construction; we have NOT solved the architectural issue.
  //
  // The proper v2 fix is to migrate `FileStorage` into the lifecycle
  // system: extend `BaseService`, add `@Injectable`, register in
  // `serviceRegistry.ts`, and have callers resolve it via
  // `application.get('FileStorage')` instead of importing the singleton.
  // Once that's done, the DI container will instantiate it inside
  // `application.bootstrap()` after the path registry is built, and
  // these getters can become plain field initializers (or move into
  // `onInit`). Until then, keep them as getters — do NOT "simplify"
  // them back to fields.
  private get storageDir(): string {
    return application.getPath('feature.files.data')
  }

  /**
   * Resolves an id that arrived from the renderer to a path inside the storage
   * directory. `path.join` would happily normalize `..`, so an unvalidated id
   * could read or delete any file the app can reach.
   */
  private resolveStoredPath(id: string): string {
    const root = path.resolve(this.storageDir)
    const resolved = path.resolve(root, id)
    if (resolved === root || !resolved.startsWith(root + path.sep)) {
      throw new Error(`Invalid stored file id: ${id}`)
    }
    return resolved
  }

  private get tempDir(): string {
    return application.getPath('app.temp')
  }

  public selectFile = async (
    _: Electron.IpcMainInvokeEvent,
    options?: OpenDialogOptions
  ): Promise<FileMetadata[] | null> => {
    const defaultOptions: OpenDialogOptions = {
      properties: ['openFile']
    }

    const dialogOptions = { ...defaultOptions, ...options }

    const result = await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const fileMetadataPromises = result.filePaths.map(async (filePath) => {
      const stats = fs.statSync(filePath)
      const ext = path.extname(filePath)
      const fileType = await getFileType(filePath as AbsoluteFilePath)

      return {
        id: uuidv4(),
        origin_name: path.basename(filePath),
        name: path.basename(filePath),
        path: filePath,
        created_at: stats.birthtime.toISOString(),
        size: stats.size,
        ext: ext,
        type: fileType,
        count: 1
      }
    })

    return Promise.all(fileMetadataPromises)
  }

  public getFile = async (_: Electron.IpcMainInvokeEvent, filePath: string): Promise<FileMetadata | null> => {
    if (!fs.existsSync(filePath)) {
      return null
    }

    const stats = fs.statSync(filePath)
    const fileType = await getFileType(filePath as AbsoluteFilePath)

    return {
      id: uuidv4(),
      origin_name: path.basename(filePath),
      name: path.basename(filePath),
      path: filePath,
      created_at: stats.birthtime.toISOString(),
      size: stats.size,
      ext: path.extname(filePath),
      type: fileType,
      count: 1
    }
  }

  // Trash is unavailable in some environments (e.g. Flatpak); fall back to permanent removal.
  private trashOrRemove = async (nativePath: string): Promise<void> => {
    try {
      await shell.trashItem(nativePath)
    } catch (error) {
      logger.warn(`Failed to move item to trash, deleting permanently: ${nativePath}`, error as Error)
      await fs.promises.rm(nativePath, { recursive: true, force: true })
    }
  }

  public deleteExternalFile = async (_: Electron.IpcMainInvokeEvent, filePath: string): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      try {
        if (!filePath) return

        const nativePath = normalizeTrashPath(filePath)
        await assertOutsideManagedStorageMutation(nativePath)
        assertNotesPathNotMutatingDuringMigration(nativePath)
        assertNotesPathNotRetired(nativePath)
        if (!fs.existsSync(nativePath)) {
          return
        }

        await this.trashOrRemove(nativePath)
        logger.debug(`External file moved to trash successfully: ${nativePath}`)
      } catch (error) {
        logger.error('Failed to delete external file:', error as Error)
        throw error
      }
    })

  public deleteExternalDir = async (_: Electron.IpcMainInvokeEvent, dirPath: string): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      try {
        if (!dirPath) return

        const nativePath = normalizeTrashPath(dirPath)
        await assertOutsideManagedStorageMutation(nativePath)
        assertNotesPathNotMutatingDuringMigration(nativePath)
        assertNotesPathNotRetired(nativePath)
        if (!fs.existsSync(nativePath)) {
          return
        }

        await this.trashOrRemove(nativePath)
        logger.debug(`External directory moved to trash successfully: ${nativePath}`)
      } catch (error) {
        logger.error('Failed to delete external directory:', error as Error)
        throw error
      }
    })

  public moveFile = async (_: Electron.IpcMainInvokeEvent, filePath: string, newPath: string): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      try {
        await assertOutsideManagedStorageMutation(filePath, newPath)
        assertNotesPathNotMutatingDuringMigration(filePath)
        assertNotesPathNotMutatingDuringMigration(newPath)
        assertNotesPathNotRetired(filePath)
        assertNotesPathNotRetired(newPath)
        if (!fs.existsSync(filePath)) {
          throw new Error(`Source file does not exist: ${filePath}`)
        }

        const destDir = path.dirname(newPath)
        if (!fs.existsSync(destDir)) {
          await fs.promises.mkdir(destDir, { recursive: true })
        }

        await fs.promises.rename(filePath, newPath)
        logger.debug(`File moved successfully: ${filePath} to ${newPath}`)
      } catch (error) {
        logger.error('Move file failed:', error as Error)
        throw error
      }
    })

  public moveDir = async (_: Electron.IpcMainInvokeEvent, dirPath: string, newDirPath: string): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      try {
        await assertOutsideManagedStorageMutation(dirPath, newDirPath)
        assertNotesPathNotMutatingDuringMigration(dirPath)
        assertNotesPathNotMutatingDuringMigration(newDirPath)
        assertNotesPathNotRetired(dirPath)
        assertNotesPathNotRetired(newDirPath)
        if (!fs.existsSync(dirPath)) {
          throw new Error(`Source directory does not exist: ${dirPath}`)
        }

        const parentDir = path.dirname(newDirPath)
        if (!fs.existsSync(parentDir)) {
          await fs.promises.mkdir(parentDir, { recursive: true })
        }

        await fs.promises.rename(dirPath, newDirPath)
        logger.debug(`Directory moved successfully: ${dirPath} to ${newDirPath}`)
      } catch (error) {
        logger.error('Move directory failed:', error as Error)
        throw error
      }
    })

  public renameFile = async (_: Electron.IpcMainInvokeEvent, filePath: string, newName: string): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      try {
        if (!fs.existsSync(filePath)) {
          throw new Error(`Source file does not exist: ${filePath}`)
        }

        const dirPath = path.dirname(filePath)
        const newFilePath = path.join(dirPath, newName + '.md')
        await assertOutsideManagedStorageMutation(filePath, newFilePath)
        assertNotesPathNotMutatingDuringMigration(filePath)
        assertNotesPathNotMutatingDuringMigration(newFilePath)
        assertNotesPathNotRetired(filePath)
        assertNotesPathNotRetired(newFilePath)

        if (fs.existsSync(newFilePath)) {
          throw new Error(`Target file already exists: ${newFilePath}`)
        }

        await fs.promises.rename(filePath, newFilePath)
        logger.debug(`File renamed successfully: ${filePath} to ${newFilePath}`)
      } catch (error) {
        logger.error('Rename file failed:', error as Error)
        throw error
      }
    })

  public renameDir = async (_: Electron.IpcMainInvokeEvent, dirPath: string, newName: string): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      try {
        if (!fs.existsSync(dirPath)) {
          throw new Error(`Source directory does not exist: ${dirPath}`)
        }

        const parentDir = path.dirname(dirPath)
        const newDirPath = path.join(parentDir, newName)
        await assertOutsideManagedStorageMutation(dirPath, newDirPath)
        assertNotesPathNotMutatingDuringMigration(dirPath)
        assertNotesPathNotMutatingDuringMigration(newDirPath)
        assertNotesPathNotRetired(dirPath)
        assertNotesPathNotRetired(newDirPath)

        if (fs.existsSync(newDirPath)) {
          throw new Error(`Target directory already exists: ${newDirPath}`)
        }

        await fs.promises.rename(dirPath, newDirPath)
        logger.debug(`Directory renamed successfully: ${dirPath} to ${newDirPath}`)
      } catch (error) {
        logger.error('Rename directory failed:', error as Error)
        throw error
      }
    })

  /**
   * Core file reading logic that handles both documents and text files.
   *
   * @private
   * @param filePath - Full path to the file
   * @param detectEncoding - Whether to auto-detect text file encoding
   * @returns Promise resolving to the extracted text content
   * @throws Error if file reading fails
   */
  private async readFileCore(filePath: string, detectEncoding: boolean = false): Promise<string> {
    const fileExtension = path.extname(filePath).toLowerCase()

    if (documentExts.includes(fileExtension)) {
      try {
        if (fileExtension === '.doc') {
          // Awaited, so a failure reaches the catch below like every other
          // document read here; returning the promise would settle it outside.
          return await extractLegacyDocText(filePath)
        }

        // Delayed loading: officeparser (and the pdf stack it drags in) stays out of the boot path.
        const { default: officeParser } = await import('officeparser')
        const data = await officeParser.parseOfficeAsync(filePath, {
          tempFilesLocation: this.tempDir
        })
        return data
      } catch (error) {
        logger.error('Failed to read document file:', error as Error)
        throw error
      }
    }

    try {
      if (detectEncoding) {
        return readTextFileWithAutoEncoding(filePath)
      } else {
        return await fs.promises.readFile(filePath, 'utf-8')
      }
    } catch (error) {
      logger.error('Failed to read text file:', error as Error)
      throw new Error(`Failed to read file: ${filePath}.`)
    }
  }

  /**
   * Reads and extracts content from an external file path.
   *
   * Similar to readFile, but operates on external file paths instead of stored files.
   * Supports the same file formats including complex documents and text files.
   *
   * @param _ - Electron IPC invoke event (unused)
   * @param filePath - Absolute path to the external file
   * @param detectEncoding - Whether to auto-detect text file encoding (default: false)
   * @returns Promise resolving to the extracted text content of the file
   * @throws Error if file does not exist or reading fails
   *
   * @example
   * // Read an external DOCX file
   * const content = await readExternalFile(event, "/path/to/document.docx");
   *
   * @example
   * // Read an external text file with encoding detection
   * const content = await readExternalFile(event, "/path/to/text.txt", true);
   */
  public readExternalFile = async (
    _: Electron.IpcMainInvokeEvent,
    filePath: string,
    detectEncoding: boolean = false
  ): Promise<string> => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`)
    }

    return this.readFileCore(filePath, detectEncoding)
  }

  public createTempFile = async (_: Electron.IpcMainInvokeEvent, fileName: string): Promise<string> => {
    // `fileName` is renderer-supplied; basename it so a value like `../../evil` can't escape tempDir.
    return path.join(this.tempDir, `temp_file_${uuidv4()}_${path.basename(fileName)}`)
  }

  public writeFile = async (
    _: Electron.IpcMainInvokeEvent,
    filePath: string,
    data: Uint8Array | string
  ): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      await assertOutsideManagedStorageMutation(filePath)
      assertNotesPathNotMutatingDuringMigration(filePath)
      // A raw write admitted before a migration can SETTLE after it (the
      // renderer's legacy import awaits file.text() between admission and
      // this call): revalidate against live canonical provenance so a stale
      // destination in the retired tree fails loudly instead of reporting
      // success for a note the active library will never see.
      assertNotesPathNotRetired(filePath)
      await fs.promises.writeFile(filePath, data)
    })

  /**
   * Export destinations are explicit user-chosen plain-file locations (the
   * configured markdown export folder, save-dialog picks, asset folders next
   * to them) - never library-tree state - so the retired-root guard does not
   * apply. The managed-storage guard and the in-flight migration barrier
   * still do: an export must not land inside managed storage, and it must not
   * race the tree move. Parent directories are created so callers need no
   * separate (guarded) mkdir for a nested export path.
   */
  public exportWrite = async (
    _: Electron.IpcMainInvokeEvent,
    filePath: string,
    data: Uint8Array | string
  ): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      await assertOutsideManagedStorageMutation(filePath)
      assertNotesPathNotMutatingDuringMigration(filePath)
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, data)
    })

  /**
   * Directory-creation sibling of {@link exportWrite} for export destinations
   * (e.g. the `assets/` folder next to an exported .md). Same contract:
   * explicit user-chosen plain-file locations skip the retired-root guard,
   * while managed storage and the in-flight migration barrier still apply.
   * Needed by export paths whose bytes move through `file:copy` - that route
   * copies onto existing parents only.
   */
  public exportMkdir = async (_: Electron.IpcMainInvokeEvent, dirPath: string): Promise<void> =>
    withNotesFilesystemMutation(async () => {
      await assertOutsideManagedStorageMutation(dirPath)
      assertNotesPathNotMutatingDuringMigration(dirPath)
      await fs.promises.mkdir(dirPath, { recursive: true })
    })

  public fileNameGuard = async (
    _: Electron.IpcMainInvokeEvent,
    dirPath: string,
    fileName: string,
    isFile: boolean
  ): Promise<{ safeName: string; exists: boolean }> => {
    const safeName = checkName(fileName)
    const finalName = getName(dirPath, safeName, isFile)
    // `finalName` is deduplicated by `getName`, so it never exists on disk.
    // `exists` must report whether the *requested* name is already taken,
    // which is what the notes rename flow relies on.
    const requestedPath = path.join(dirPath, sanitizeFilename(safeName) + (isFile ? '.md' : ''))
    const exists = fs.existsSync(requestedPath)

    logger.debug(`File name guard: ${fileName} -> ${finalName}, exists: ${exists}`)
    return { safeName: finalName, exists }
  }

  public mkdir = async (_: Electron.IpcMainInvokeEvent, dirPath: string): Promise<string> =>
    withNotesFilesystemMutation(async () => {
      try {
        await assertOutsideManagedStorageMutation(dirPath)
        assertNotesPathNotMutatingDuringMigration(dirPath)
        assertNotesPathNotRetired(dirPath)
        logger.debug(`Attempting to create directory: ${dirPath}`)
        await fs.promises.mkdir(dirPath, { recursive: true })
        return dirPath
      } catch (error) {
        logger.error('Failed to create directory:', error as Error)
        // Keep the notes-relocation error identity: a retired or migrating
        // root must stay distinguishable from a plain filesystem failure.
        if (
          isNotesMigrationWriteBlockedError(error) ||
          isNotesRetiredRootWriteError(error) ||
          isNotesRootUnresolvedError(error)
        )
          throw error
        throw new Error(`Failed to create directory: ${dirPath}. Error: ${(error as Error).message}`)
      }
    })

  public binaryImage = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<{ data: Buffer; mime: string }> => {
    const filePath = this.resolveStoredPath(id)
    const data = await fs.promises.readFile(filePath)
    const mime = `image/${path.extname(filePath).slice(1)}`
    return { data, mime }
  }

  public open = async (
    _: Electron.IpcMainInvokeEvent,
    options: OpenDialogOptions
  ): Promise<{ fileName: string; filePath: string; content?: Buffer; size: number } | null> => {
    try {
      const result: OpenDialogReturnValue = await dialog.showOpenDialog({
        title: t('dialog.open_file'),
        properties: ['openFile'],
        filters: [{ name: t('dialog.all_files'), extensions: ['*'] }],
        ...options
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        const fileName = filePath.split('/').pop() || ''
        const stats = await fs.promises.stat(filePath)

        // If the file is less than 2GB, read the content
        if (stats.size < 2 * 1024 * 1024 * 1024) {
          const content = await readFile(filePath)
          return { fileName, filePath, content, size: stats.size }
        }

        // For large files, only return file information, do not read content
        return { fileName, filePath, size: stats.size }
      }

      return null
    } catch (err) {
      logger.error('[IPC - Error] An error occurred opening the file:', err as Error)
      return null
    }
  }

  public validateNotesDirectory = async (_: Electron.IpcMainInvokeEvent, dirPath: string): Promise<boolean> => {
    try {
      return isAllowedNotesDirectory(dirPath)
    } catch (error) {
      logger.error('Failed to validate notes directory:', error as Error)
      return false
    }
  }

  public save = async (
    event: Electron.IpcMainInvokeEvent,
    fileName: string,
    content: string,
    options?: SaveDialogOptions
  ): Promise<string | null> => {
    try {
      const dialogOptions: SaveDialogOptions = {
        title: t('dialog.save_file'),
        defaultPath: fileName,
        ...options
      }
      const parent = resolveSaveDialogParent(event)
      const result: SaveDialogReturnValue = parent
        ? await dialog.showSaveDialog(parent, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)

      if (result.canceled || !result.filePath) {
        return null
      }

      const filePath = result.filePath
      const savedPath = await withNotesFilesystemMutation(async () => {
        await assertOutsideManagedStorageMutation(filePath)
        assertNotesPathNotMutatingDuringMigration(filePath)
        writeFileSync(filePath, content, { encoding: 'utf-8' })
        return filePath
      })
      return savedPath
    } catch (err: any) {
      logger.error('[IPC - Error] An error occurred saving the file:', err as Error)
      return Promise.reject('An error occurred saving the file: ' + err?.message)
    }
  }

  public saveImage = async (event: Electron.IpcMainInvokeEvent, name: string, data: string): Promise<boolean> => {
    try {
      const dialogOptions: SaveDialogOptions = {
        defaultPath: `${name}.png`,
        filters: [{ name: t('dialog.png_image'), extensions: ['png'] }]
      }
      const parent = resolveSaveDialogParent(event)
      const result: SaveDialogReturnValue = parent
        ? await dialog.showSaveDialog(parent, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)

      if (!result.canceled && result.filePath) {
        const filePath = result.filePath
        return await withNotesFilesystemMutation(async () => {
          await assertOutsideManagedStorageMutation(filePath)
          assertNotesPathNotMutatingDuringMigration(filePath)
          const parseResult = parseDataUrl(data)
          await fs.promises.writeFile(filePath, parseResult?.data ?? data, 'base64')
          return true
        })
      }
    } catch (error) {
      logger.error('[IPC - Error] An error occurred saving the image:', error as Error)
    }
    return false
  }

  public selectFolder = async (_: Electron.IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string | null> => {
    try {
      const result: OpenDialogReturnValue = await dialog.showOpenDialog({
        title: t('dialog.select_folder'),
        properties: ['openDirectory'],
        ...options
      })

      if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0]
      }

      return null
    } catch (err) {
      logger.error('[IPC - Error] An error occurred selecting the folder:', err as Error)
      return null
    }
  }

  /**
   * Batch upload markdown files from native File objects
   * This handles all I/O operations in the Main process to avoid blocking Renderer
   */
  public batchUploadMarkdownFiles = async (
    _: Electron.IpcMainInvokeEvent,
    filePaths: string[],
    targetPath: string
  ): Promise<{
    fileCount: number
    folderCount: number
    skippedFiles: number
    failedFiles: number
  }> => {
    beginNotesBatchMarkdownUpload()
    try {
      logger.info('Starting batch upload', { fileCount: filePaths.length, targetPath })

      const basePath = path.resolve(targetPath)
      await assertOutsideManagedStorageMutation(basePath)
      assertNotesPathNotMutatingDuringMigration(basePath)
      // A stale absolute targetPath must not land files in a retired notes
      // tree: the barrier above only covers an in-flight migration.
      assertNotesPathNotRetired(basePath)
      const MARKDOWN_EXTS = ['.md', '.markdown']

      // Filter markdown files
      const markdownFiles = filePaths.filter((filePath) => {
        const ext = path.extname(filePath).toLowerCase()
        return MARKDOWN_EXTS.includes(ext)
      })

      const skippedFiles = filePaths.length - markdownFiles.length

      if (markdownFiles.length === 0) {
        return { fileCount: 0, folderCount: 0, skippedFiles, failedFiles: 0 }
      }

      // Collect unique folders needed
      const foldersSet = new Set<string>()
      const fileOperations: Array<{ sourcePath: string; targetPath: string }> = []
      let failedFiles = 0

      for (const filePath of markdownFiles) {
        try {
          // Get relative path if file is from a directory upload
          const fileName = path.basename(filePath)
          const relativePath = path.dirname(filePath)

          // Determine target directory structure
          let targetDir = basePath
          const folderParts: string[] = []

          // Extract folder structure from file path for nested uploads
          // This is a simplified version - in real scenario we'd need the original directory structure
          if (relativePath && relativePath !== '.') {
            const parts = relativePath.split(path.sep)
            // Get the last few parts that represent the folder structure within upload
            const relevantParts = parts.slice(Math.max(0, parts.length - 3))
            folderParts.push(...relevantParts)
          }

          // Build target directory path
          for (const part of folderParts) {
            targetDir = path.join(targetDir, part)
            foldersSet.add(targetDir)
          }

          // Determine final file name
          const nameWithoutExt = fileName.endsWith('.md')
            ? fileName.slice(0, -3)
            : fileName.endsWith('.markdown')
              ? fileName.slice(0, -9)
              : fileName

          const { safeName } = await this.fileNameGuard(_, targetDir, nameWithoutExt, true)
          const finalPath = path.join(targetDir, safeName + '.md')

          fileOperations.push({ sourcePath: filePath, targetPath: finalPath })
        } catch (error) {
          failedFiles += 1
          logger.error('Failed to prepare file operation:', error as Error, { filePath })
        }
      }

      // Create folders in order (shallow to deep)
      const sortedFolders = Array.from(foldersSet).sort((a, b) => a.length - b.length)
      for (const folder of sortedFolders) {
        assertNotesPathNotMutatingDuringMigration(folder)
        try {
          if (!fs.existsSync(folder)) {
            await fs.promises.mkdir(folder, { recursive: true })
          }
        } catch (error) {
          if (isNotesMigrationWriteBlockedError(error)) {
            throw error
          }
          logger.debug('Folder already exists or creation failed', { folder, error: (error as Error).message })
        }
      }

      // Process files in batches
      const BATCH_SIZE = 10 // Higher batch size since we're in Main process
      let successCount = 0

      for (let i = 0; i < fileOperations.length; i += BATCH_SIZE) {
        const batch = fileOperations.slice(i, i + BATCH_SIZE)

        for (const op of batch) {
          try {
            assertNotesPathNotMutatingDuringMigration(op.targetPath)
            const content = await fs.promises.readFile(op.sourcePath, 'utf-8')
            assertNotesPathNotMutatingDuringMigration(op.targetPath)
            await fs.promises.writeFile(op.targetPath, content, 'utf-8')
            successCount++
          } catch (error) {
            if (isNotesMigrationWriteBlockedError(error)) {
              throw error
            }
            failedFiles += 1
            logger.error('Failed to upload file:', error as Error, {
              file: op.sourcePath
            })
          }
        }
      }

      logger.info('Batch upload completed', {
        successCount,
        folderCount: foldersSet.size,
        skippedFiles,
        failedFiles
      })

      return {
        fileCount: successCount,
        folderCount: foldersSet.size,
        skippedFiles,
        failedFiles
      }
    } catch (error) {
      logger.error('Batch upload failed:', error as Error)
      throw error
    } finally {
      endNotesBatchMarkdownUpload()
    }
  }
}

export const fileStorage = new FileStorage()
