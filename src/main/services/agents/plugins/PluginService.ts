import { loggerService } from '@logger'
import { parsePluginMetadata, parseSkillMetadata } from '@main/utils/markdownParser'
import type {
  AgentEntity,
  InstalledPlugin,
  InstallPluginOptions,
  ListAvailablePluginsResult,
  PluginError,
  PluginMetadata,
  PluginType,
  UninstallPluginOptions
} from '@types'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { AgentService } from '../services/AgentService'
import { PluginCacheStore } from './PluginCacheStore'
import { PluginInstaller } from './PluginInstaller'

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
  private readonly cacheStore: PluginCacheStore
  private readonly installer: PluginInstaller
  private readonly agentService: AgentService

  private readonly ALLOWED_EXTENSIONS = ['.md', '.markdown']

  private constructor(config?: Partial<PluginServiceConfig>) {
    this.config = {
      maxFileSize: config?.maxFileSize ?? 1024 * 1024, // 1MB default
      cacheTimeout: config?.cacheTimeout ?? 5 * 60 * 1000 // 5 minutes default
    }
    this.agentService = AgentService.getInstance()
    this.cacheStore = new PluginCacheStore({
      allowedExtensions: this.ALLOWED_EXTENSIONS,
      getPluginDirectoryName: this.getPluginDirectoryName.bind(this),
      getClaudeBasePath: this.getClaudeBasePath.bind(this),
      getClaudePluginDirectory: this.getClaudePluginDirectory.bind(this),
      getPluginsBasePath: this.getPluginsBasePath.bind(this)
    })
    this.installer = new PluginInstaller(this.agentService.updateAgent.bind(this.agentService))

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

    // Scan all plugin types
    const [agents, commands, skills] = await Promise.all([
      this.cacheStore.listAvailableFilePlugins('agent'),
      this.cacheStore.listAvailableFilePlugins('command'),
      this.cacheStore.listAvailableSkills()
    ])

    const result: ListAvailablePluginsResult = {
      agents,
      commands,
      skills, // NEW: include skills
      total: agents.length + commands.length + skills.length
    }

    // Update cache
    this.availablePluginsCache = result
    this.cacheTimestamp = now

    logger.info('Available plugins scanned', {
      agentsCount: agents.length,
      commandsCount: commands.length,
      skillsCount: skills.length,
      total: result.total
    })

    return result
  }

  /**
   * Install plugin with validation and transactional safety
   */
  async install(options: InstallPluginOptions): Promise<PluginMetadata> {
    logger.info('Installing plugin', options)

    const context = await this.prepareInstallContext(options)

    if (options.type === 'skill') {
      return await this.installSkillPlugin(options, context)
    }

    return await this.installFilePlugin(options, context)
  }

  private async prepareInstallContext(options: InstallPluginOptions): Promise<{
    agent: AgentEntity
    workdir: string
    sourceAbsolutePath: string
  }> {
    const agent = await this.getAgentOrThrow(options.agentId)
    const workdir = this.getWorkdirOrThrow(agent, options.agentId)

    await this.validateWorkdir(agent, workdir)

    const sourceAbsolutePath = this.cacheStore.resolveSourcePath(options.sourcePath)

    return { agent, workdir, sourceAbsolutePath }
  }

  private async installSkillPlugin(
    options: InstallPluginOptions,
    context: {
      agent: AgentEntity
      workdir: string
      sourceAbsolutePath: string
    }
  ): Promise<PluginMetadata> {
    const { agent, workdir, sourceAbsolutePath } = context

    await this.cacheStore.ensureSkillSourceDirectory(sourceAbsolutePath, options.sourcePath)

    const metadata = await parseSkillMetadata(sourceAbsolutePath, options.sourcePath, 'skills')
    const sanitizedFolderName = this.sanitizeFolderName(metadata.filename)

    await this.ensureClaudeDirectory(workdir, 'skill')
    const destPath = this.getClaudePluginPath(workdir, 'skill', sanitizedFolderName)

    metadata.filename = sanitizedFolderName

    await this.installer.installSkill(agent, sourceAbsolutePath, destPath, metadata)

    const installedAt = Date.now()
    await this.cacheStore.upsert(workdir, {
      filename: sanitizedFolderName,
      type: 'skill',
      metadata: {
        ...metadata,
        filename: sanitizedFolderName,
        installedAt
      }
    })

    logger.info('Skill installed successfully', {
      agentId: options.agentId,
      sourcePath: options.sourcePath,
      folderName: sanitizedFolderName
    })

    return {
      ...metadata,
      filename: sanitizedFolderName,
      installedAt
    }
  }

  private async installFilePlugin(
    options: InstallPluginOptions,
    context: {
      agent: AgentEntity
      workdir: string
      sourceAbsolutePath: string
    }
  ): Promise<PluginMetadata> {
    const { agent, workdir, sourceAbsolutePath } = context

    if (options.type === 'skill') {
      throw {
        type: 'INVALID_FILE_TYPE',
        extension: options.type
      } as PluginError
    }

    const filePluginType: 'agent' | 'command' = options.type

    await this.cacheStore.validatePluginFile(sourceAbsolutePath, this.config.maxFileSize)

    const category = path.basename(path.dirname(options.sourcePath))
    const metadata = await parsePluginMetadata(sourceAbsolutePath, options.sourcePath, category, filePluginType)

    const sanitizedFilename = this.sanitizeFilename(metadata.filename)
    metadata.filename = sanitizedFilename

    await this.ensureClaudeDirectory(workdir, filePluginType)
    const destPath = this.getClaudePluginPath(workdir, filePluginType, sanitizedFilename)

    await this.installer.installFilePlugin(agent, sourceAbsolutePath, destPath, metadata)

    const installedAt = Date.now()
    await this.cacheStore.upsert(workdir, {
      filename: sanitizedFilename,
      type: filePluginType,
      metadata: {
        ...metadata,
        filename: sanitizedFilename,
        installedAt
      }
    })

    logger.info('Plugin installed successfully', {
      agentId: options.agentId,
      filename: sanitizedFilename,
      type: filePluginType
    })

    return {
      ...metadata,
      installedAt
    }
  }

  /**
   * Uninstall plugin with cleanup
   */
  async uninstall(options: UninstallPluginOptions): Promise<void> {
    logger.info('Uninstalling plugin', options)

    const agent = await this.getAgentOrThrow(options.agentId)
    const workdir = this.getWorkdirOrThrow(agent, options.agentId)

    await this.validateWorkdir(agent, workdir)

    if (options.type === 'skill') {
      const sanitizedFolderName = this.sanitizeFolderName(options.filename)
      const skillPath = this.getClaudePluginPath(workdir, 'skill', sanitizedFolderName)

      await this.installer.uninstallSkill(agent, sanitizedFolderName, skillPath)
      await this.cacheStore.remove(workdir, sanitizedFolderName, 'skill')

      logger.info('Skill uninstalled successfully', {
        agentId: options.agentId,
        folderName: sanitizedFolderName
      })

      return
    }

    const sanitizedFilename = this.sanitizeFilename(options.filename)
    const filePath = this.getClaudePluginPath(workdir, options.type, sanitizedFilename)

    await this.installer.uninstallFilePlugin(agent, sanitizedFilename, options.type, filePath)
    await this.cacheStore.remove(workdir, sanitizedFilename, options.type)

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

    const agent = await this.getAgentOrThrow(agentId)

    const workdir = agent.accessible_paths?.[0]

    if (!workdir) {
      logger.warn('Agent has no accessible paths', { agentId })
      return []
    }

    const plugins = await this.listInstalledFromCache(workdir)

    logger.debug('Listed installed plugins from cache', {
      agentId,
      count: plugins.length
    })

    return plugins
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
  // Cache File Management (for installed plugins)
  // ============================================================================

  /**
   * Read cache file from .claude/plugins.json
   * Returns null if cache doesn't exist or is invalid
   */

  /**
   * List installed plugins from cache file
   * Falls back to filesystem scan if cache is missing or corrupt
   */
  async listInstalledFromCache(workdir: string): Promise<InstalledPlugin[]> {
    logger.debug('Listing installed plugins from cache', { workdir })
    return await this.cacheStore.listInstalled(workdir)
  }

  /**
   * Read plugin content from source (resources directory)
   */
  async readContent(sourcePath: string): Promise<string> {
    logger.info('Reading plugin content', { sourcePath })
    const content = await this.cacheStore.readSourceContent(sourcePath)
    logger.debug('Plugin content read successfully', {
      sourcePath,
      size: content.length
    })
    return content
  }

  /**
   * Write plugin content to installed plugin (in agent's .claude directory)
   * Note: Only works for file-based plugins (agents/commands), not skills
   */
  async writeContent(agentId: string, filename: string, type: PluginType, content: string): Promise<void> {
    logger.info('Writing plugin content', { agentId, filename, type })

    const agent = await this.getAgentOrThrow(agentId)
    const workdir = this.getWorkdirOrThrow(agent, agentId)

    await this.validateWorkdir(agent, workdir)

    // Check if plugin is installed
    const installedPlugins = agent.configuration?.installed_plugins || []
    const installedPlugin = installedPlugins.find((p) => p.filename === filename && p.type === type)

    if (!installedPlugin) {
      throw {
        type: 'PLUGIN_NOT_INSTALLED',
        filename,
        agentId
      } as PluginError
    }

    if (type === 'skill') {
      throw {
        type: 'INVALID_FILE_TYPE',
        extension: type
      } as PluginError
    }

    const filePluginType = type as 'agent' | 'command'
    const filePath = this.getClaudePluginPath(workdir, filePluginType, filename)
    const newContentHash = await this.installer.updateFilePluginContent(
      agent,
      filePluginType,
      filename,
      filePath,
      content
    )

    logger.info('Plugin content updated successfully', {
      agentId,
      filename,
      type: filePluginType,
      newContentHash
    })
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Resolve plugin type to directory name under .claude
   */
  private getPluginDirectoryName(type: PluginType): 'agents' | 'commands' | 'skills' {
    if (type === 'agent') {
      return 'agents'
    }
    if (type === 'command') {
      return 'commands'
    }
    return 'skills'
  }

  /**
   * Get the base .claude directory for a workdir
   */
  private getClaudeBasePath(workdir: string): string {
    return path.join(workdir, '.claude')
  }

  /**
   * Get the directory for a specific plugin type inside .claude
   */
  private getClaudePluginDirectory(workdir: string, type: PluginType): string {
    return path.join(this.getClaudeBasePath(workdir), this.getPluginDirectoryName(type))
  }

  /**
   * Get the absolute path for a plugin file/folder inside .claude
   */
  private getClaudePluginPath(workdir: string, type: PluginType, filename: string): string {
    return path.join(this.getClaudePluginDirectory(workdir, type), filename)
  }

  /**
   * Get absolute path to plugins directory (handles packaged vs dev)
   */
  private getPluginsBasePath(): string {
    // Use the utility function which handles both dev and production correctly
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'claude-code-plugins')
    }
    return path.join(__dirname, '../../node_modules/claude-code-plugins/plugins')
  }

  /**
   * Validate source path to prevent path traversal attacks
   */
  private async getAgentOrThrow(agentId: string): Promise<AgentEntity> {
    const agent = await this.agentService.getAgent(agentId)
    if (!agent) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId,
        workdir: '',
        message: 'Agent not found'
      } as PluginError
    }
    return agent
  }

  private getWorkdirOrThrow(agent: AgentEntity, agentId: string): string {
    const workdir = agent.accessible_paths?.[0]
    if (!workdir) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId,
        workdir: '',
        message: 'Agent has no accessible paths'
      } as PluginError
    }
    return workdir
  }

  /**
   * Validate workdir against agent's accessible paths
   */
  private async validateWorkdir(agent: AgentEntity, workdir: string): Promise<void> {
    // Verify workdir is in agent's accessible_paths
    if (!agent.accessible_paths?.includes(workdir)) {
      throw {
        type: 'INVALID_WORKDIR',
        workdir,
        agentId: agent.id,
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
   * Sanitize filename to remove unsafe characters (for agents/commands)
   */
  private sanitizeFilename(filename: string): string {
    // Remove path separators
    let sanitized = filename.replace(/[/\\]/g, '_')
    // Remove null bytes using String method to avoid control-regex lint error
    sanitized = sanitized.replace(new RegExp(String.fromCharCode(0), 'g'), '')
    // Limit to safe characters (alphanumeric, dash, underscore, dot)
    sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_')

    // Ensure .md extension
    if (!sanitized.endsWith('.md') && !sanitized.endsWith('.markdown')) {
      sanitized += '.md'
    }

    return sanitized
  }

  /**
   * Sanitize folder name for skills (different rules than file names)
   * NO dots allowed to avoid confusion with file extensions
   */
  private sanitizeFolderName(folderName: string): string {
    // Remove path separators
    let sanitized = folderName.replace(/[/\\]/g, '_')
    // Remove null bytes using String method to avoid control-regex lint error
    sanitized = sanitized.replace(new RegExp(String.fromCharCode(0), 'g'), '')
    // Limit to safe characters (alphanumeric, dash, underscore)
    // NOTE: No dots allowed to avoid confusion with file extensions
    sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '_')

    // Validate no extension was provided
    if (folderName.includes('.')) {
      logger.warn('Skill folder name contained dots, sanitized', {
        original: folderName,
        sanitized
      })
    }

    return sanitized
  }

  /**
   * Ensure .claude subdirectory exists for the given plugin type
   */
  private async ensureClaudeDirectory(workdir: string, type: PluginType): Promise<void> {
    const typeDir = this.getClaudePluginDirectory(workdir, type)

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
}

export const pluginService = PluginService.getInstance()
