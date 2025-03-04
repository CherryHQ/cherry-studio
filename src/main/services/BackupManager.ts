import { WebDavConfig } from '@types'
import AdmZip from 'adm-zip'
import { exec } from 'child_process'
import { app } from 'electron'
import Logger from 'electron-log'
import * as fs from 'fs-extra'
import * as path from 'path'

import WebDav from './WebDav'
import { windowService } from './WindowService'

class BackupManager {
  private tempDir = path.join(app.getPath('temp'), 'cherry-studio', 'backup', 'temp')
  private backupDir = path.join(app.getPath('temp'), 'cherry-studio', 'backup')

  constructor() {
    this.backup = this.backup.bind(this)
    this.restore = this.restore.bind(this)
    this.backupToWebdav = this.backupToWebdav.bind(this)
    this.restoreFromWebdav = this.restoreFromWebdav.bind(this)
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
    destinationPath: string = this.backupDir
  ): Promise<string> {
    const mainWindow = windowService.getMainWindow()

    const onProgress = (processData: { stage: string; progress: number; total: number }) => {
      mainWindow?.webContents.send('backup-progress', processData)
      Logger.log('[BackupManager] backup progress', processData)
    }

    try {
      await fs.ensureDir(this.tempDir)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      // 将 data 写入临时文件
      const tempDataPath = path.join(this.tempDir, 'data.json')
      await fs.writeFile(tempDataPath, data)
      onProgress({ stage: 'writing_data', progress: 20, total: 100 })

      // 复制 Data 目录到临时目录
      const sourcePath = path.join(app.getPath('userData'), 'Data')
      const tempDataDir = path.join(this.tempDir, 'Data')

      // 获取源目录总大小
      const totalSize = await this.getDirSize(sourcePath)
      let copiedSize = 0

      // 使用流式复制
      await this.copyDirWithProgress(sourcePath, tempDataDir, (size) => {
        copiedSize += size
        const progress = Math.min(80, 20 + Math.floor((copiedSize / totalSize) * 60))
        onProgress({ stage: 'copying_files', progress, total: 100 })
      })

      await this.setWritableRecursive(tempDataDir)
      onProgress({ stage: 'compressing', progress: 80, total: 100 })

      // 使用 adm-zip 创建压缩文件
      const zip = new AdmZip()
      zip.addLocalFolder(this.tempDir)
      const backupedFilePath = path.join(destinationPath, fileName)
      zip.writeZip(backupedFilePath)

      // 清理临时目录
      await fs.remove(this.tempDir)
      onProgress({ stage: 'completed', progress: 100, total: 100 })

      Logger.log('Backup completed successfully')
      return backupedFilePath
    } catch (error) {
      Logger.error('Backup failed:', error)
      throw error
    }
  }

  async restore(_: Electron.IpcMainInvokeEvent, backupPath: string): Promise<string> {
    const mainWindow = windowService.getMainWindow()

    const onProgress = (processData: { stage: string; progress: number; total: number }) => {
      mainWindow?.webContents.send('restore-progress', processData)
      Logger.log('[BackupManager] restore progress', processData)
    }

    try {
      // 创建临时目录
      await fs.ensureDir(this.tempDir)
      onProgress({ stage: 'preparing', progress: 0, total: 100 })

      Logger.log('[backup] step 1: unzip backup file', this.tempDir)
      // 使用 adm-zip 解压
      const zip = new AdmZip(backupPath)
      zip.extractAllTo(this.tempDir, true) // true 表示覆盖已存在的文件
      onProgress({ stage: 'extracting', progress: 20, total: 100 })

      Logger.log('[backup] step 2: read data.json')
      // 读取 data.json
      const dataPath = path.join(this.tempDir, 'data.json')
      const data = await fs.readFile(dataPath, 'utf-8')
      onProgress({ stage: 'reading_data', progress: 40, total: 100 })

      Logger.log('[backup] step 3: restore Data directory')
      // 恢复 Data 目录
      const sourcePath = path.join(this.tempDir, 'Data')
      const destPath = path.join(app.getPath('userData'), 'Data')

      // 获取源目录总大小
      const totalSize = await this.getDirSize(sourcePath)
      let copiedSize = 0

      await this.setWritableRecursive(destPath)
      await fs.remove(destPath)

      // 使用流式复制
      await this.copyDirWithProgress(sourcePath, destPath, (size) => {
        copiedSize += size
        const progress = Math.min(90, 40 + Math.floor((copiedSize / totalSize) * 50))
        onProgress({ stage: 'copying_files', progress, total: 100 })
      })

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
    const filename = 'cherry-studio.backup.zip'
    const backupedFilePath = await this.backup(_, filename, data)
    const webdavClient = new WebDav(webdavConfig)
    return await webdavClient.putFileContents(filename, fs.createReadStream(backupedFilePath), {
      overwrite: true
    })
  }

  async restoreFromWebdav(_: Electron.IpcMainInvokeEvent, webdavConfig: WebDavConfig) {
    const filename = 'cherry-studio.backup.zip'
    const webdavClient = new WebDav(webdavConfig)
    const retrievedFile = await webdavClient.getFileContents(filename)
    const backupedFilePath = path.join(this.backupDir, filename)

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true })
    }

    await fs.writeFileSync(backupedFilePath, retrievedFile as Buffer)

    return await this.restore(_, backupedFilePath)
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
    const items = await fs.readdir(source, { withFileTypes: true })

    for (const item of items) {
      const sourcePath = path.join(source, item.name)
      const destPath = path.join(destination, item.name)

      if (item.isDirectory()) {
        await fs.ensureDir(destPath)
        await this.copyDirWithProgress(sourcePath, destPath, onProgress)
      } else {
        const stats = await fs.stat(sourcePath)
        await fs.copy(sourcePath, destPath)
        onProgress(stats.size)
      }
    }
  }
}

export default BackupManager
