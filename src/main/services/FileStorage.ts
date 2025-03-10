import { getFilesDir, getFileType, getTempDir } from '@main/utils/file'
import { documentExts, imageExts } from '@shared/config/constant'
import { FileType } from '@types'
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
import * as path from 'path'
import { chdir } from 'process'
import { v4 as uuidv4 } from 'uuid'

class FileStorage {
  private storageDir = getFilesDir()
  private tempDir = getTempDir()

  constructor() {
    this.initStorageDir()
  }

  private initStorageDir = (): void => {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true })
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
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

  findDuplicateFile = async (filePath: string): Promise<FileType | null> => {
    const stats = fs.statSync(filePath)
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
  ): Promise<FileType[] | null> => {
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
      const fileSizeInMB = stats.size / (1024 * 1024)

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

  public uploadFile = async (_: Electron.IpcMainInvokeEvent, file: FileType): Promise<FileType> => {
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

    const fileMetadata: FileType = {
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

    return fileMetadata
  }

  public getFile = async (_: Electron.IpcMainInvokeEvent, filePath: string): Promise<FileType | null> => {
    if (!fs.existsSync(filePath)) {
      return null
    }

    const stats = fs.statSync(filePath)
    const ext = path.extname(filePath)
    const fileType = getFileType(ext)

    const fileInfo: FileType = {
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
    await fs.promises.unlink(path.join(this.storageDir, id))
  }

  public readFile = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<string> => {
    const filePath = path.join(this.storageDir, id)

    if (documentExts.includes(path.extname(filePath))) {
      const originalCwd = process.cwd()
      try {
        chdir(this.tempDir)
        const data = await officeParser.parseOfficeAsync(filePath)
        chdir(originalCwd)
        return data
      } catch (error) {
        chdir(originalCwd)
        logger.error(error)
        throw error
      }
    }

    return fs.readFileSync(filePath, 'utf8')
  }

  public createTempFile = async (_: Electron.IpcMainInvokeEvent, fileName: string): Promise<string> => {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true })
    }
    const tempFilePath = path.join(this.tempDir, `temp_file_${uuidv4()}_${fileName}`)
    return tempFilePath
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

  public binaryFile = async (_: Electron.IpcMainInvokeEvent, id: string): Promise<{ data: Buffer; mime: string }> => {
    const filePath = path.join(this.storageDir, id)
    const data = await fs.promises.readFile(filePath)
    const mime = `image/${path.extname(filePath).slice(1)}`
    return { data, mime }
  }

  public clear = async (): Promise<void> => {
    await fs.promises.rmdir(this.storageDir, { recursive: true })
    await this.initStorageDir()
  }

  public clearTemp = async (): Promise<void> => {
    await fs.promises.rmdir(this.tempDir, { recursive: true })
    await fs.promises.mkdir(this.tempDir, { recursive: true })
  }

  public open = async (
    _: Electron.IpcMainInvokeEvent,
    options: OpenDialogOptions
  ): Promise<{ fileName: string; filePath: string; content: Buffer } | null> => {
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
        const content = await readFile(filePath)
        return { fileName, filePath, content }
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
  ): Promise<string | null> => {
    try {
      const result: SaveDialogReturnValue = await dialog.showSaveDialog({
        title: '保存文件',
        defaultPath: fileName,
        ...options
      })

      if (!result.canceled && result.filePath) {
        await writeFileSync(result.filePath, content, { encoding: 'utf-8' })
      }

      return result.filePath
    } catch (err) {
      logger.error('[IPC - Error]', 'An error occurred saving the file:', err)
      return null
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

  public downloadFile = async (_: Electron.IpcMainInvokeEvent, url: string): Promise<FileType> => {
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
      if (!filename.includes('.')) {
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

      const fileMetadata: FileType = {
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
}

export default FileStorage
