import { loggerService } from '@logger'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
import type { PluginError } from '@types'
import * as crypto from 'crypto'
import * as fs from 'fs'

const logger = loggerService.withContext('PluginInstaller')

export class PluginInstaller {
  async installFilePlugin(agentId: string, sourceAbsolutePath: string, destPath: string): Promise<void> {
    const tempPath = `${destPath}.tmp`
    let fileCopied = false

    try {
      await fs.promises.copyFile(sourceAbsolutePath, tempPath)
      fileCopied = true
      logger.debug('File copied to temp location', { agentId, tempPath })

      await fs.promises.rename(tempPath, destPath)
      logger.debug('File moved to final location', { agentId, destPath })
    } catch (error) {
      if (fileCopied) {
        await this.safeUnlink(tempPath, 'temp file')
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
    let folderCopied = false
    const tempPath = `${destPath}.tmp`

    try {
      try {
        await fs.promises.access(destPath)
        await deleteDirectoryRecursive(destPath)
        logContext.info('Removed existing skill folder', { agentId, destPath })
      } catch {
        // No existing folder
      }

      await copyDirectoryRecursive(sourceAbsolutePath, tempPath)
      folderCopied = true
      logContext.info('Skill folder copied to temp location', { agentId, tempPath })

      await fs.promises.rename(tempPath, destPath)
      logContext.info('Skill folder moved to final location', { agentId, destPath })
    } catch (error) {
      if (folderCopied) {
        await this.safeRemoveDirectory(tempPath, 'temp folder')
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
