import { loggerService } from '@logger'
import {
  checkName,
  getFilesDir,
  getFileType,
  getName,
  getNotesDir,
  getTempDir,
  readTextFileWithAutoEncoding,
  scanDir
} from '@main/utils/file'
import { documentExts, imageExts, KB, MB } from '@shared/config/constant'
import type { FileMetadata, NotesTreeNode } from '@types'
import chardet from 'chardet'
import type { FSWatcher } from 'chokidar'
import chokidar from 'chokidar'
import * as crypto from 'crypto'
import type { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from 'electron'
import { dialog, net, shell } from 'electron'
import * as fs from 'fs'
import { writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { isBinaryFile } from 'isbinaryfile'
import officeParser from 'officeparser'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'
import { chdir } from 'process'
import { v4 as uuidv4 } from 'uuid'
import WordExtractor from 'word-extractor'

const logger = loggerService.withContext('FileStorage')

// Get ripgrep binary path
const getRipgrepBinaryPath = (): string | null => {
  try {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
    const ripgrepBinaryPath = path.join(
      __dirname,
      '../../node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep',
      `${arch}-${platform}`,
      process.platform === 'win32' ? 'rg.exe' : 'rg'
    )

    if (fs.existsSync(ripgrepBinaryPath)) {
      return ripgrepBinaryPath
    }
    return null
  } catch (error) {
    logger.error('Failed to locate ripgrep binary:', error as Error)
    return null
  }
}

/**
 * Execute ripgrep with captured output
 */
function executeRipgrep(args: string[]): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const ripgrepBinaryPath = getRipgrepBinaryPath()

    if (!ripgrepBinaryPath) {
      reject(new Error('Ripgrep binary not available'))
      return
    }

    const { spawn } = require('child_process')
    const child = spawn(ripgrepBinaryPath, ['--no-config', '--ignore-case', ...args], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''
    let errorOutput = ''

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString()
    })

    child.on('close', (code: number) => {
      resolve({
        exitCode: code || 0,
        output: output || errorOutput
      })
    })

    child.on('error', (error: Error) => {
      reject(error)
    })
  })
}

interface FileWatcherConfig {
  watchExtensions?: string[]
  ignoredPatterns?: (string | RegExp)[]
  debounceMs?: number
  maxDepth?: number
  usePolling?: boolean
  retryOnError?: boolean
  retryDelayMs?: number
  stabilityThreshold?: number
  eventChannel?: string
}

const DEFAULT_WATCHER_CONFIG: Required<FileWatcherConfig> = {
  watchExtensions: ['.md', '.markdown', '.txt'],
  ignoredPatterns: [/(^|[/\\])\../, '**/node_modules/**', '**/.git/**', '**/*.tmp', '**/*.temp', '**/.DS_Store'],
  debounceMs: 1000,
  maxDepth: 10,
  usePolling: false,
  retryOnError: true,
  retryDelayMs: 5000,
  stabilityThreshold: 500,
  eventChannel: 'file-change'
}

interface DirectoryListOptions {
  recursive?: boolean
  maxDepth?: number
  includeHidden?: boolean
  includeFiles?: boolean
  includeDirectories?: boolean
  maxEntries?: number
  searchPattern?: string
}

const DEFAULT_DIRECTORY_LIST_OPTIONS: Required<DirectoryListOptions> = {
  recursive: true,
  maxDepth: 3,
  includeHidden: false,
  includeFiles: true,
  includeDirectories: false,
  maxEntries: 10,
  searchPattern: '.'
}

class FileStorage {
  private storageDir = getFilesDir()
  private notesDir = getNotesDir()
  private tempDir = getTempDir()
  private watcher?: FSWatcher
  private watcherSender?: Electron.WebContents
  private currentWatchPath?: string
  private debounceTimer?: NodeJS.Timeout
  private watcherConfig: Required<FileWatcherConfig> = DEFAULT_WATCHER_CONFIG

  constructor() {
    this.initStorageDir()
  }

  private initStorageDir = (): void => {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }
      if (!fs.existsSync(this.notesDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true })
      }
    } catch (error) {
      logger.error('Failed to initialize storage directories:', error as Error)
      throw error
    }
  }

  // @TraceProperty({ spanName: 'getFileHash', tag: 'FileStorage' })
  private getFileHash = async (filePath: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5')
      const stream = fs.createReadStream(filePath)
      stream.on('data', (data) => hash.update(data))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }

  findDuplicateFile = async (filePath: string): Promise<FileMetadata | null> => {
    const stats = fs.statSync(filePath)
    logger.debug(`stats: ${stats}, filePath: ${filePath}`)
    const fileSize = stats.size

    const files = await fs.promises.readdir(this.storageDir)
    for (const file of files) {
      const storedFilePath = path.join(this.storageDir, file)
      const storedStats = fs.statSync(storedFilePath)

      if (storedStats.size === fileSize) {
        const [originalHash, storedHash] = await Promise.all([
          this.getFileHash(filePath),
          this.getFileHash(storedFilePath)
        ])

        if (originalHash === storedHash) {
          const ext = path.extname(file)
          const id = path.basename(file, ext)
          return {
            id,
            origin_name: file,
            name: file + ext,
            path: storedFilePath,
            created_at: storedStats.birthtime.toISOString(),
            size: storedStats.size,
            ext,
            type: getFileType(ext),
            count: 2
          }
        }
      }
    }

    return null
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
      const fileType = getFileType(ext)

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

  private async compressImage(sourcePath: string, destPath: string): Promise<void> {
    try {
      const stats = fs.statSync(sourcePath)
      const fileSizeInMB = stats.size / MB

      // 如果图片大于1MB才进行压缩
      if (fileSizeInMB > 1) {
        try {
          await fs.promises.copyFile(sourcePath, destPath)
          logger.debug(`Image compressed successfully: ${sourcePath}`)
        } catch (jimpError) {
          logger.error('Image compression failed:', jimpError as Error)
          await fs.promises.copyFile(sourcePath, destPath)
        }
      } else {
        // 小图片直接复制
        await fs.promises.copyFile(sourcePath, destPath)
      }
    } catch (error) {
      logger.error('Image handling failed:', error as Error)
      // 错误情况下直接复制原文件
      await fs.promises.copyFile(sourcePath, destPath)
    }
  }

  public uploadFile = async (_: Electron.IpcMainInvokeEvent, file: FileMetadata): Promise<FileMetadata> => {
    const filePath = file.path
    const duplicateFile = await this.findDuplicateFile(filePath)

    if (duplicateFile) {
      return duplicateFile
    }

    const uuid = uuidv4()
    const origin_name = path.basename(file.path)
    const ext = path.extname(origin_name).toLowerCase()
    const destPath = path.join(this.storageDir, uuid + ext)

    logger.info(`[FileStorage] Uploading file: ${filePath}`)

    // 根据文件类型选择处理方式
    if (imageExts.includes(ext)) {
      await this.compressImage(filePath, destPath)
    } else {
      await fs.promises.copyFile(filePath, destPath)
    }

    const stats = await fs.promises.stat(destPath)
    const fileType = getFileType(ext)

    const fileMetadata: FileMetadata = {
      id: uuid,
      origin_name,
      name: uuid + ext,
      path: destPath,
      created_at: stats.birthtime.toISOString(),
      size: stats.size,
      ext: ext,
      type: fileType,
      count: 1
    }

    logger.debug(`File uploaded: ${fileMetadata}`)

    return fileMetadata
  }

  public getFile = async (_: Electron.IpcMainInvokeEvent, filePath: string): Promise<FileMetadata | null> => {
    if (!fs.existsSync(filePath)) {
      return null
    }

    const stats = fs.statSync(filePath)
    const ext = path.extname(filePath)
    const fileType = getFileType(ext)

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
  }

  // @TraceProperty({ spanName: 'deleteFile', tag: 'FileStorage' })
  public deleteFile = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<void> => {
    if (!fs.existsSync(path.join(this.storageDir, id))) {
      return
    }
    await fs.promises.unlink(path.join(this.storageDir, id))
  }

  public deleteDir = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<void> => {
    if (!fs.existsSync(path.join(this.storageDir, id))) {
      return
    }
    await fs.promises.rm(path.join(this.storageDir, id), { recursive: true })
  }

  public deleteExternalFile = async (_: Electron.IpcMainInvokeEvent, filePath: string): Promise<void> => {
    try {
      if (!fs.existsSync(filePath)) {
        return
      }

      await fs.promises.rm(filePath, { force: true })
      logger.debug(`External file deleted successfully: ${filePath}`)
    } catch (error) {
      logger.error('Failed to delete external file:', error as Error)
      throw error
    }
  }

  public deleteExternalDir = async (_: Electron.IpcMainInvokeEvent, dirPath: string): Promise<void> => {
    try {
      if (!fs.existsSync(dirPath)) {
        return
      }

      await fs.promises.rm(dirPath, { recursive: true, force: true })
      logger.debug(`External directory deleted successfully: ${dirPath}`)
    } catch (error) {
      logger.error('Failed to delete external directory:', error as Error)
      throw error
    }
  }

  public moveFile = async (_: Electron.IpcMainInvokeEvent, filePath: string, newPath: string): Promise<void> => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Source file does not exist: ${filePath}`)
      }

      // 确保目标目录存在
      const destDir = path.dirname(newPath)
      if (!fs.existsSync(destDir)) {
        await fs.promises.mkdir(destDir, { recursive: true })
      }

      // 移动文件
      await fs.promises.rename(filePath, newPath)
      logger.debug(`File moved successfully: ${filePath} to ${newPath}`)
    } catch (error) {
      logger.error('Move file failed:', error as Error)
      throw error
    }
  }

  public moveDir = async (_: Electron.IpcMainInvokeEvent, dirPath: string, newDirPath: string): Promise<void> => {
    try {
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Source directory does not exist: ${dirPath}`)
      }

      // 确保目标父目录存在
      const parentDir = path.dirname(newDirPath)
      if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true })
      }

      // 移动目录
      await fs.promises.rename(dirPath, newDirPath)
      logger.debug(`Directory moved successfully: ${dirPath} to ${newDirPath}`)
    } catch (error) {
      logger.error('Move directory failed:', error as Error)
      throw error
    }
  }

  public renameFile = async (_: Electron.IpcMainInvokeEvent, filePath: string, newName: string): Promise<void> => {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Source file does not exist: ${filePath}`)
      }

      const dirPath = path.dirname(filePath)
      const newFilePath = path.join(dirPath, newName + '.md')

      // 如果目标文件已存在，抛出错误
      if (fs.existsSync(newFilePath)) {
        throw new Error(`Target file already exists: ${newFilePath}`)
      }

      // 重命名文件
      await fs.promises.rename(filePath, newFilePath)
      logger.debug(`File renamed successfully: ${filePath} to ${newFilePath}`)
    } catch (error) {
      logger.error('Rename file failed:', error as Error)
      throw error
    }
  }

  public renameDir = async (_: Electron.IpcMainInvokeEvent, dirPath: string, newName: string): Promise<void> => {
    try {
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Source directory does not exist: ${dirPath}`)
      }

      const parentDir = path.dirname(dirPath)
      const newDirPath = path.join(parentDir, newName)

      // 如果目标目录已存在，抛出错误
      if (fs.existsSync(newDirPath)) {
        throw new Error(`Target directory already exists: ${newDirPath}`)
      }

      // 重命名目录
      await fs.promises.rename(dirPath, newDirPath)
      logger.debug(`Directory renamed successfully: ${dirPath} to ${newDirPath}`)
    } catch (error) {
      logger.error('Rename directory failed:', error as Error)
      throw error
    }
  }

  public readFile = async (
    _: Electron.IpcMainInvokeEvent,
    id: string,
    detectEncoding: boolean = false
  ): Promise<string> => {
    const filePath = path.join(this.storageDir, id)

    const fileExtension = path.extname(filePath)

    if (documentExts.includes(fileExtension)) {
      const originalCwd = process.cwd()
      try {
        chdir(this.tempDir)

        if (fileExtension === '.doc') {
          const extractor = new WordExtractor()
          const extracted = await extractor.extract(filePath)
          chdir(originalCwd)
          return extracted.getBody()
        }

        const data = await officeParser.parseOfficeAsync(filePath)
        chdir(originalCwd)
        return data
      } catch (error) {
        chdir(originalCwd)
        logger.error('Failed to read file:', error as Error)
        throw error
      }
    }

    try {
      if (detectEncoding) {
        return readTextFileWithAutoEncoding(filePath)
      } else {
        return fs.readFileSync(filePath, 'utf-8')
      }
    } catch (error) {
      logger.error('Failed to read file:', error as Error)
      throw new Error(`Failed to read file: ${filePath}.`)
    }
  }

  public readExternalFile = async (
    _: Electron.IpcMainInvokeEvent,
    filePath: string,
    detectEncoding: boolean = false
  ): Promise<string> => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`)
    }

    const fileExtension = path.extname(filePath)

    if (documentExts.includes(fileExtension)) {
      const originalCwd = process.cwd()
      try {
        chdir(this.tempDir)

        if (fileExtension === '.doc') {
          const extractor = new WordExtractor()
          const extracted = await extractor.extract(filePath)
          chdir(originalCwd)
          return extracted.getBody()
        }

        const data = await officeParser.parseOfficeAsync(filePath)
        chdir(originalCwd)
        return data
      } catch (error) {
        chdir(originalCwd)
        logger.error('Failed to read file:', error as Error)
        throw error
      }
    }

    try {
      if (detectEncoding) {
        return readTextFileWithAutoEncoding(filePath)
      } else {
        return fs.readFileSync(filePath, 'utf-8')
      }
    } catch (error) {
      logger.error('Failed to read file:', error as Error)
      throw new Error(`Failed to read file: ${filePath}.`)
    }
  }

  public createTempFile = async (_: Electron.IpcMainInvokeEvent, fileName: string): Promise<string> => {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }

    return path.join(this.tempDir, `temp_file_${uuidv4()}_${fileName}`)
  }

  public writeFile = async (
    _: Electron.IpcMainInvokeEvent,
    filePath: string,
    data: Uint8Array | string
  ): Promise<void> => {
    await fs.promises.writeFile(filePath, data)
  }

  public fileNameGuard = async (
    _: Electron.IpcMainInvokeEvent,
    dirPath: string,
    fileName: string,
    isFile: boolean
  ): Promise<{ safeName: string; exists: boolean }> => {
    const safeName = checkName(fileName)
    const finalName = getName(dirPath, safeName, isFile)
    const fullPath = path.join(dirPath, finalName + (isFile ? '.md' : ''))
    const exists = fs.existsSync(fullPath)

    logger.debug(`File name guard: ${fileName} -> ${finalName}, exists: ${exists}`)
    return { safeName: finalName, exists }
  }

  public mkdir = async (_: Electron.IpcMainInvokeEvent, dirPath: string): Promise<string> => {
    try {
      logger.debug(`Attempting to create directory: ${dirPath}`)
      await fs.promises.mkdir(dirPath, { recursive: true })
      return dirPath
    } catch (error) {
      logger.error('Failed to create directory:', error as Error)
      throw new Error(`Failed to create directory: ${dirPath}. Error: ${(error as Error).message}`)
    }
  }

  public base64Image = async (
    _: Electron.IpcMainInvokeEvent,
    id: string
  ): Promise<{ mime: string; base64: string; data: string }> => {
    const filePath = path.join(this.storageDir, id)
    const data = await fs.promises.readFile(filePath)
    const base64 = data.toString('base64')
    const ext = path.extname(filePath).slice(1) == 'jpg' ? 'jpeg' : path.extname(filePath).slice(1)
    const mime = `image/${ext}`
    return {
      mime,
      base64,
      data: `data:${mime};base64,${base64}`
    }
  }

  public saveBase64Image = async (_: Electron.IpcMainInvokeEvent, base64Data: string): Promise<FileMetadata> => {
    try {
      if (!base64Data) {
        throw new Error('Base64 data is required')
      }

      // 移除 base64 头部信息（如果存在）
      const base64String = base64Data.replace(/^data:.*;base64,/, '')
      const buffer = Buffer.from(base64String, 'base64')
      const uuid = uuidv4()
      const ext = '.png'
      const destPath = path.join(this.storageDir, uuid + ext)

      logger.debug('Saving base64 image:', {
        storageDir: this.storageDir,
        destPath,
        bufferSize: buffer.length
      })

      // 确保目录存在
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }

      await fs.promises.writeFile(destPath, buffer)

      return {
        id: uuid,
        origin_name: uuid + ext,
        name: uuid + ext,
        path: destPath,
        created_at: new Date().toISOString(),
        size: buffer.length,
        ext: ext.slice(1),
        type: getFileType(ext),
        count: 1
      }
    } catch (error) {
      logger.error('Failed to save base64 image:', error as Error)
      throw error
    }
  }

  public savePastedImage = async (
    _: Electron.IpcMainInvokeEvent,
    imageData: Uint8Array | Buffer,
    extension?: string
  ): Promise<FileMetadata> => {
    try {
      const uuid = uuidv4()
      const ext = extension || '.png'
      const destPath = path.join(this.storageDir, uuid + ext)

      logger.debug('Saving pasted image:', {
        storageDir: this.storageDir,
        destPath,
        bufferSize: imageData.length
      })

      // 确保目录存在
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }

      // 确保 imageData 是 Buffer
      const buffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData)

      // 如果图片大于1MB，进行压缩处理
      if (buffer.length > MB) {
        await this.compressImageBuffer(buffer, destPath, ext)
      } else {
        await fs.promises.writeFile(destPath, buffer)
      }

      const stats = await fs.promises.stat(destPath)

      return {
        id: uuid,
        origin_name: `pasted_image_${uuid}${ext}`,
        name: uuid + ext,
        path: destPath,
        created_at: new Date().toISOString(),
        size: stats.size,
        ext: ext.slice(1),
        type: getFileType(ext),
        count: 1
      }
    } catch (error) {
      logger.error('Failed to save pasted image:', error as Error)
      throw error
    }
  }

  private async compressImageBuffer(imageBuffer: Buffer, destPath: string, ext: string): Promise<void> {
    try {
      // 创建临时文件
      const tempPath = path.join(this.tempDir, `temp_${uuidv4()}${ext}`)
      await fs.promises.writeFile(tempPath, imageBuffer)

      // 使用现有的压缩方法
      await this.compressImage(tempPath, destPath)

      // 清理临时文件
      try {
        await fs.promises.unlink(tempPath)
      } catch (error) {
        logger.warn('Failed to cleanup temp file:', error as Error)
      }
    } catch (error) {
      logger.error('Image buffer compression failed, saving original:', error as Error)
      // 压缩失败时保存原始文件
      await fs.promises.writeFile(destPath, imageBuffer)
    }
  }

  public base64File = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<{ data: string; mime: string }> => {
    const filePath = path.join(this.storageDir, id)
    const buffer = await fs.promises.readFile(filePath)
    const base64 = buffer.toString('base64')
    const mime = `application/${path.extname(filePath).slice(1)}`
    return { data: base64, mime }
  }

  public pdfPageCount = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<number> => {
    const filePath = path.join(this.storageDir, id)
    const buffer = await fs.promises.readFile(filePath)

    const pdfDoc = await PDFDocument.load(buffer)
    return pdfDoc.getPageCount()
  }

  public binaryImage = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<{ data: Buffer; mime: string }> => {
    const filePath = path.join(this.storageDir, id)
    const data = await fs.promises.readFile(filePath)
    const mime = `image/${path.extname(filePath).slice(1)}`
    return { data, mime }
  }

  public clear = async (): Promise<void> => {
    await fs.promises.rm(this.storageDir, { recursive: true })
    this.initStorageDir()
  }

  public clearTemp = async (): Promise<void> => {
    await fs.promises.rm(this.tempDir, { recursive: true })
    await fs.promises.mkdir(this.tempDir, { recursive: true })
  }

  public open = async (
    _: Electron.IpcMainInvokeEvent,
    options: OpenDialogOptions
  ): Promise<{ fileName: string; filePath: string; content?: Buffer; size: number } | null> => {
    try {
      const result: OpenDialogReturnValue = await dialog.showOpenDialog({
        title: '打开文件',
        properties: ['openFile'],
        filters: [{ name: '所有文件', extensions: ['*'] }],
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

  public openPath = async (_: Electron.IpcMainInvokeEvent, path: string): Promise<void> => {
    const resolved = await shell.openPath(path)
    if (resolved !== '') {
      throw new Error(resolved)
    }
  }

  /**
   * 通过相对路径打开文件，跨设备时使用
   * @param _
   * @param file
   */
  public openFileWithRelativePath = async (_: Electron.IpcMainInvokeEvent, file: FileMetadata): Promise<void> => {
    const filePath = path.join(this.storageDir, file.name)
    if (fs.existsSync(filePath)) {
      shell.openPath(filePath).catch((err) => logger.error('[IPC - Error] Failed to open file:', err))
    } else {
      logger.warn(`[IPC - Warning] File does not exist: ${filePath}`)
    }
  }

  public getDirectoryStructure = async (_: Electron.IpcMainInvokeEvent, dirPath: string): Promise<NotesTreeNode[]> => {
    try {
      return await scanDir(dirPath)
    } catch (error) {
      logger.error('Failed to get directory structure:', error as Error)
      throw error
    }
  }

  public listDirectory = async (
    _: Electron.IpcMainInvokeEvent,
    dirPath: string,
    options?: DirectoryListOptions
  ): Promise<string[]> => {
    const mergedOptions: Required<DirectoryListOptions> = {
      ...DEFAULT_DIRECTORY_LIST_OPTIONS,
      ...options
    }

    const resolvedPath = path.resolve(dirPath)

    const stat = await fs.promises.stat(resolvedPath).catch((error) => {
      logger.error(`[IPC - Error] Failed to access directory: ${resolvedPath}`, error as Error)
      throw error
    })

    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedPath}`)
    }

    // Use ripgrep for file listing with relevance-based sorting
    if (!getRipgrepBinaryPath()) {
      throw new Error('Ripgrep binary not available')
    }

    return await this.listDirectoryWithRipgrep(resolvedPath, mergedOptions)
  }

  /**
   * Search files by filename pattern
   */
  private async searchByFilename(resolvedPath: string, options: Required<DirectoryListOptions>): Promise<string[]> {
    const args: string[] = ['--files']

    // Handle hidden files
    if (!options.includeHidden) {
      args.push('--glob', '!.*')
    }

    // Handle max depth
    if (!options.recursive) {
      args.push('--max-depth', '1')
    } else if (options.maxDepth > 0) {
      args.push('--max-depth', options.maxDepth.toString())
    }

    // Add the directory path
    args.push(resolvedPath)

    const { exitCode, output } = await executeRipgrep(args)

    // Exit code 0 means files found, 1 means no files found (still success), 2+ means error
    if (exitCode >= 2) {
      throw new Error(`Ripgrep failed with exit code ${exitCode}: ${output}`)
    }

    // Parse ripgrep output and filter by filename
    const searchPatternLower = options.searchPattern.toLowerCase()
    const results = output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.replace(/\\/g, '/'))
      .filter((filePath) => {
        const fileName = path.basename(filePath).toLowerCase()
        return fileName.includes(searchPatternLower)
      })
      .slice(0, options.maxEntries)

    return results
  }

  /**
   * Search files by content pattern
   */
  private async searchByContent(resolvedPath: string, options: Required<DirectoryListOptions>): Promise<string[]> {
    const args: string[] = ['-l']

    // Handle hidden files
    if (!options.includeHidden) {
      args.push('--glob', '!.*')
    }

    // Handle max depth
    if (!options.recursive) {
      args.push('--max-depth', '1')
    } else if (options.maxDepth > 0) {
      args.push('--max-depth', options.maxDepth.toString())
    }

    // Handle max count
    if (options.maxEntries > 0) {
      args.push('--max-count', options.maxEntries.toString())
    }

    // Add search pattern (search in content)
    args.push(options.searchPattern)

    // Add the directory path
    args.push(resolvedPath)

    const { exitCode, output } = await executeRipgrep(args)

    // Exit code 0 means files found, 1 means no files found (still success), 2+ means error
    if (exitCode >= 2) {
      throw new Error(`Ripgrep failed with exit code ${exitCode}: ${output}`)
    }

    // Parse ripgrep output (already sorted by relevance)
    const results = output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.replace(/\\/g, '/'))
      .slice(0, options.maxEntries)

    return results
  }

  private async listDirectoryWithRipgrep(
    resolvedPath: string,
    options: Required<DirectoryListOptions>
  ): Promise<string[]> {
    const maxEntries = options.maxEntries

    // Step 1: Search by filename first
    logger.debug('Searching by filename pattern', { pattern: options.searchPattern, path: resolvedPath })
    const filenameResults = await this.searchByFilename(resolvedPath, options)

    logger.debug('Found matches by filename', { count: filenameResults.length })

    // If we have enough filename matches, return them
    if (filenameResults.length >= maxEntries) {
      return filenameResults.slice(0, maxEntries)
    }

    // Step 2: If filename matches are less than maxEntries, search by content to fill up
    logger.debug('Filename matches insufficient, searching by content to fill up', {
      filenameCount: filenameResults.length,
      needed: maxEntries - filenameResults.length
    })

    // Adjust maxEntries for content search to get enough results
    const contentOptions = {
      ...options,
      maxEntries: maxEntries - filenameResults.length + 20 // Request extra to account for duplicates
    }

    const contentResults = await this.searchByContent(resolvedPath, contentOptions)

    logger.debug('Found matches by content', { count: contentResults.length })

    // Combine results: filename matches first, then content matches (deduplicated)
    const combined = [...filenameResults]
    const filenameSet = new Set(filenameResults)

    for (const filePath of contentResults) {
      if (!filenameSet.has(filePath)) {
        combined.push(filePath)
        if (combined.length >= maxEntries) {
          break
        }
      }
    }

    logger.debug('Combined results', { total: combined.length, filenameCount: filenameResults.length })
    return combined.slice(0, maxEntries)
  }

  public validateNotesDirectory = async (_: Electron.IpcMainInvokeEvent, dirPath: string): Promise<boolean> => {
    try {
      if (!dirPath || typeof dirPath !== 'string') {
        return false
      }

      // Normalize path
      const normalizedPath = path.resolve(dirPath)

      // Check if directory exists
      if (!fs.existsSync(normalizedPath)) {
        return false
      }

      // Check if it's actually a directory
      const stats = fs.statSync(normalizedPath)
      if (!stats.isDirectory()) {
        return false
      }

      // Get app paths to prevent selection of restricted directories
      const appDataPath = path.resolve(process.env.APPDATA || path.join(require('os').homedir(), '.config'))
      const filesDir = path.resolve(getFilesDir())
      const currentNotesDir = path.resolve(getNotesDir())

      // Prevent selecting app data directories
      if (
        normalizedPath.startsWith(filesDir) ||
        normalizedPath.startsWith(appDataPath) ||
        normalizedPath === currentNotesDir
      ) {
        logger.warn(`Invalid directory selection: ${normalizedPath} (app data directory)`)
        return false
      }

      // Prevent selecting system root directories
      const isSystemRoot =
        process.platform === 'win32'
          ? /^[a-zA-Z]:[\\/]?$/.test(normalizedPath)
          : normalizedPath === '/' ||
            normalizedPath === '/usr' ||
            normalizedPath === '/etc' ||
            normalizedPath === '/System'

      if (isSystemRoot) {
        logger.warn(`Invalid directory selection: ${normalizedPath} (system root directory)`)
        return false
      }

      // Check write permissions
      try {
        fs.accessSync(normalizedPath, fs.constants.W_OK)
      } catch (error) {
        logger.warn(`Directory not writable: ${normalizedPath}`)
        return false
      }

      return true
    } catch (error) {
      logger.error('Failed to validate notes directory:', error as Error)
      return false
    }
  }

  public save = async (
    _: Electron.IpcMainInvokeEvent,
    fileName: string,
    content: string,
    options?: SaveDialogOptions
  ): Promise<string> => {
    try {
      const result: SaveDialogReturnValue = await dialog.showSaveDialog({
        title: '保存文件',
        defaultPath: fileName,
        ...options
      })

      if (result.canceled) {
        return Promise.reject(new Error('User canceled the save dialog'))
      }

      if (!result.canceled && result.filePath) {
        writeFileSync(result.filePath, content, { encoding: 'utf-8' })
      }

      return result.filePath
    } catch (err: any) {
      logger.error('[IPC - Error] An error occurred saving the file:', err as Error)
      return Promise.reject('An error occurred saving the file: ' + err?.message)
    }
  }

  public saveImage = async (_: Electron.IpcMainInvokeEvent, name: string, data: string): Promise<void> => {
    try {
      const filePath = dialog.showSaveDialogSync({
        defaultPath: `${name}.png`,
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })

      if (filePath) {
        const base64Data = data.replace(/^data:image\/png;base64,/, '')
        fs.writeFileSync(filePath, base64Data, 'base64')
      }
    } catch (error) {
      logger.error('[IPC - Error] An error occurred saving the image:', error as Error)
    }
  }

  public selectFolder = async (_: Electron.IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string | null> => {
    try {
      const result: OpenDialogReturnValue = await dialog.showOpenDialog({
        title: '选择文件夹',
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

  public downloadFile = async (
    _: Electron.IpcMainInvokeEvent,
    url: string,
    isUseContentType?: boolean
  ): Promise<FileMetadata> => {
    try {
      const response = await net.fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // 尝试从Content-Disposition获取文件名
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = 'download'

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }

      // 如果URL中有文件名，使用URL中的文件名
      const urlFilename = url.split('/').pop()?.split('?')[0]
      if (urlFilename && urlFilename.includes('.')) {
        filename = urlFilename
      }

      // 如果文件名没有后缀，根据Content-Type添加后缀
      if (isUseContentType || !filename.includes('.')) {
        const contentType = response.headers.get('Content-Type')
        const ext = this.getExtensionFromMimeType(contentType)
        filename += ext
      }

      const uuid = uuidv4()
      const ext = path.extname(filename)
      const destPath = path.join(this.storageDir, uuid + ext)

      // 将响应内容写入文件
      const buffer = Buffer.from(await response.arrayBuffer())
      await fs.promises.writeFile(destPath, buffer)

      const stats = await fs.promises.stat(destPath)
      const fileType = getFileType(ext)

      return {
        id: uuid,
        origin_name: filename,
        name: uuid + ext,
        path: destPath,
        created_at: stats.birthtime.toISOString(),
        size: stats.size,
        ext: ext,
        type: fileType,
        count: 1
      }
    } catch (error) {
      logger.error('Download file error:', error as Error)
      throw error
    }
  }

  private getExtensionFromMimeType(mimeType: string | null): string {
    if (!mimeType) return '.bin'

    const mimeToExtension: { [key: string]: string } = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/zip': '.zip',
      'application/x-zip-compressed': '.zip',
      'application/octet-stream': '.bin'
    }

    return mimeToExtension[mimeType] || '.bin'
  }

  // @TraceProperty({ spanName: 'copyFile', tag: 'FileStorage' })
  public copyFile = async (_: Electron.IpcMainInvokeEvent, id: string, destPath: string): Promise<void> => {
    try {
      const sourcePath = path.join(this.storageDir, id)

      // 确保目标目录存在
      const destDir = path.dirname(destPath)
      if (!fs.existsSync(destDir)) {
        await fs.promises.mkdir(destDir, { recursive: true })
      }

      // 复制文件
      await fs.promises.copyFile(sourcePath, destPath)
      logger.debug(`File copied successfully: ${sourcePath} to ${destPath}`)
    } catch (error) {
      logger.error('Copy file failed:', error as Error)
      throw error
    }
  }

  public writeFileWithId = async (_: Electron.IpcMainInvokeEvent, id: string, content: string): Promise<void> => {
    try {
      const filePath = path.join(this.storageDir, id)
      logger.debug(`Writing file: ${filePath}`)

      // 确保目录存在
      if (!fs.existsSync(this.storageDir)) {
        logger.debug(`Creating storage directory: ${this.storageDir}`)
        fs.mkdirSync(this.storageDir, { recursive: true })
      }

      await fs.promises.writeFile(filePath, content, 'utf8')
      logger.debug(`File written successfully: ${filePath}`)
    } catch (error) {
      logger.error('Failed to write file:', error as Error)
      throw error
    }
  }

  public startFileWatcher = async (
    event: Electron.IpcMainInvokeEvent,
    dirPath: string,
    config?: FileWatcherConfig
  ): Promise<void> => {
    try {
      this.watcherConfig = { ...DEFAULT_WATCHER_CONFIG, ...config }

      if (!dirPath?.trim()) {
        throw new Error('Directory path is required')
      }

      const normalizedPath = path.resolve(dirPath.trim())

      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`Directory does not exist: ${normalizedPath}`)
      }

      const stats = fs.statSync(normalizedPath)
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${normalizedPath}`)
      }

      if (this.currentWatchPath === normalizedPath && this.watcher) {
        this.watcherSender = event.sender
        logger.debug('Already watching directory, updated sender', { path: normalizedPath })
        return
      }

      await this.stopFileWatcher()

      logger.info('Starting file watcher', {
        path: normalizedPath,
        config: {
          extensions: this.watcherConfig.watchExtensions,
          debounceMs: this.watcherConfig.debounceMs,
          maxDepth: this.watcherConfig.maxDepth
        }
      })

      this.currentWatchPath = normalizedPath
      this.watcherSender = event.sender

      const watchOptions = {
        ignored: this.watcherConfig.ignoredPatterns,
        persistent: true,
        ignoreInitial: true,
        depth: this.watcherConfig.maxDepth,
        usePolling: this.watcherConfig.usePolling,
        awaitWriteFinish: {
          stabilityThreshold: this.watcherConfig.stabilityThreshold,
          pollInterval: 100
        },
        alwaysStat: false,
        atomic: true
      }

      this.watcher = chokidar.watch(normalizedPath, watchOptions)

      const handleChange = this.createChangeHandler()

      this.watcher
        .on('add', (filePath: string) => handleChange('add', filePath))
        .on('unlink', (filePath: string) => handleChange('unlink', filePath))
        .on('addDir', (dirPath: string) => handleChange('addDir', dirPath))
        .on('unlinkDir', (dirPath: string) => handleChange('unlinkDir', dirPath))
        .on('error', (error: unknown) => {
          logger.error('File watcher error', { error: error as Error, path: normalizedPath })
          if (this.watcherConfig.retryOnError) {
            this.handleWatcherError(error as Error)
          }
        })
        .on('ready', () => {
          logger.debug('File watcher ready', { path: normalizedPath })
        })

      logger.info('File watcher started successfully')
    } catch (error) {
      logger.error('Failed to start file watcher', error as Error)
      this.cleanup()
      throw error
    }
  }

  private createChangeHandler() {
    return (eventType: string, filePath: string) => {
      if (!this.shouldWatchFile(filePath, eventType)) {
        return
      }

      logger.debug('File change detected', { eventType, filePath, path: this.currentWatchPath })

      // 对于目录操作，立即触发同步，不使用防抖
      if (eventType === 'addDir' || eventType === 'unlinkDir') {
        logger.debug('Directory operation detected, triggering immediate sync', { eventType, filePath })
        this.notifyChange(eventType, filePath)
        return
      }

      // 对于文件操作，使用防抖机制
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
      }

      this.debounceTimer = setTimeout(() => {
        this.notifyChange(eventType, filePath)
        this.debounceTimer = undefined
      }, this.watcherConfig.debounceMs)
    }
  }

  private shouldWatchFile(filePath: string, eventType: string): boolean {
    if (eventType.includes('Dir')) {
      return true
    }

    const ext = path.extname(filePath).toLowerCase()
    return this.watcherConfig.watchExtensions.includes(ext)
  }

  private notifyChange(eventType: string, filePath: string) {
    try {
      if (!this.watcherSender || this.watcherSender.isDestroyed()) {
        logger.warn('Sender destroyed, stopping watcher')
        this.stopFileWatcher()
        return
      }

      logger.debug('Sending file change event', {
        eventType,
        filePath,
        channel: this.watcherConfig.eventChannel,
        senderExists: !!this.watcherSender,
        senderDestroyed: this.watcherSender.isDestroyed()
      })
      this.watcherSender.send(this.watcherConfig.eventChannel, {
        eventType,
        filePath,
        watchPath: this.currentWatchPath
      })
      logger.debug('File change event sent successfully')
    } catch (error) {
      logger.error('Failed to send notification', error as Error)
    }
  }

  private handleWatcherError(error: Error) {
    const retryableErrors = ['EMFILE', 'ENFILE', 'ENOSPC']
    const isRetryable = retryableErrors.some((code) => error.message.includes(code))

    if (isRetryable && this.currentWatchPath && this.watcherSender && !this.watcherSender.isDestroyed()) {
      logger.warn('Attempting restart due to recoverable error', { error: error.message })

      setTimeout(async () => {
        try {
          if (this.currentWatchPath && this.watcherSender && !this.watcherSender.isDestroyed()) {
            const mockEvent = { sender: this.watcherSender } as Electron.IpcMainInvokeEvent
            await this.startFileWatcher(mockEvent, this.currentWatchPath, this.watcherConfig)
          }
        } catch (retryError) {
          logger.error('Restart failed', retryError as Error)
        }
      }, this.watcherConfig.retryDelayMs)
    }
  }

  private cleanup() {
    this.currentWatchPath = undefined
    this.watcherSender = undefined
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
  }

  public stopFileWatcher = async (): Promise<void> => {
    try {
      if (this.watcher) {
        logger.info('Stopping file watcher', { path: this.currentWatchPath })
        await this.watcher.close()
        this.watcher = undefined
        logger.debug('File watcher stopped')
      }
      this.cleanup()
    } catch (error) {
      logger.error('Failed to stop file watcher', error as Error)
      this.watcher = undefined
      this.cleanup()
    }
  }

  public getWatcherStatus(): { isActive: boolean; watchPath?: string; hasValidSender: boolean } {
    return {
      isActive: !!this.watcher,
      watchPath: this.currentWatchPath,
      hasValidSender: !!this.watcherSender && !this.watcherSender.isDestroyed()
    }
  }

  public getFilePathById(file: FileMetadata): string {
    return path.join(this.storageDir, file.id + file.ext)
  }

  public isTextFile = async (_: Electron.IpcMainInvokeEvent, filePath: string): Promise<boolean> => {
    try {
      const isBinary = await isBinaryFile(filePath)
      if (isBinary) {
        return false
      }

      const length = 8 * KB
      const fileHandle = await fs.promises.open(filePath, 'r')
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await fileHandle.read(buffer, 0, length, 0)
      await fileHandle.close()

      const sampleBuffer = buffer.subarray(0, bytesRead)
      const matches = chardet.analyse(sampleBuffer)

      // 如果检测到的编码置信度较高，认为是文本文件
      if (matches.length > 0 && matches[0].confidence > 0.8) {
        return true
      }

      return false
    } catch (error) {
      logger.error('Failed to check if file is text:', error as Error)
      return false
    }
  }

  public showInFolder = async (_: Electron.IpcMainInvokeEvent, path: string): Promise<void> => {
    if (!fs.existsSync(path)) {
      const msg = `File or folder does not exist: ${path}`
      logger.error(msg)
      throw new Error(msg)
    }
    try {
      shell.showItemInFolder(path)
    } catch (error) {
      logger.error('Failed to show item in folder:', error as Error)
    }
  }
}

export const fileStorage = new FileStorage()
