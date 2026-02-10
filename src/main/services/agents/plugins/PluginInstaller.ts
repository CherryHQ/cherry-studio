import { loggerService } from '@logger'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
import type { PluginError } from '@types'
import * as crypto from 'crypto'
import * as fs from 'fs'

const logger = loggerService.withContext('PluginInstaller')

export class PluginInstaller {
  async installFilePlugin(agentId: string, sourceAbsolutePath: string, destPath: string): Promise<void> {
    const backupPath = `${destPath}.bak`
    let hasBackup = false

    try {
      // Backup existing file before overwriting
      if (await this.pathExists(destPath)) {
        await this.safeUnlink(backupPath, 'stale backup')
        await fs.promises.rename(destPath, backupPath)
        hasBackup = true
        logger.debug('Backed up existing plugin file', { agentId, backupPath })
      }

      await fs.promises.copyFile(sourceAbsolutePath, destPath)
      logger.debug('File copied to destination', { agentId, destPath })

      if (hasBackup) {
        await this.safeUnlink(backupPath, 'backup file')
      }
    } catch (error) {
      if (hasBackup) {
        await this.safeUnlink(destPath, 'partial file')
        await this.safeRename(backupPath, destPath, 'plugin backup')
      }
      throw this.toPluginError('install', error)
    }
  }

  async uninstallFilePlugin(
    agentId: string,
    filename: string,
    type: 'agent' | 'command',
    filePath: string
  ): Promise<void> {
    try {
      await fs.promises.unlink(filePath)
      logger.debug('Plugin file deleted', { agentId, filename, type, filePath })
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== 'ENOENT') {
        throw this.toPluginError('uninstall', error)
      }
      logger.warn('Plugin file already deleted', { agentId, filename, type, filePath })
    }
  }

  async updateFilePluginContent(agentId: string, filePath: string, content: string): Promise<string> {
    try {
      await fs.promises.access(filePath, fs.constants.W_OK)
    } catch {
      throw {
        type: 'FILE_NOT_FOUND',
        path: filePath
      } as PluginError
    }

    try {
      await fs.promises.writeFile(filePath, content, 'utf8')
      logger.debug('Plugin content written successfully', {
        agentId,
        filePath,
        size: Buffer.byteLength(content, 'utf8')
      })
    } catch (error) {
      throw {
        type: 'WRITE_FAILED',
        path: filePath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }

    return crypto.createHash('sha256').update(content).digest('hex')
  }

  async installSkill(agentId: string, sourceAbsolutePath: string, destPath: string): Promise<void> {
    const logContext = logger.withContext('installSkill')
    const backupPath = `${destPath}.bak`
    let hasBackup = false

    try {
      // Backup existing folder before overwriting
      if (await this.pathExists(destPath)) {
        await this.safeRemoveDirectory(backupPath, 'stale backup')
        await fs.promises.rename(destPath, backupPath)
        hasBackup = true
        logContext.info('Backed up existing skill folder', { agentId, backupPath })
      }

      await copyDirectoryRecursive(sourceAbsolutePath, destPath)
      logContext.info('Skill folder copied to destination', { agentId, destPath })

      if (hasBackup) {
        await this.safeRemoveDirectory(backupPath, 'backup folder')
      }
    } catch (error) {
      if (hasBackup) {
        await this.safeRemoveDirectory(destPath, 'partial skill folder')
        await this.safeRename(backupPath, destPath, 'skill backup')
      }
      throw this.toPluginError('install-skill', error)
    }
  }

  async uninstallSkill(agentId: string, folderName: string, skillPath: string): Promise<void> {
    const logContext = logger.withContext('uninstallSkill')

    try {
      await deleteDirectoryRecursive(skillPath)
      logContext.info('Skill folder deleted', { agentId, folderName, skillPath })
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code !== 'ENOENT') {
        throw this.toPluginError('uninstall-skill', error)
      }
      logContext.warn('Skill folder already deleted', { agentId, folderName, skillPath })
    }
  }

  private toPluginError(operation: string, error: unknown): PluginError {
    return {
      type: 'TRANSACTION_FAILED',
      operation,
      reason: error instanceof Error ? error.message : String(error)
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.promises.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private async safeRename(from: string, to: string, label: string): Promise<void> {
    try {
      await fs.promises.rename(from, to)
      logger.debug(`Restored ${label}`, { from, to })
    } catch (error) {
      logger.error(`Failed to restore ${label}`, {
        from,
        to,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async safeUnlink(targetPath: string, label: string): Promise<void> {
    try {
      await fs.promises.unlink(targetPath)
      logger.debug(`Rolled back ${label}`, { targetPath })
    } catch (unlinkError) {
      logger.error(`Failed to rollback ${label}`, {
        targetPath,
        error: unlinkError instanceof Error ? unlinkError.message : String(unlinkError)
      })
    }
  }

  private async safeRemoveDirectory(targetPath: string, label: string): Promise<void> {
    try {
      await deleteDirectoryRecursive(targetPath)
      logger.info(`Rolled back ${label}`, { targetPath })
    } catch (unlinkError) {
      logger.error(`Failed to rollback ${label}`, {
        targetPath,
        error: unlinkError instanceof Error ? unlinkError.message : String(unlinkError)
      })
    }
  }
}
