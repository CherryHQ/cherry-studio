import { IpcChannel } from '@shared/IpcChannel'
import { WebDavConfig } from '@types'
import { S3Config } from '@types'
import archiver from 'archiver'
import { exec } from 'child_process'
import { app } from 'electron'
import Logger from 'electron-log'
import * as fs from 'fs-extra'
import StreamZip from 'node-stream-zip'
import * as path from 'path'
import { CreateDirectoryOptions, FileStat } from 'webdav'

import { getDataPath } from '../utils'
import S3Storage from './S3Storage'
import WebDav from './WebDav'
import { windowService } from './WindowService'

class BackupManager {
  private tempDir = path.join(app.getPath('temp'), 'cherry-studio', 'backup', 'temp')
  private backupDir = path.join(app.getPath('temp'), 'cherry-studio', 'backup')

  constructor() {
    this.checkConnection = this.checkConnection.bind(this)
    this.backup = this.backup.bind(this)
    this.restore = this.restore.bind(this)
    this.backupToWebdav = this.backupToWebdav.bind(this)
    this.restoreFromWebdav = this.restoreFromWebdav.bind(this)
    this.listWebdavFiles = this.listWebdavFiles.bind(this)
    this.deleteWebdavFile = this.deleteWebdavFile.bind(this)
    this.listLocalBackupFiles = this.listLocalBackupFiles.bind(this)
    this.deleteLocalBackupFile = this.deleteLocalBackupFile.bind(this)
    this.backupToLocalDir = this.backupToLocalDir.bind(this)
    this.restoreFromLocalBackup = this.restoreFromLocalBackup.bind(this)
    this.setLocalBackupDir = this.setLocalBackupDir.bind(this)
    this.backupToS3 = this.backupToS3.bind(this)
    this.restoreFromS3 = this.restoreFromS3.bind(this)
    this.listS3Files = this.listS3Files.bind(this)
    this.deleteS3File = this.deleteS3File.bind(this)
    this.checkS3Connection = this.checkS3Connection.bind(this)
  }

  private async setWritableRecursive(dirPath: string): Promise<void> {
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true })

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name)

        // 先处理子目录
        if (item.isDirectory()) {
          await this.setWritableRecursive(fullPath)
        }

        // 统一设置权限（Windows需要特殊处理）
        await this.forceSetWritable(fullPath)
      }

      // 确保根目录权限
      await this.forceSetWritable(dirPath)
    } catch (error) {
      Logger.error(`权限设置失败：${dirPath}`, error)
      throw error
    }
  }

  // 新增跨平台权限设置方法
  private async forceSetWritable(targetPath: string): Promise<void> {
    try {
      // Windows系统需要先取消只读属性
      if (process.platform === 'win32') {
        await fs.chmod(targetPath, 0o666) // Windows会忽略权限位但能移除只读
      } else {
        const stats = await fs.stat(targetPath)
        const mode = stats.isDirectory() ? 0o777 : 0o666
        await fs.chmod(targetPath, mode)
      }

      // 双重保险：使用文件属性命令（Windows专用）
      if (process.platform === 'win32') {
        await exec(`attrib -R "${targetPath}" /L /D`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        Logger.warn(`权限设置警告：${targetPath}`, error)
      }
    }
  }

  async backup(
    _: Electron.IpcMainInvokeEvent,
    fileName: string,
    data: string,
    destinationPath: string = this.backupDir,
    skipBackupFile: boolean = false
  ): Promise<string> {
    const mainWindow = windowService.getMainWindow()

    const onProgress = (processData: { stage: string; progress: number; total: number }) => {
      mainWindow?.webContents.send(IpcChannel.BackupProgress, processData)
      // 只在关键阶段记录日志：开始、结束和主要阶段转换点
      const logStages = ['preparing', 'writing_data', 'preparing_compression', 'completed']
      if (logStages.includes(processData.stage) || processData.progress === 100) {
        Logger.log('[BackupManager] backup progress', processData)
      }
    }

    try {
      await fs.ensureDir(this.tempDir)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      // 使用流的方式写入 data.json
      const tempDataPath = path.join(this.tempDir, 'data.json')

      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(tempDataPath)
        writeStream.write(data)
        writeStream.end()

        writeStream.on('finish', () => resolve())
        writeStream.on('error', (error) => reject(error))
      })

      onProgress({ stage: 'writing_data', progress: 20, total: 100 })

      Logger.log('[BackupManager IPC] ', skipBackupFile)

      if (!skipBackupFile) {
        // 复制 Data 目录到临时目录
        const sourcePath = path.join(app.getPath('userData'), 'Data')
        const tempDataDir = path.join(this.tempDir, 'Data')

        // 获取源目录总大小
        const totalSize = await this.getDirSize(sourcePath)
        let copiedSize = 0

        // 使用流式复制
        await this.copyDirWithProgress(sourcePath, tempDataDir, (size) => {
          copiedSize += size
          const progress = Math.min(50, Math.floor((copiedSize / totalSize) * 50))
          onProgress({ stage: 'copying_files', progress, total: 100 })
        })

        await this.setWritableRecursive(tempDataDir)
        onProgress({ stage: 'preparing_compression', progress: 50, total: 100 })
      } else {
        Logger.log('[BackupManager] Skip the backup of the file')
        await fs.promises.mkdir(path.join(this.tempDir, 'Data')) // 不创建空 Data 目录会导致 restore 失败
      }

      // 创建输出文件流
      const backupedFilePath = path.join(destinationPath, fileName)
      const output = fs.createWriteStream(backupedFilePath)

      // 创建 archiver 实例，启用 ZIP64 支持
      const archive = archiver('zip', {
        zlib: { level: 1 }, // 使用最低压缩级别以提高速度
        zip64: true // 启用 ZIP64 支持以处理大文件
      })

      let lastProgress = 50
      let totalEntries = 0
      let processedEntries = 0
      let totalBytes = 0
      let processedBytes = 0

      // 首先计算总文件数和总大小，但不记录详细日志
      const calculateTotals = async (dirPath: string) => {
        try {
          const items = await fs.readdir(dirPath, { withFileTypes: true })
          for (const item of items) {
            const fullPath = path.join(dirPath, item.name)
            if (item.isDirectory()) {
              await calculateTotals(fullPath)
            } else {
              totalEntries++
              const stats = await fs.stat(fullPath)
              totalBytes += stats.size
            }
          }
        } catch (error) {
          // 仅在出错时记录日志
          Logger.error('[BackupManager] Error calculating totals:', error)
        }
      }

      await calculateTotals(this.tempDir)

      // 监听文件添加事件
      archive.on('entry', () => {
        processedEntries++
        if (totalEntries > 0) {
          const progressPercent = Math.min(55, 50 + Math.floor((processedEntries / totalEntries) * 5))
          if (progressPercent > lastProgress) {
            lastProgress = progressPercent
            onProgress({ stage: 'compressing', progress: progressPercent, total: 100 })
          }
        }
      })

      // 监听数据写入事件
      archive.on('data', (chunk) => {
        processedBytes += chunk.length
        if (totalBytes > 0) {
          const progressPercent = Math.min(99, 55 + Math.floor((processedBytes / totalBytes) * 44))
          if (progressPercent > lastProgress) {
            lastProgress = progressPercent
            onProgress({ stage: 'compressing', progress: progressPercent, total: 100 })
          }
        }
      })

      // 使用 Promise 等待压缩完成
      await new Promise<void>((resolve, reject) => {
        output.on('close', () => {
          onProgress({ stage: 'compressing', progress: 100, total: 100 })
          resolve()
        })
        archive.on('error', reject)
        archive.on('warning', (err: any) => {
          if (err.code !== 'ENOENT') {
            Logger.warn('[BackupManager] Archive warning:', err)
          }
        })

        // 将输出流连接到压缩器
        archive.pipe(output)

        // 添加整个临时目录到压缩文件
        archive.directory(this.tempDir, false)

        // 完成压缩
        archive.finalize()
      })

      // 清理临时目录
      await fs.remove(this.tempDir)
      onProgress({ stage: 'completed', progress: 100, total: 100 })

      Logger.log('[BackupManager] Backup completed successfully')
      return backupedFilePath
    } catch (error) {
      Logger.error('[BackupManager] Backup failed:', error)
      // 确保清理临时目录
      await fs.remove(this.tempDir).catch(() => {})
      throw error
    }
  }

  async restore(_: Electron.IpcMainInvokeEvent, backupPath: string): Promise<string> {
    const mainWindow = windowService.getMainWindow()

    const onProgress = (processData: { stage: string; progress: number; total: number }) => {
      mainWindow?.webContents.send(IpcChannel.RestoreProgress, processData)
      // 只在关键阶段记录日志
      const logStages = ['preparing', 'extracting', 'extracted', 'reading_data', 'completed']
      if (logStages.includes(processData.stage) || processData.progress === 100) {
        Logger.log('[BackupManager] restore progress', processData)
      }
    }

    try {
      // 创建临时目录
      await fs.ensureDir(this.tempDir)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      Logger.log('[backup] step 1: unzip backup file', this.tempDir)

      const zip = new StreamZip.async({ file: backupPath })
      onProgress({ stage: 'extracting', progress: 15, total: 100 })
      await zip.extract(null, this.tempDir)
      onProgress({ stage: 'extracted', progress: 25, total: 100 })

      Logger.log('[backup] step 2: read data.json')
      // 读取 data.json
      const dataPath = path.join(this.tempDir, 'data.json')
      const data = await fs.readFile(dataPath, 'utf-8')
      onProgress({ stage: 'reading_data', progress: 35, total: 100 })

      Logger.log('[backup] step 3: restore Data directory')
      // 恢复 Data 目录
      const sourcePath = path.join(this.tempDir, 'Data')
      const destPath = getDataPath()

      const dataExists = await fs.pathExists(sourcePath)
      const dataFiles = dataExists ? await fs.readdir(sourcePath) : []

      if (dataExists && dataFiles.length > 0) {
        // 获取源目录总大小
        const totalSize = await this.getDirSize(sourcePath)
        let copiedSize = 0

        await this.setWritableRecursive(destPath)
        await fs.remove(destPath)

        // 使用流式复制
        await this.copyDirWithProgress(sourcePath, destPath, (size) => {
          copiedSize += size
          const progress = Math.min(85, 35 + Math.floor((copiedSize / totalSize) * 50))
          onProgress({ stage: 'copying_files', progress, total: 100 })
        })
      } else {
        Logger.log('[backup] skipBackupFile is true, skip restoring Data directory')
      }

      Logger.log('[backup] step 4: clean up temp directory')
      // 清理临时目录
      await this.setWritableRecursive(this.tempDir)
      await fs.remove(this.tempDir)
      onProgress({ stage: 'completed', progress: 100, total: 100 })

      Logger.log('[backup] step 5: Restore completed successfully')

      return data
    } catch (error) {
      Logger.error('[backup] Restore failed:', error)
      await fs.remove(this.tempDir).catch(() => {})
      throw error
    }
  }

  async backupToWebdav(_: Electron.IpcMainInvokeEvent, data: string, webdavConfig: WebDavConfig) {
    const filename = webdavConfig.fileName || 'cherry-studio.backup.zip'
    const backupedFilePath = await this.backup(_, filename, data, undefined, webdavConfig.skipBackupFile)
    const contentLength = (await fs.stat(backupedFilePath)).size
    const webdavClient = new WebDav(webdavConfig)
    try {
      const result = await webdavClient.putFileContents(filename, fs.createReadStream(backupedFilePath), {
        overwrite: true,
        contentLength
      })
      // 上传成功后删除本地备份文件
      await fs.remove(backupedFilePath)
      return result
    } catch (error) {
      // 上传失败时也删除本地临时文件
      await fs.remove(backupedFilePath).catch(() => {})
      throw error
    }
  }

  async restoreFromWebdav(_: Electron.IpcMainInvokeEvent, webdavConfig: WebDavConfig) {
    const filename = webdavConfig.fileName || 'cherry-studio.backup.zip'
    const webdavClient = new WebDav(webdavConfig)
    try {
      const retrievedFile = await webdavClient.getFileContents(filename)
      const backupedFilePath = path.join(this.backupDir, filename)

      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true })
      }

      // 使用流的方式写入文件
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(backupedFilePath)
        writeStream.write(retrievedFile as Buffer)
        writeStream.end()

        writeStream.on('finish', () => resolve())
        writeStream.on('error', (error) => reject(error))
      })

      return await this.restore(_, backupedFilePath)
    } catch (error: any) {
      Logger.error('[backup] Failed to restore from WebDAV:', error)
      throw new Error(error.message || 'Failed to restore backup file')
    }
  }

  listWebdavFiles = async (_: Electron.IpcMainInvokeEvent, config: WebDavConfig) => {
    try {
      const client = new WebDav(config)
      const response = await client.getDirectoryContents()
      const files = Array.isArray(response) ? response : response.data

      return files
        .filter((file: FileStat) => file.type === 'file' && file.basename.endsWith('.zip'))
        .map((file: FileStat) => ({
          fileName: file.basename,
          modifiedTime: file.lastmod,
          size: file.size
        }))
        .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    } catch (error: any) {
      Logger.error('Failed to list WebDAV files:', error)
      throw new Error(error.message || 'Failed to list backup files')
    }
  }

  private async getDirSize(dirPath: string): Promise<number> {
    let size = 0
    const items = await fs.readdir(dirPath, { withFileTypes: true })

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name)
      if (item.isDirectory()) {
        size += await this.getDirSize(fullPath)
      } else {
        const stats = await fs.stat(fullPath)
        size += stats.size
      }
    }
    return size
  }

  private async copyDirWithProgress(
    source: string,
    destination: string,
    onProgress: (size: number) => void
  ): Promise<void> {
    // 先统计总文件数
    let totalFiles = 0
    let processedFiles = 0
    let lastProgressReported = 0

    // 计算总文件数
    const countFiles = async (dir: string): Promise<number> => {
      let count = 0
      const items = await fs.readdir(dir, { withFileTypes: true })
      for (const item of items) {
        if (item.isDirectory()) {
          count += await countFiles(path.join(dir, item.name))
        } else {
          count++
        }
      }
      return count
    }

    totalFiles = await countFiles(source)

    // 复制文件并更新进度
    const copyDir = async (src: string, dest: string): Promise<void> => {
      const items = await fs.readdir(src, { withFileTypes: true })

      for (const item of items) {
        const sourcePath = path.join(src, item.name)
        const destPath = path.join(dest, item.name)

        if (item.isDirectory()) {
          await fs.ensureDir(destPath)
          await copyDir(sourcePath, destPath)
        } else {
          const stats = await fs.stat(sourcePath)
          await fs.copy(sourcePath, destPath)
          processedFiles++

          // 只在进度变化超过5%时报告进度
          const currentProgress = Math.floor((processedFiles / totalFiles) * 100)
          if (currentProgress - lastProgressReported >= 5 || processedFiles === totalFiles) {
            lastProgressReported = currentProgress
            onProgress(stats.size)
          }
        }
      }
    }

    await copyDir(source, destination)
  }

  async checkConnection(_: Electron.IpcMainInvokeEvent, webdavConfig: WebDavConfig) {
    const webdavClient = new WebDav(webdavConfig)
    return await webdavClient.checkConnection()
  }

  async createDirectory(
    _: Electron.IpcMainInvokeEvent,
    webdavConfig: WebDavConfig,
    path: string,
    options?: CreateDirectoryOptions
  ) {
    const webdavClient = new WebDav(webdavConfig)
    return await webdavClient.createDirectory(path, options)
  }

  async deleteWebdavFile(_: Electron.IpcMainInvokeEvent, fileName: string, webdavConfig: WebDavConfig) {
    try {
      const webdavClient = new WebDav(webdavConfig)
      return await webdavClient.deleteFile(fileName)
    } catch (error: any) {
      Logger.error('Failed to delete WebDAV file:', error)
      throw new Error(error.message || 'Failed to delete backup file')
    }
  }

  async backupToLocalDir(
    _: Electron.IpcMainInvokeEvent,
    data: string,
    fileName: string,
    localConfig: {
      localBackupDir: string
      skipBackupFile: boolean
    }
  ) {
    try {
      const backupDir = localConfig.localBackupDir
      // Create backup directory if it doesn't exist
      await fs.ensureDir(backupDir)

      const backupedFilePath = await this.backup(_, fileName, data, backupDir, localConfig.skipBackupFile)
      return backupedFilePath
    } catch (error) {
      Logger.error('[BackupManager] Local backup failed:', error)
      throw error
    }
  }

  async backupToS3(_: Electron.IpcMainInvokeEvent, data: string, s3Config: S3Config) {
    const os = require('os')
    const deviceName = os.hostname ? os.hostname() : 'device'
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 14)
    const filename = s3Config.fileName || `cherry-studio.backup.${deviceName}.${timestamp}.zip`

    Logger.log(`[BackupManager] Starting S3 backup to ${filename}`)

    const backupedFilePath = await this.backup(_, filename, data, undefined, s3Config.skipBackupFile)
    const s3Client = new S3Storage(s3Config)
    try {
      const fileBuffer = await fs.promises.readFile(backupedFilePath)
      const result = await s3Client.putFileContents(filename, fileBuffer)
      await fs.remove(backupedFilePath)

      Logger.log(`[BackupManager] S3 backup completed successfully: ${filename}`)
      return result
    } catch (error) {
      Logger.error(`[BackupManager] S3 backup failed:`, error)
      await fs.remove(backupedFilePath)
      throw error
    }
  }

  async restoreFromLocalBackup(_: Electron.IpcMainInvokeEvent, fileName: string, localBackupDir: string) {
    try {
      const backupDir = localBackupDir
      const backupPath = path.join(backupDir, fileName)

      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`)
      }

      return await this.restore(_, backupPath)
    } catch (error) {
      Logger.error('[BackupManager] Local restore failed:', error)
      throw error
    }
  }

  async listLocalBackupFiles(_: Electron.IpcMainInvokeEvent, localBackupDir: string) {
    try {
      const files = await fs.readdir(localBackupDir)
      const result: Array<{ fileName: string; modifiedTime: string; size: number }> = []

      for (const file of files) {
        const filePath = path.join(localBackupDir, file)
        const stat = await fs.stat(filePath)

        if (stat.isFile() && file.endsWith('.zip')) {
          result.push({
            fileName: file,
            modifiedTime: stat.mtime.toISOString(),
            size: stat.size
          })
        }
      }

      // Sort by modified time, newest first
      return result.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    } catch (error) {
      Logger.error('[BackupManager] List local backup files failed:', error)
      throw error
    }
  }

  async deleteLocalBackupFile(_: Electron.IpcMainInvokeEvent, fileName: string, localBackupDir: string) {
    try {
      const filePath = path.join(localBackupDir, fileName)

      if (!fs.existsSync(filePath)) {
        throw new Error(`Backup file not found: ${filePath}`)
      }

      await fs.remove(filePath)
      return true
    } catch (error) {
      Logger.error('[BackupManager] Delete local backup file failed:', error)
      throw error
    }
  }

  async setLocalBackupDir(_: Electron.IpcMainInvokeEvent, dirPath: string) {
    try {
      // Check if directory exists
      await fs.ensureDir(dirPath)
      return true
    } catch (error) {
      Logger.error('[BackupManager] Set local backup directory failed:', error)
      throw error
    }
  }

  async restoreFromS3(_: Electron.IpcMainInvokeEvent, s3Config: S3Config) {
    const filename = s3Config.fileName || 'cherry-studio.backup.zip'

    Logger.log(`[BackupManager] Starting restore from S3: ${filename}`)

    const s3Client = new S3Storage(s3Config)
    try {
      const retrievedFile = await s3Client.getFileContents(filename)
      const backupedFilePath = path.join(this.backupDir, filename)
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true })
      }
      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(backupedFilePath)
        writeStream.write(retrievedFile as Buffer)
        writeStream.end()
        writeStream.on('finish', () => resolve())
        writeStream.on('error', (error) => reject(error))
      })

      Logger.log(`[BackupManager] S3 restore file downloaded successfully: ${filename}`)
      return await this.restore(_, backupedFilePath)
    } catch (error: any) {
      Logger.error('[BackupManager] Failed to restore from S3:', error)
      throw new Error(error.message || 'Failed to restore backup file')
    }
  }

  listS3Files = async (_: Electron.IpcMainInvokeEvent, s3Config: S3Config) => {
    try {
      const s3Client = new S3Storage(s3Config)

      const objects = await s3Client.listFiles()
      const files = objects
        .filter((obj) => obj.key.endsWith('.zip'))
        .map((obj) => {
          const segments = obj.key.split('/')
          const fileName = segments[segments.length - 1]
          return {
            fileName,
            modifiedTime: obj.lastModified || '',
            size: obj.size
          }
        })

      return files.sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    } catch (error: any) {
      Logger.error('Failed to list S3 files:', error)
      throw new Error(error.message || 'Failed to list backup files')
    }
  }

  async deleteS3File(_: Electron.IpcMainInvokeEvent, fileName: string, s3Config: S3Config) {
    try {
      const s3Client = new S3Storage(s3Config)
      return await s3Client.deleteFile(fileName)
    } catch (error: any) {
      Logger.error('Failed to delete S3 file:', error)
      throw new Error(error.message || 'Failed to delete backup file')
    }
  }

  async checkS3Connection(_: Electron.IpcMainInvokeEvent, s3Config: S3Config) {
    const s3Client = new S3Storage(s3Config)
    return await s3Client.checkConnection()
  }
}

export default BackupManager
