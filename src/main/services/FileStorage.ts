import { getFilesDir, getFileType, getTempDir, readTextFileWithAutoEncoding } from '@main/utils/file'
import { documentExts, imageExts, MB } from '@shared/config/constant'
import { FileMetadata } from '@types'
import * as crypto from 'crypto'
import {
  dialog,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
  shell
} from 'electron'
import logger from 'electron-log'
import * as fs from 'fs'
import { writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import officeParser from 'officeparser'
import { getDocument } from 'officeparser/pdfjs-dist-build/pdf.js'
import * as path from 'path'
import { chdir } from 'process'
import { v4 as uuidv4 } from 'uuid'
import WordExtractor from 'word-extractor'

class FileStorage {
  private storageDir = getFilesDir()
  private tempDir = getTempDir()

  constructor() {
    this.initStorageDir()
  }

  private initStorageDir = (): void => {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true })
      }
    } catch (error) {
      logger.error('[FileStorage] Failed to initialize storage directories:', error)
      throw error
    }
  }

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
    console.log('stats', stats, filePath)
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
          logger.info('[FileStorage] Image compressed successfully:', sourcePath)
        } catch (jimpError) {
          logger.error('[FileStorage] Image compression failed:', jimpError)
          await fs.promises.copyFile(sourcePath, destPath)
        }
      } else {
        // 小图片直接复制
        await fs.promises.copyFile(sourcePath, destPath)
      }
    } catch (error) {
      logger.error('[FileStorage] Image handling failed:', error)
      // 错误情况下直接复制原文件
      await fs.promises.copyFile(sourcePath, destPath)
    }
  }

  public uploadFile = async (_: Electron.IpcMainInvokeEvent, file: FileMetadata): Promise<FileMetadata> => {
    const duplicateFile = await this.findDuplicateFile(file.path)

    if (duplicateFile) {
      return duplicateFile
    }

    const uuid = uuidv4()
    const origin_name = path.basename(file.path)
    const ext = path.extname(origin_name).toLowerCase()
    const destPath = path.join(this.storageDir, uuid + ext)

    logger.info('[FileStorage] Uploading file:', file.path)

    // 根据文件类型选择处理方式
    if (imageExts.includes(ext)) {
      await this.compressImage(file.path, destPath)
    } else {
      await fs.promises.copyFile(file.path, destPath)
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

    logger.info('[FileStorage] File uploaded:', fileMetadata)

    return fileMetadata
  }

  public getFile = async (_: Electron.IpcMainInvokeEvent, filePath: string): Promise<FileMetadata | null> => {
    if (!fs.existsSync(filePath)) {
      return null
    }

    const stats = fs.statSync(filePath)
    const ext = path.extname(filePath)
    const fileType = getFileType(ext)

    const fileInfo: FileMetadata = {
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

    return fileInfo
  }

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

  public readFile = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<string> => {
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
        logger.error(error)
        throw error
      }
    }

    try {
      const result = readTextFileWithAutoEncoding(filePath)
      return result
    } catch (error) {
      logger.error(error)
      return 'failed to read file'
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

      logger.info('[FileStorage] Saving base64 image:', {
        storageDir: this.storageDir,
        destPath,
        bufferSize: buffer.length
      })

      // 确保目录存在
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true })
      }

      await fs.promises.writeFile(destPath, buffer)

      const fileMetadata: FileMetadata = {
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

      return fileMetadata
    } catch (error) {
      logger.error('[FileStorage] Failed to save base64 image:', error)
      throw error
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

    const doc = await getDocument({ data: buffer }).promise
    const pages = doc.numPages
    await doc.destroy()
    return pages
  }

  public binaryImage = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<{ data: Buffer; mime: string }> => {
    const filePath = path.join(this.storageDir, id)
    const data = await fs.promises.readFile(filePath)
    const mime = `image/${path.extname(filePath).slice(1)}`
    return { data, mime }
  }

  public clear = async (): Promise<void> => {
    await fs.promises.rm(this.storageDir, { recursive: true })
    await this.initStorageDir()
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
      logger.error('[IPC - Error]', 'An error occurred opening the file:', err)
      return null
    }
  }

  public openPath = async (_: Electron.IpcMainInvokeEvent, path: string): Promise<void> => {
    shell.openPath(path).catch((err) => logger.error('[IPC - Error] Failed to open file:', err))
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
        await writeFileSync(result.filePath, content, { encoding: 'utf-8' })
      }

      return result.filePath
    } catch (err: any) {
      logger.error('[IPC - Error]', 'An error occurred saving the file:', err)
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
      logger.error('[IPC - Error]', 'An error occurred saving the image:', error)
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
      logger.error('[IPC - Error]', 'An error occurred selecting the folder:', err)
      return null
    }
  }

  public downloadFile = async (
    _: Electron.IpcMainInvokeEvent,
    url: string,
    isUseContentType?: boolean
  ): Promise<FileMetadata> => {
    try {
      const response = await fetch(url)
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

      const fileMetadata: FileMetadata = {
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

      return fileMetadata
    } catch (error) {
      logger.error('[FileStorage] Download file error:', error)
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
      logger.info('[FileStorage] File copied successfully:', { from: sourcePath, to: destPath })
    } catch (error) {
      logger.error('[FileStorage] Copy file failed:', error)
      throw error
    }
  }

  public writeFileWithId = async (_: Electron.IpcMainInvokeEvent, id: string, content: string): Promise<void> => {
    try {
      const filePath = path.join(this.storageDir, id)
      logger.info('[FileStorage] Writing file:', filePath)

      // 确保目录存在
      if (!fs.existsSync(this.storageDir)) {
        logger.info('[FileStorage] Creating storage directory:', this.storageDir)
        fs.mkdirSync(this.storageDir, { recursive: true })
      }

      await fs.promises.writeFile(filePath, content, 'utf8')
      logger.info('[FileStorage] File written successfully:', filePath)
    } catch (error) {
      logger.error('[FileStorage] Failed to write file:', error)
      throw error
    }
  }
}

export default FileStorage
