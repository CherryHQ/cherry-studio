import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

import { loggerService } from '@logger'
import { getResourcePath } from '@main/utils'
import { parsePluginMetadata } from '@main/utils/markdownParser'
import type {
  InstalledPlugin,
  InstallPluginOptions,
  ListAvailablePluginsResult,
  PluginError,
  PluginMetadata,
  UninstallPluginOptions
} from '@renderer/types/plugin'
import type { AgentEntity } from '@types'

import { AgentService } from './agents/services/AgentService'

const logger = loggerService.withContext('PluginService')

interface PluginServiceConfig {
  maxFileSize: number // bytes
  cacheTimeout: number // milliseconds
}

/**
 * PluginService manages agent and command plugins from resources directory.
 *
 * Features:
 * - Singleton pattern for consistent state management
 * - Caching of available plugins for performance
 * - Security validation (path traversal, file size, extensions)
 * - Transactional install/uninstall operations
 * - Integration with AgentService for metadata persistence
 */
export class PluginService {
  private static instance: PluginService | null = null

  private availablePluginsCache: ListAvailablePluginsResult | null = null
  private cacheTimestamp = 0
  private config: PluginServiceConfig

  private readonly ALLOWED_EXTENSIONS = ['.md', '.markdown']

  private constructor(config?: Partial<PluginServiceConfig>) {
    this.config = {
      maxFileSize: config?.maxFileSize ?? 1024 * 1024, // 1MB default
      cacheTimeout: config?.cacheTimeout ?? 5 * 60 * 1000 // 5 minutes default
    }

    logger.info('PluginService initialized', {
      maxFileSize: this.config.maxFileSize,
      cacheTimeout: this.config.cacheTimeout
    })
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: Partial<PluginServiceConfig>): PluginService {
    if (!PluginService.instance) {
      PluginService.instance = new PluginService(config)
    }
    return PluginService.instance
  }

  /**
   * List all available plugins from resources directory (with caching)
   */
  async listAvailable(): Promise<ListAvailablePluginsResult> {
    const now = Date.now()

    // Return cached data if still valid
    if (this.availablePluginsCache && now - this.cacheTimestamp < this.config.cacheTimeout) {
      logger.debug('Returning cached plugin list', {
        cacheAge: now - this.cacheTimestamp
      })
      return this.availablePluginsCache
    }

    logger.info('Scanning available plugins')

    const agents = await this.scanPluginDirectory('agent')
    const commands = await this.scanPluginDirectory('command')

    const result: ListAvailablePluginsResult = {
      agents,
      commands,
      total: agents.length + commands.length
    }

    // Update cache
    this.availablePluginsCache = result
    this.cacheTimestamp = now

    logger.info('Available plugins scanned', {
      agentsCount: agents.length,
      commandsCount: commands.length,
      total: result.total
    })

    return result
  }

  /**
   * Install plugin with validation and transactional safety
   */
  async install(options: InstallPluginOptions): Promise<PluginMetadata> {
    logger.info('Installing plugin', options)

    // Validate source path
    this.validateSourcePath(options.sourcePath)

    // Get agent and validate
    const agent = await AgentService.getInstance().getAgent(options.agentId)
    if (!agent) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId: options.agentId,
        workdir: '',
        message: 'Agent not found'
      } as PluginError
    }

    const workdir = agent.accessible_paths?.[0]
    if (!workdir) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId: options.agentId,
        workdir: '',
        message: 'Agent has no accessible paths'
      } as PluginError
    }

    await this.validateWorkdir(workdir, options.agentId)

    // Get absolute source path
    const basePath = this.getPluginsBasePath()
    const sourceAbsolutePath = path.join(basePath, options.sourcePath)

    // Validate plugin file
    await this.validatePluginFile(sourceAbsolutePath)

    // Parse metadata
    const category = path.basename(path.dirname(options.sourcePath))
    const metadata = await parsePluginMetadata(sourceAbsolutePath, options.sourcePath, category, options.type)

    // Sanitize filename
    const sanitizedFilename = this.sanitizeFilename(metadata.filename)

    // Ensure .claude directory exists
    await this.ensureClaudeDirectory(workdir, options.type)

    // Get destination path
    const destDir = path.join(workdir, '.claude', options.type === 'agent' ? 'agents' : 'commands')
    const destPath = path.join(destDir, sanitizedFilename)

    // Check for duplicate and auto-uninstall if exists
    const existingPlugins = agent.configuration?.installed_plugins || []
    const existingPlugin = existingPlugins.find((p) => p.filename === sanitizedFilename && p.type === options.type)

    if (existingPlugin) {
      logger.info('Plugin already installed, auto-uninstalling old version', {
        filename: sanitizedFilename
      })
      await this.uninstallTransaction(agent, sanitizedFilename, options.type)

      // Re-fetch agent after uninstall
      const updatedAgent = await AgentService.getInstance().getAgent(options.agentId)
      if (!updatedAgent) {
        throw {
          type: 'TRANSACTION_FAILED',
          operation: 'install',
          reason: 'Agent not found after uninstall'
        } as PluginError
      }

      await this.installTransaction(updatedAgent, sourceAbsolutePath, destPath, metadata)
    } else {
      await this.installTransaction(agent, sourceAbsolutePath, destPath, metadata)
    }

    logger.info('Plugin installed successfully', {
      agentId: options.agentId,
      filename: sanitizedFilename,
      type: options.type
    })

    return {
      ...metadata,
      filename: sanitizedFilename,
      installedAt: Date.now()
    }
  }

  /**
   * Uninstall plugin with cleanup
   */
  async uninstall(options: UninstallPluginOptions): Promise<void> {
    logger.info('Uninstalling plugin', options)

    // Get agent
    const agent = await AgentService.getInstance().getAgent(options.agentId)
    if (!agent) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId: options.agentId,
        workdir: '',
        message: 'Agent not found'
      } as PluginError
    }

    // Sanitize filename
    const sanitizedFilename = this.sanitizeFilename(options.filename)

    // Execute transactional uninstall
    await this.uninstallTransaction(agent, sanitizedFilename, options.type)

    logger.info('Plugin uninstalled successfully', {
      agentId: options.agentId,
      filename: sanitizedFilename,
      type: options.type
    })
  }

  /**
   * List installed plugins for an agent (from database + filesystem validation)
   */
  async listInstalled(agentId: string): Promise<InstalledPlugin[]> {
    logger.debug('Listing installed plugins', { agentId })

    // Get agent
    const agent = await AgentService.getInstance().getAgent(agentId)
    if (!agent) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId,
        workdir: '',
        message: 'Agent not found'
      } as PluginError
    }

    const installedPlugins = agent.configuration?.installed_plugins || []
    const workdir = agent.accessible_paths?.[0]

    if (!workdir) {
      logger.warn('Agent has no accessible paths', { agentId })
      return []
    }

    // Validate each plugin still exists on filesystem
    const validatedPlugins: InstalledPlugin[] = []

    for (const plugin of installedPlugins) {
      const pluginPath = path.join(workdir, '.claude', plugin.type === 'agent' ? 'agents' : 'commands', plugin.filename)

      try {
        const stats = await fs.promises.stat(pluginPath)

        // Verify file hash if stored
        if (plugin.contentHash) {
          const currentHash = await this.calculateFileHash(pluginPath)
          if (currentHash !== plugin.contentHash) {
            logger.warn('Plugin file hash mismatch', {
              filename: plugin.filename,
              expected: plugin.contentHash,
              actual: currentHash
            })
          }
        }

        validatedPlugins.push({
          filename: plugin.filename,
          type: plugin.type,
          metadata: {
            sourcePath: plugin.sourcePath,
            filename: plugin.filename,
            name: plugin.name,
            description: plugin.description,
            allowed_tools: plugin.allowed_tools,
            tools: plugin.tools,
            category: plugin.category || '',
            type: plugin.type,
            tags: plugin.tags,
            version: plugin.version,
            author: plugin.author,
            size: stats.size,
            contentHash: plugin.contentHash,
            installedAt: plugin.installedAt,
            updatedAt: plugin.updatedAt
          }
        })
      } catch (error) {
        logger.warn('Plugin file not found on filesystem', {
          filename: plugin.filename,
          path: pluginPath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    logger.debug('Listed installed plugins', {
      agentId,
      count: validatedPlugins.length
    })

    return validatedPlugins
  }

  /**
   * Invalidate plugin cache (for development/testing)
   */
  invalidateCache(): void {
    this.availablePluginsCache = null
    this.cacheTimestamp = 0
    logger.info('Plugin cache invalidated')
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Get absolute path to plugins directory (handles packaged vs dev)
   */
  private getPluginsBasePath(): string {
    // Use the utility function which handles both dev and production correctly
    return path.join(getResourcePath(), 'data', 'claude-code-plugins')
  }

  /**
   * Scan plugin directory and return metadata for all plugins
   */
  private async scanPluginDirectory(type: 'agent' | 'command'): Promise<PluginMetadata[]> {
    const basePath = this.getPluginsBasePath()
    const typeDir = path.join(basePath, type === 'agent' ? 'agents' : 'commands')

    try {
      await fs.promises.access(typeDir, fs.constants.R_OK)
    } catch (error) {
      logger.warn(`Plugin directory not accessible: ${typeDir}`, {
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }

    const plugins: PluginMetadata[] = []
    const categories = await fs.promises.readdir(typeDir, { withFileTypes: true })

    for (const categoryEntry of categories) {
      if (!categoryEntry.isDirectory()) {
        continue
      }

      const category = categoryEntry.name
      const categoryPath = path.join(typeDir, category)
      const files = await fs.promises.readdir(categoryPath, { withFileTypes: true })

      for (const file of files) {
        if (!file.isFile()) {
          continue
        }

        const ext = path.extname(file.name).toLowerCase()
        if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
          continue
        }

        try {
          const filePath = path.join(categoryPath, file.name)
          const sourcePath = path.join(type === 'agent' ? 'agents' : 'commands', category, file.name)

          const metadata = await parsePluginMetadata(filePath, sourcePath, category, type)
          plugins.push(metadata)
        } catch (error) {
          logger.warn(`Failed to parse plugin: ${file.name}`, {
            category,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    return plugins
  }

  /**
   * Validate source path to prevent path traversal attacks
   */
  private validateSourcePath(sourcePath: string): void {
    // Remove any path traversal attempts
    const normalized = path.normalize(sourcePath)

    // Ensure no parent directory access
    if (normalized.includes('..')) {
      throw {
        type: 'PATH_TRAVERSAL',
        message: 'Path traversal detected',
        path: sourcePath
      } as PluginError
    }

    // Ensure path is within plugins directory
    const basePath = this.getPluginsBasePath()
    const absolutePath = path.join(basePath, normalized)
    const resolvedPath = path.resolve(absolutePath)

    if (!resolvedPath.startsWith(path.resolve(basePath))) {
      throw {
        type: 'PATH_TRAVERSAL',
        message: 'Path outside plugins directory',
        path: sourcePath
      } as PluginError
    }
  }

  /**
   * Validate workdir against agent's accessible paths
   */
  private async validateWorkdir(workdir: string, agentId: string): Promise<void> {
    // Get agent from database
    const agent = await AgentService.getInstance().getAgent(agentId)

    if (!agent) {
      throw {
        type: 'INVALID_WORKDIR',
        workdir,
        agentId,
        message: 'Agent not found'
      } as PluginError
    }

    // Verify workdir is in agent's accessible_paths
    if (!agent.accessible_paths?.includes(workdir)) {
      throw {
        type: 'INVALID_WORKDIR',
        workdir,
        agentId,
        message: 'Workdir not in agent accessible paths'
      } as PluginError
    }

    // Verify workdir exists and is accessible
    try {
      await fs.promises.access(workdir, fs.constants.R_OK | fs.constants.W_OK)
    } catch (error) {
      throw {
        type: 'WORKDIR_NOT_FOUND',
        workdir,
        message: 'Workdir does not exist or is not accessible'
      } as PluginError
    }
  }

  /**
   * Sanitize filename to remove unsafe characters
   */
  private sanitizeFilename(filename: string): string {
    // Remove path separators
    let sanitized = filename.replace(/[/\\]/g, '_')
    // Remove null bytes
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/\0/g, '')
    // Limit to safe characters (alphanumeric, dash, underscore, dot)
    sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_')

    // Ensure .md extension
    if (!sanitized.endsWith('.md') && !sanitized.endsWith('.markdown')) {
      sanitized += '.md'
    }

    return sanitized
  }

  /**
   * Validate plugin file (size, extension, frontmatter)
   */
  private async validatePluginFile(filePath: string): Promise<void> {
    // Check file exists
    let stats: fs.Stats
    try {
      stats = await fs.promises.stat(filePath)
    } catch (error) {
      throw {
        type: 'FILE_NOT_FOUND',
        path: filePath
      } as PluginError
    }

    // Check file size
    if (stats.size > this.config.maxFileSize) {
      throw {
        type: 'FILE_TOO_LARGE',
        size: stats.size,
        max: this.config.maxFileSize
      } as PluginError
    }

    // Check file extension
    const ext = path.extname(filePath).toLowerCase()
    if (!this.ALLOWED_EXTENSIONS.includes(ext)) {
      throw {
        type: 'INVALID_FILE_TYPE',
        extension: ext
      } as PluginError
    }

    // Validate frontmatter can be parsed safely
    // This is handled by parsePluginMetadata which uses FAILSAFE_SCHEMA
    try {
      const category = path.basename(path.dirname(filePath))
      const sourcePath = path.relative(this.getPluginsBasePath(), filePath)
      const type = sourcePath.startsWith('agents') ? 'agent' : 'command'

      await parsePluginMetadata(filePath, sourcePath, category, type)
    } catch (error) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Failed to parse frontmatter',
        path: filePath
      } as PluginError
    }
  }

  /**
   * Calculate SHA-256 hash of file
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    const content = await fs.promises.readFile(filePath, 'utf8')
    return crypto.createHash('sha256').update(content).digest('hex')
  }

  /**
   * Ensure .claude/agents or .claude/commands directory exists
   */
  private async ensureClaudeDirectory(workdir: string, type: 'agent' | 'command'): Promise<void> {
    const claudeDir = path.join(workdir, '.claude')
    const typeDir = path.join(claudeDir, type === 'agent' ? 'agents' : 'commands')

    try {
      await fs.promises.mkdir(typeDir, { recursive: true })
      logger.debug('Ensured directory exists', { typeDir })
    } catch (error) {
      logger.error('Failed to create directory', {
        typeDir,
        error: error instanceof Error ? error.message : String(error)
      })
      throw {
        type: 'PERMISSION_DENIED',
        path: typeDir
      } as PluginError
    }
  }

  /**
   * Transactional install operation
   * Steps:
   * 1. Copy to temp location
   * 2. Update database
   * 3. Move to final location (atomic)
   * Rollback on error
   */
  private async installTransaction(
    agent: AgentEntity,
    sourceAbsolutePath: string,
    destPath: string,
    metadata: PluginMetadata
  ): Promise<void> {
    const tempPath = `${destPath}.tmp`
    let fileCopied = false

    try {
      // Step 1: Copy file to temporary location
      await fs.promises.copyFile(sourceAbsolutePath, tempPath)
      fileCopied = true
      logger.debug('File copied to temp location', { tempPath })

      // Step 2: Update agent configuration in database
      const existingPlugins = agent.configuration?.installed_plugins || []
      const updatedPlugins = [
        ...existingPlugins,
        {
          sourcePath: metadata.sourcePath,
          filename: metadata.filename,
          type: metadata.type,
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
      ]

      await AgentService.getInstance().updateAgent(agent.id, {
        configuration: {
          ...agent.configuration,
          installed_plugins: updatedPlugins
        }
      })

      logger.debug('Agent configuration updated', { agentId: agent.id })

      // Step 3: Move temp file to final location (atomic on same filesystem)
      await fs.promises.rename(tempPath, destPath)
      logger.debug('File moved to final location', { destPath })
    } catch (error) {
      // Rollback: delete temp file if it exists
      if (fileCopied) {
        try {
          await fs.promises.unlink(tempPath)
          logger.debug('Rolled back temp file', { tempPath })
        } catch (unlinkError) {
          logger.error('Failed to rollback temp file', {
            tempPath,
            error: unlinkError instanceof Error ? unlinkError.message : String(unlinkError)
          })
        }
      }

      throw {
        type: 'TRANSACTION_FAILED',
        operation: 'install',
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }
  }

  /**
   * Transactional uninstall operation
   * Steps:
   * 1. Update database
   * 2. Delete file
   * Rollback database on error
   */
  private async uninstallTransaction(agent: AgentEntity, filename: string, type: 'agent' | 'command'): Promise<void> {
    const workdir = agent.accessible_paths?.[0]
    if (!workdir) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId: agent.id,
        workdir: '',
        message: 'Agent has no accessible paths'
      } as PluginError
    }

    const filePath = path.join(workdir, '.claude', type === 'agent' ? 'agents' : 'commands', filename)

    // Step 1: Update database first (easier to rollback file operations)
    const originalPlugins = agent.configuration?.installed_plugins || []
    const updatedPlugins = originalPlugins.filter((p) => !(p.filename === filename && p.type === type))

    let dbUpdated = false

    try {
      await AgentService.getInstance().updateAgent(agent.id, {
        configuration: {
          ...agent.configuration,
          installed_plugins: updatedPlugins
        }
      })
      dbUpdated = true
      logger.debug('Agent configuration updated', { agentId: agent.id })

      // Step 2: Delete file
      try {
        await fs.promises.unlink(filePath)
        logger.debug('Plugin file deleted', { filePath })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code !== 'ENOENT') {
          throw error // File should exist, re-throw if not ENOENT
        }
        logger.warn('Plugin file already deleted', { filePath })
      }
    } catch (error) {
      // Rollback: restore database if file deletion failed
      if (dbUpdated) {
        try {
          await AgentService.getInstance().updateAgent(agent.id, {
            configuration: {
              ...agent.configuration,
              installed_plugins: originalPlugins
            }
          })
          logger.debug('Rolled back database update', { agentId: agent.id })
        } catch (rollbackError) {
          logger.error('Failed to rollback database', {
            agentId: agent.id,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          })
        }
      }

      throw {
        type: 'TRANSACTION_FAILED',
        operation: 'uninstall',
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }
  }
}

export const pluginService = PluginService.getInstance()
