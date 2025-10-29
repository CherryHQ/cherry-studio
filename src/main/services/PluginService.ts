import { loggerService } from '@logger'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { findAllSkillDirectories, parsePluginMetadata, parseSkillMetadata } from '@main/utils/markdownParser'
import type {
  AgentEntity,
  CachedPluginsData,
  InstalledPlugin,
  InstallPluginOptions,
  ListAvailablePluginsResult,
  PluginError,
  PluginMetadata,
  PluginType,
  UninstallPluginOptions
} from '@types'
import { CachedPluginsDataSchema } from '@types'
import * as crypto from 'crypto'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

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

    // Scan all plugin types
    const [agents, commands, skills] = await Promise.all([
      this.scanPluginDirectory('agent'),
      this.scanPluginDirectory('command'),
      this.scanSkillDirectory()
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

    // BRANCH: Handle skills differently than files
    if (options.type === 'skill') {
      // Validate skill folder exists and is a directory
      try {
        const stats = await fs.promises.stat(sourceAbsolutePath)
        if (!stats.isDirectory()) {
          throw {
            type: 'INVALID_METADATA',
            reason: 'Skill source is not a directory',
            path: options.sourcePath
          } as PluginError
        }
      } catch (error) {
        throw {
          type: 'FILE_NOT_FOUND',
          path: sourceAbsolutePath
        } as PluginError
      }

      // Parse metadata from SKILL.md
      const metadata = await parseSkillMetadata(sourceAbsolutePath, options.sourcePath, 'skills')

      // Sanitize folder name (different rules than file names)
      const sanitizedFolderName = this.sanitizeFolderName(metadata.filename)

      // Ensure .claude/skills directory exists
      await this.ensureClaudeDirectory(workdir, 'skill')

      // Construct destination path (folder, not file)
      const destPath = path.join(workdir, '.claude', 'skills', sanitizedFolderName)

      // Update metadata with sanitized folder name
      metadata.filename = sanitizedFolderName

      // Execute skill-specific install
      await this.installSkill(agent, sourceAbsolutePath, destPath, metadata)

      logger.info('Skill installed successfully', {
        agentId: options.agentId,
        sourcePath: options.sourcePath,
        folderName: sanitizedFolderName
      })

      return {
        ...metadata,
        installedAt: Date.now()
      }
    }

    // EXISTING LOGIC for agents/commands (unchanged)
    // Files go through existing validation and sanitization
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

    // BRANCH: Handle skills differently than files
    if (options.type === 'skill') {
      // For skills, filename is the folder name (no extension)
      // Use sanitizeFolderName to ensure consistency
      const sanitizedFolderName = this.sanitizeFolderName(options.filename)
      await this.uninstallSkill(agent, sanitizedFolderName)

      logger.info('Skill uninstalled successfully', {
        agentId: options.agentId,
        folderName: sanitizedFolderName
      })

      return
    }

    // EXISTING LOGIC for agents/commands (unchanged)
    // For files, filename includes .md extension
    const sanitizedFilename = this.sanitizeFilename(options.filename)
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

    // Get agent (includes installed_plugins loaded from cache)
    const agent = await AgentService.getInstance().getAgent(agentId)
    if (!agent) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId,
        workdir: '',
        message: 'Agent not found'
      } as PluginError
    }

    const installedPlugins = agent.installed_plugins || []
    const workdir = agent.accessible_paths?.[0]

    if (!workdir) {
      logger.warn('Agent has no accessible paths', { agentId })
      return []
    }

    // Validate each plugin still exists on filesystem
    const validatedPlugins: InstalledPlugin[] = []

    for (const plugin of installedPlugins) {
      // Get plugin path based on type
      let pluginPath: string
      if (plugin.type === 'skill') {
        pluginPath = path.join(workdir, '.claude', 'skills', plugin.filename)
      } else {
        pluginPath = path.join(workdir, '.claude', plugin.type === 'agent' ? 'agents' : 'commands', plugin.filename)
      }

      try {
        // Verify plugin file/folder exists
        await fs.promises.stat(pluginPath)

        // For files (agents/commands), verify file hash if stored
        if (plugin.type !== 'skill' && plugin.metadata.contentHash) {
          const currentHash = await this.calculateFileHash(pluginPath)
          if (currentHash !== plugin.metadata.contentHash) {
            logger.warn('Plugin file hash mismatch', {
              filename: plugin.filename,
              expected: plugin.metadata.contentHash,
              actual: currentHash
            })
          }
        }

        // Plugin already has correct structure, just return it
        validatedPlugins.push(plugin)
      } catch (error) {
        logger.warn('Plugin not found on filesystem', {
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
  // Cache File Management (for installed plugins)
  // ============================================================================

  /**
   * Read cache file from .claude/plugins.json
   * Returns null if cache doesn't exist or is invalid
   */
  private async readCacheFile(claudePath: string): Promise<CachedPluginsData | null> {
    const cachePath = path.join(claudePath, 'plugins.json')
    try {
      const content = await fs.promises.readFile(cachePath, 'utf-8')
      const data = JSON.parse(content)
      return CachedPluginsDataSchema.parse(data)
    } catch (err) {
      logger.warn(`Failed to read cache file at ${cachePath}`, {
        error: err instanceof Error ? err.message : String(err)
      })
      return null
    }
  }

  /**
   * Write cache file to .claude/plugins.json atomically
   */
  private async writeCacheFile(claudePath: string, data: CachedPluginsData): Promise<void> {
    const cachePath = path.join(claudePath, 'plugins.json')
    const tempPath = `${cachePath}.tmp`

    const content = JSON.stringify(data, null, 2)
    await fs.promises.writeFile(tempPath, content, 'utf-8')
    await fs.promises.rename(tempPath, cachePath) // Atomic
  }

  /**
   * Rebuild cache by scanning .claude filesystem
   */
  private async rebuildCache(workdir: string): Promise<InstalledPlugin[]> {
    logger.info('Rebuilding plugin cache from filesystem', { workdir })

    const claudePath = path.join(workdir, '.claude')

    // Check if .claude directory exists
    try {
      await fs.promises.access(claudePath, fs.constants.R_OK)
    } catch {
      logger.warn('.claude directory not found, returning empty plugin list', { claudePath })
      return []
    }

    const plugins: InstalledPlugin[] = []

    // Scan agents directory
    const agentsPath = path.join(claudePath, 'agents')
    try {
      await fs.promises.access(agentsPath, fs.constants.R_OK)
      const files = await fs.promises.readdir(agentsPath, { withFileTypes: true })
      for (const file of files) {
        if (file.isFile() && this.ALLOWED_EXTENSIONS.includes(path.extname(file.name).toLowerCase())) {
          try {
            const filePath = path.join(agentsPath, file.name)
            const sourcePath = path.join('agents', file.name)
            const metadata = await parsePluginMetadata(filePath, sourcePath, 'agents', 'agent')
            plugins.push({ filename: file.name, type: 'agent', metadata })
          } catch (error) {
            logger.warn(`Failed to parse agent plugin: ${file.name}`, {
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }
    } catch {
      logger.debug('Agents directory not found or not accessible', { agentsPath })
    }

    // Scan commands directory
    const commandsPath = path.join(claudePath, 'commands')
    try {
      await fs.promises.access(commandsPath, fs.constants.R_OK)
      const files = await fs.promises.readdir(commandsPath, { withFileTypes: true })
      for (const file of files) {
        if (file.isFile() && this.ALLOWED_EXTENSIONS.includes(path.extname(file.name).toLowerCase())) {
          try {
            const filePath = path.join(commandsPath, file.name)
            const sourcePath = path.join('commands', file.name)
            const metadata = await parsePluginMetadata(filePath, sourcePath, 'commands', 'command')
            plugins.push({ filename: file.name, type: 'command', metadata })
          } catch (error) {
            logger.warn(`Failed to parse command plugin: ${file.name}`, {
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      }
    } catch {
      logger.debug('Commands directory not found or not accessible', { commandsPath })
    }

    // Scan skills directory
    const skillsPath = path.join(claudePath, 'skills')
    try {
      await fs.promises.access(skillsPath, fs.constants.R_OK)
      const skillDirectories = await findAllSkillDirectories(skillsPath, claudePath)
      for (const { folderPath, sourcePath } of skillDirectories) {
        try {
          const metadata = await parseSkillMetadata(folderPath, sourcePath, 'skills')
          plugins.push({ filename: metadata.filename, type: 'skill', metadata })
        } catch (error) {
          logger.warn(`Failed to parse skill plugin: ${sourcePath}`, {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch {
      logger.debug('Skills directory not found or not accessible', { skillsPath })
    }

    // Write cache file
    try {
      const cacheData: CachedPluginsData = {
        version: 1,
        lastUpdated: Date.now(),
        plugins
      }
      await this.writeCacheFile(claudePath, cacheData)
      logger.info(`Rebuilt cache with ${plugins.length} plugins`, { workdir })
    } catch (error) {
      logger.error('Failed to write cache file after rebuild', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return plugins
  }

  /**
   * List installed plugins from cache file
   * Falls back to filesystem scan if cache is missing or corrupt
   */
  async listInstalledFromCache(workdir: string): Promise<InstalledPlugin[]> {
    logger.debug('Listing installed plugins from cache', { workdir })

    const claudePath = path.join(workdir, '.claude')

    // Try to read cache
    const cacheData = await this.readCacheFile(claudePath)
    if (cacheData) {
      logger.debug(`Loaded ${cacheData.plugins.length} plugins from cache`, { workdir })
      return cacheData.plugins
    }

    // Cache read failed, rebuild from filesystem
    logger.info('Cache read failed, rebuilding from filesystem', { workdir })
    return await this.rebuildCache(workdir)
  }

  /**
   * Update cache file with a function
   * Reads current cache, applies updater, writes atomically
   * @internal - Will be used by install/uninstall operations in next phase
   */
  // @ts-expect-error - Will be used in next implementation phase
  private async updateCache(
    workdir: string,
    updater: (plugins: InstalledPlugin[]) => InstalledPlugin[]
  ): Promise<void> {
    logger.debug('Updating cache file', { workdir })

    // Get current plugins (from cache or rebuild)
    const currentPlugins = await this.listInstalledFromCache(workdir)

    // Apply updater function
    const updatedPlugins = updater(currentPlugins)

    const claudePath = path.join(workdir, '.claude')

    // Write updated cache
    const cacheData: CachedPluginsData = {
      version: 1,
      lastUpdated: Date.now(),
      plugins: updatedPlugins
    }

    await this.writeCacheFile(claudePath, cacheData)
    logger.info(`Updated cache with ${updatedPlugins.length} plugins`, { workdir })
  }

  /**
   * Read plugin content from source (resources directory)
   */
  async readContent(sourcePath: string): Promise<string> {
    logger.info('Reading plugin content', { sourcePath })

    // Validate source path
    this.validateSourcePath(sourcePath)

    // Get absolute path
    const basePath = this.getPluginsBasePath()
    const absolutePath = path.join(basePath, sourcePath)

    // Validate file exists and is accessible
    try {
      await fs.promises.access(absolutePath, fs.constants.R_OK)
    } catch (error) {
      throw {
        type: 'FILE_NOT_FOUND',
        path: sourcePath
      } as PluginError
    }

    // Read content
    try {
      const content = await fs.promises.readFile(absolutePath, 'utf8')
      logger.debug('Plugin content read successfully', {
        sourcePath,
        size: content.length
      })
      return content
    } catch (error) {
      throw {
        type: 'READ_FAILED',
        path: sourcePath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }
  }

  /**
   * Write plugin content to installed plugin (in agent's .claude directory)
   * Note: Only works for file-based plugins (agents/commands), not skills
   */
  async writeContent(agentId: string, filename: string, type: PluginType, content: string): Promise<void> {
    logger.info('Writing plugin content', { agentId, filename, type })

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

    const workdir = agent.accessible_paths?.[0]
    if (!workdir) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId,
        workdir: '',
        message: 'Agent has no accessible paths'
      } as PluginError
    }

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

    // Get file path
    const filePath = path.join(workdir, '.claude', type === 'agent' ? 'agents' : 'commands', filename)

    // Verify file exists
    try {
      await fs.promises.access(filePath, fs.constants.W_OK)
    } catch (error) {
      throw {
        type: 'FILE_NOT_FOUND',
        path: filePath
      } as PluginError
    }

    // Write content
    try {
      await fs.promises.writeFile(filePath, content, 'utf8')
      logger.debug('Plugin content written successfully', {
        filePath,
        size: content.length
      })

      // Update content hash in database
      const newContentHash = crypto.createHash('sha256').update(content).digest('hex')
      const updatedPlugins = installedPlugins.map((p) => {
        if (p.filename === filename && p.type === type) {
          return {
            ...p,
            contentHash: newContentHash,
            updatedAt: Date.now()
          }
        }
        return p
      })

      await AgentService.getInstance().updateAgent(agentId, {
        configuration: {
          permission_mode: 'default',
          max_turns: 100,
          ...agent.configuration,
          installed_plugins: updatedPlugins
        }
      })

      logger.info('Plugin content updated successfully', {
        agentId,
        filename,
        type,
        newContentHash
      })
    } catch (error) {
      throw {
        type: 'WRITE_FAILED',
        path: filePath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

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
   * Scan skills directory for skill folders (recursively)
   */
  private async scanSkillDirectory(): Promise<PluginMetadata[]> {
    const basePath = this.getPluginsBasePath()
    const skillsPath = path.join(basePath, 'skills')

    const skills: PluginMetadata[] = []

    try {
      // Check if skills directory exists
      try {
        await fs.promises.access(skillsPath)
      } catch {
        logger.warn('Skills directory not found', { skillsPath })
        return []
      }

      // Recursively find all directories containing SKILL.md
      const skillDirectories = await findAllSkillDirectories(skillsPath, basePath)

      logger.info(`Found ${skillDirectories.length} skill directories`, { skillsPath })

      // Parse metadata for each skill directory
      for (const { folderPath, sourcePath } of skillDirectories) {
        try {
          const metadata = await parseSkillMetadata(folderPath, sourcePath, 'skills')
          skills.push(metadata)
        } catch (error) {
          logger.warn(`Failed to parse skill folder: ${sourcePath}`, {
            folderPath,
            error: error instanceof Error ? error.message : String(error)
          })
          // Continue with other skills
        }
      }
    } catch (error) {
      logger.error('Failed to scan skill directory', { skillsPath, error })
      // Return empty array on error
    }

    return skills
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
   * Ensure .claude subdirectory exists for the given plugin type
   */
  private async ensureClaudeDirectory(workdir: string, type: PluginType): Promise<void> {
    const claudeDir = path.join(workdir, '.claude')

    let subDir: string
    if (type === 'agent') {
      subDir = 'agents'
    } else if (type === 'command') {
      subDir = 'commands'
    } else if (type === 'skill') {
      subDir = 'skills'
    } else {
      throw new Error(`Unknown plugin type: ${type}`)
    }

    const typeDir = path.join(claudeDir, subDir)

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
          permission_mode: 'default',
          max_turns: 100,
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
          permission_mode: 'default',
          max_turns: 100,
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
              permission_mode: 'default',
              max_turns: 100,
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

  /**
   * Install a skill (copy entire folder)
   */
  private async installSkill(
    agent: AgentEntity,
    sourceAbsolutePath: string,
    destPath: string,
    metadata: PluginMetadata
  ): Promise<void> {
    const logContext = logger.withContext('installSkill')

    // Step 1: If destination exists, remove it first (overwrite behavior)
    try {
      await fs.promises.access(destPath)
      // Exists - remove it
      await deleteDirectoryRecursive(destPath)
      logContext.info('Removed existing skill folder', { destPath })
    } catch {
      // Doesn't exist - nothing to remove
    }

    // Step 2: Copy folder to temporary location
    const tempPath = `${destPath}.tmp`
    let folderCopied = false

    try {
      // Copy to temp location
      await copyDirectoryRecursive(sourceAbsolutePath, tempPath)
      folderCopied = true
      logContext.info('Skill folder copied to temp location', { tempPath })

      // Step 3: Update agent configuration in database
      const updatedPlugins = [
        ...(agent.configuration?.installed_plugins || []).filter(
          (p) => !(p.filename === metadata.filename && p.type === 'skill')
        ),
        {
          sourcePath: metadata.sourcePath,
          filename: metadata.filename, // Folder name, no extension
          type: metadata.type,
          name: metadata.name,
          description: metadata.description,
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
          permission_mode: 'default',
          max_turns: 100,
          ...agent.configuration,
          installed_plugins: updatedPlugins
        }
      })

      logContext.info('Agent configuration updated', { agentId: agent.id })

      // Step 4: Move temp folder to final location (atomic on same filesystem)
      await fs.promises.rename(tempPath, destPath)
      logContext.info('Skill folder moved to final location', { destPath })
    } catch (error) {
      // Rollback: delete temp folder if it exists
      if (folderCopied) {
        try {
          await deleteDirectoryRecursive(tempPath)
          logContext.info('Rolled back temp folder', { tempPath })
        } catch (unlinkError) {
          logContext.error('Failed to rollback temp folder', { tempPath, error: unlinkError })
        }
      }

      throw {
        type: 'TRANSACTION_FAILED',
        operation: 'install-skill',
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }
  }

  /**
   * Uninstall a skill (remove entire folder)
   */
  private async uninstallSkill(agent: AgentEntity, folderName: string): Promise<void> {
    const logContext = logger.withContext('uninstallSkill')
    const workdir = agent.accessible_paths?.[0]

    if (!workdir) {
      throw {
        type: 'INVALID_WORKDIR',
        agentId: agent.id,
        workdir: '',
        message: 'Agent has no accessible paths'
      } as PluginError
    }

    const skillPath = path.join(workdir, '.claude', 'skills', folderName)

    // Step 1: Update database first
    const originalPlugins = agent.configuration?.installed_plugins || []
    const updatedPlugins = originalPlugins.filter((p) => !(p.filename === folderName && p.type === 'skill'))

    let dbUpdated = false

    try {
      await AgentService.getInstance().updateAgent(agent.id, {
        configuration: {
          permission_mode: 'default',
          max_turns: 100,
          ...agent.configuration,
          installed_plugins: updatedPlugins
        }
      })
      dbUpdated = true
      logContext.info('Agent configuration updated', { agentId: agent.id })

      // Step 2: Delete folder
      try {
        await deleteDirectoryRecursive(skillPath)
        logContext.info('Skill folder deleted', { skillPath })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error // Folder should exist, re-throw if not ENOENT
        }
        logContext.warn('Skill folder already deleted', { skillPath })
      }
    } catch (error) {
      // Rollback: restore database if folder deletion failed
      if (dbUpdated) {
        try {
          await AgentService.getInstance().updateAgent(agent.id, {
            configuration: {
              permission_mode: 'default',
              max_turns: 100,
              ...agent.configuration,
              installed_plugins: originalPlugins
            }
          })
          logContext.info('Rolled back database update', { agentId: agent.id })
        } catch (rollbackError) {
          logContext.error('Failed to rollback database', { agentId: agent.id, error: rollbackError })
        }
      }

      throw {
        type: 'TRANSACTION_FAILED',
        operation: 'uninstall-skill',
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }
  }
}

export const pluginService = PluginService.getInstance()
