import { loggerService } from '@logger'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
import type {
  AgentConfiguration,
  AgentEntity,
  PluginError,
  PluginMetadata,
  PluginType,
  UpdateAgentRequest
} from '@types'
import * as crypto from 'crypto'
import * as fs from 'fs'

type AgentUpdater = (agentId: string, updates: UpdateAgentRequest) => Promise<AgentEntity | null>

type AgentInstalledPluginRecord = NonNullable<AgentConfiguration['installed_plugins']>[number]

const logger = loggerService.withContext('PluginInstaller')

export class PluginInstaller {
  constructor(private readonly updateAgent: AgentUpdater) {}

  async installFilePlugin(
    agent: AgentEntity,
    sourceAbsolutePath: string,
    destPath: string,
    metadata: PluginMetadata
  ): Promise<void> {
    const tempPath = `${destPath}.tmp`
    let fileCopied = false

    try {
      await fs.promises.copyFile(sourceAbsolutePath, tempPath)
      fileCopied = true
      logger.debug('File copied to temp location', { tempPath })

      const updatedPlugins = this.buildUpdatedPlugins(agent, (existing) => [
        ...existing.filter((p) => !(p.filename === metadata.filename && p.type === metadata.type)),
        this.createPluginRecord(metadata)
      ])

      await this.persistInstalledPlugins(agent, updatedPlugins)
      await fs.promises.rename(tempPath, destPath)
      logger.debug('File moved to final location', { destPath })
    } catch (error) {
      if (fileCopied) {
        await this.safeUnlink(tempPath, 'temp file')
      }
      throw this.toPluginError('install', error)
    }
  }

  async uninstallFilePlugin(
    agent: AgentEntity,
    filename: string,
    type: 'agent' | 'command',
    filePath: string
  ): Promise<void> {
    const originalPlugins = agent.configuration?.installed_plugins || []
    const updatedPlugins = originalPlugins.filter((p) => !(p.filename === filename && p.type === type))

    let dbUpdated = false

    try {
      await this.persistInstalledPlugins(agent, updatedPlugins)
      dbUpdated = true
      logger.debug('Agent configuration updated', { agentId: agent.id })

      try {
        await fs.promises.unlink(filePath)
        logger.debug('Plugin file deleted', { filePath })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code !== 'ENOENT') {
          throw error
        }
        logger.warn('Plugin file already deleted', { filePath })
      }
    } catch (error) {
      if (dbUpdated) {
        await this.rollbackInstalledPlugins(agent, originalPlugins)
      }
      throw this.toPluginError('uninstall', error)
    }
  }

  async updateFilePluginContent(
    agent: AgentEntity,
    type: 'agent' | 'command',
    filename: string,
    filePath: string,
    content: string
  ): Promise<string> {
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
        filePath,
        size: content.length
      })
    } catch (error) {
      throw {
        type: 'WRITE_FAILED',
        path: filePath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }

    const newContentHash = crypto.createHash('sha256').update(content).digest('hex')
    const updatedPlugins = this.buildUpdatedPlugins(agent, (existing) =>
      existing.map((p) =>
        p.filename === filename && p.type === type
          ? {
              ...p,
              contentHash: newContentHash,
              updatedAt: Date.now()
            }
          : p
      )
    )

    try {
      await this.persistInstalledPlugins(agent, updatedPlugins)
    } catch (error) {
      throw {
        type: 'WRITE_FAILED',
        path: filePath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }

    return newContentHash
  }

  async installSkill(
    agent: AgentEntity,
    sourceAbsolutePath: string,
    destPath: string,
    metadata: PluginMetadata
  ): Promise<void> {
    const logContext = logger.withContext('installSkill')
    let folderCopied = false
    const tempPath = `${destPath}.tmp`

    try {
      try {
        await fs.promises.access(destPath)
        await deleteDirectoryRecursive(destPath)
        logContext.info('Removed existing skill folder', { destPath })
      } catch {
        // No existing folder
      }

      await copyDirectoryRecursive(sourceAbsolutePath, tempPath)
      folderCopied = true
      logContext.info('Skill folder copied to temp location', { tempPath })

      const updatedPlugins = this.buildUpdatedPlugins(agent, (existing) => [
        ...existing.filter((p) => !(p.filename === metadata.filename && p.type === 'skill')),
        this.createPluginRecord(metadata)
      ])

      await this.persistInstalledPlugins(agent, updatedPlugins)
      await fs.promises.rename(tempPath, destPath)
      logContext.info('Skill folder moved to final location', { destPath })
    } catch (error) {
      if (folderCopied) {
        await this.safeRemoveDirectory(tempPath, 'temp folder')
      }
      throw this.toPluginError('install-skill', error)
    }
  }

  async uninstallSkill(agent: AgentEntity, folderName: string, skillPath: string): Promise<void> {
    const logContext = logger.withContext('uninstallSkill')
    const originalPlugins = agent.configuration?.installed_plugins || []
    const updatedPlugins = originalPlugins.filter((p) => !(p.filename === folderName && p.type === 'skill'))

    let dbUpdated = false

    try {
      await this.persistInstalledPlugins(agent, updatedPlugins)
      dbUpdated = true
      logContext.info('Agent configuration updated', { agentId: agent.id })

      try {
        await deleteDirectoryRecursive(skillPath)
        logContext.info('Skill folder deleted', { skillPath })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code !== 'ENOENT') {
          throw error
        }
        logContext.warn('Skill folder already deleted', { skillPath })
      }
    } catch (error) {
      if (dbUpdated) {
        await this.rollbackInstalledPlugins(agent, originalPlugins)
      }
      throw this.toPluginError('uninstall-skill', error)
    }
  }

  private buildUpdatedPlugins(
    agent: AgentEntity,
    mutate: (plugins: AgentInstalledPluginRecord[]) => AgentInstalledPluginRecord[]
  ): AgentInstalledPluginRecord[] {
    const existing = [...(agent.configuration?.installed_plugins || [])]
    const next = mutate(existing)
    return next
  }

  private createPluginRecord(metadata: PluginMetadata): AgentInstalledPluginRecord {
    return {
      sourcePath: metadata.sourcePath,
      filename: metadata.filename,
      type: metadata.type as PluginType,
      name: metadata.name,
      description: metadata.description,
      allowed_tools: metadata.allowed_tools,
      tools: metadata.tools,
      category: metadata.category,
      tags: metadata.tags,
      version: metadata.version,
      author: metadata.author,
      contentHash: metadata.contentHash,
      installedAt: Date.now()
    }
  }

  private async persistInstalledPlugins(
    agent: AgentEntity,
    installedPlugins: AgentInstalledPluginRecord[]
  ): Promise<void> {
    const configuration: AgentConfiguration = {
      permission_mode: 'default',
      max_turns: 100,
      ...agent.configuration,
      installed_plugins: installedPlugins
    }

    await this.updateAgent(agent.id, { configuration })
    agent.configuration = configuration
  }

  private async rollbackInstalledPlugins(
    agent: AgentEntity,
    originalPlugins: AgentInstalledPluginRecord[]
  ): Promise<void> {
    try {
      await this.persistInstalledPlugins(agent, originalPlugins)
      logger.debug('Rolled back agent configuration', { agentId: agent.id })
    } catch (rollbackError) {
      logger.error('Failed to rollback agent configuration', {
        agentId: agent.id,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      })
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
