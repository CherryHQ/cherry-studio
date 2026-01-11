import { loggerService } from '@logger'
import { isPathInside } from '@main/utils/file'
import { deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { parsePluginMetadata, parseSkillMetadata } from '@main/utils/markdownParser'
import {
  type GetAgentResponse,
  type InstalledPlugin,
  type InstallFromDirectoryOptions,
  type InstallFromZipOptions,
  type InstallFromZipResult,
  type InstallPluginOptions,
  type ListAvailablePluginsResult,
  type PluginError,
  type PluginManifest,
  PluginManifestSchema,
  type PluginMetadata,
  type PluginType,
  type SinglePluginInstallResult,
  type UninstallPluginOptions,
  type UninstallPluginPackageOptions,
  type UninstallPluginPackageResult
} from '@types'
import { app } from 'electron'
import * as fs from 'fs'
import StreamZip from 'node-stream-zip'
import * as path from 'path'

import { AgentService } from '../services/AgentService'
import { PluginCacheStore } from './PluginCacheStore'
import { PluginInstaller } from './PluginInstaller'

const logger = loggerService.withContext('PluginService')

interface PluginServiceConfig {
  maxFileSize: number // bytes
  cacheTimeout: number // milliseconds
}

// Install context for component installation
interface InstallContext {
  agent: GetAgentResponse
  workdir: string
}

// Result of creating installed plugin metadata
interface ComponentInstallResult {
  metadata: PluginMetadata
  installedPlugin: InstalledPlugin
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

  // ZIP extraction limits (protection against zip bombs)
  private readonly MAX_EXTRACTED_SIZE = 100 * 1024 * 1024 // 100MB
  private readonly MAX_FILES_COUNT = 1000

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
    this.installer = new PluginInstaller()

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
    return await this.installComponent(options, context)
  }

  private async prepareInstallContext(
    options: InstallPluginOptions
  ): Promise<InstallContext & { sourceAbsolutePath: string }> {
    const agent = await this.getAgentOrThrow(options.agentId)
    const workdir = this.getWorkdirOrThrow(agent, options.agentId)

    await this.validateWorkdir(agent, workdir)

    const sourceAbsolutePath = this.cacheStore.resolveSourcePath(options.sourcePath)

    return { agent, workdir, sourceAbsolutePath }
  }

  private async installComponent(
    options: InstallPluginOptions,
    context: InstallContext & { sourceAbsolutePath: string }
  ): Promise<PluginMetadata> {
    const { agent, workdir, sourceAbsolutePath } = context
    const { type, sourcePath } = options
    const isSkill = type === 'skill'

    // Validate and parse based on type
    if (isSkill) {
      await this.cacheStore.ensureSkillSourceDirectory(sourceAbsolutePath, sourcePath)
    } else {
      await this.cacheStore.validatePluginFile(sourceAbsolutePath, this.config.maxFileSize)
    }

    // Parse metadata
    const category = isSkill ? 'skills' : path.basename(path.dirname(sourcePath))
    const metadata = isSkill
      ? await parseSkillMetadata(sourceAbsolutePath, sourcePath, category)
      : await parsePluginMetadata(sourceAbsolutePath, sourcePath, category, type as 'agent' | 'command')

    // Sanitize name
    const sanitizedName = isSkill
      ? this.sanitizeFolderName(metadata.filename)
      : this.sanitizeFilename(metadata.filename)

    // Ensure directory and get destination path
    await this.ensureClaudeDirectory(workdir, type)
    const destPath = this.getClaudePluginPath(workdir, type, sanitizedName)

    // Install
    if (isSkill) {
      await this.installer.installSkill(agent.id, sourceAbsolutePath, destPath)
    } else {
      await this.installer.installFilePlugin(agent.id, sourceAbsolutePath, destPath)
    }

    // Create metadata and register in cache
    const { metadata: metadataWithInstall, installedPlugin } = this.createInstalledPluginMetadata(
      metadata,
      sanitizedName,
      type
    )

    await this.registerPluginInCache(workdir, installedPlugin, agent)

    logger.info('Plugin installed successfully', {
      agentId: options.agentId,
      filename: sanitizedName,
      type
    })

    return metadataWithInstall
  }

  /**
   * Uninstall plugin with cleanup
   */
  async uninstall(options: UninstallPluginOptions): Promise<void> {
    logger.info('Uninstalling plugin', options)

    const agent = await this.getAgentOrThrow(options.agentId)
    const workdir = this.getWorkdirOrThrow(agent, options.agentId)
    await this.validateWorkdir(agent, workdir)

    // Construct InstalledPlugin for internal uninstall
    const plugin: InstalledPlugin = {
      filename: options.filename,
      type: options.type,
      metadata: {} as PluginMetadata // Only filename and type are used by uninstallComponentInternal
    }

    await this.uninstallComponentInternal(workdir, agent, plugin)

    logger.info('Plugin uninstalled successfully', {
      agentId: options.agentId,
      filename: options.filename,
      type: options.type
    })
  }

  /**
   * Uninstall entire plugin package and all its components
   */
  async uninstallPluginPackage(options: UninstallPluginPackageOptions): Promise<UninstallPluginPackageResult> {
    const { agentId, packageName } = options
    logger.info('Uninstalling plugin package', { agentId, packageName })

    const agent = await this.getAgentOrThrow(agentId)
    const workdir = this.getWorkdirOrThrow(agent, agentId)
    await this.validateWorkdir(agent, workdir)

    // 1. Find all components belonging to this package
    const installedPlugins = await this.listInstalledFromCache(workdir)
    const packageComponents = installedPlugins.filter((p) => p.metadata.packageName === packageName)

    if (packageComponents.length === 0) {
      throw {
        type: 'PLUGIN_PACKAGE_NOT_FOUND',
        packageName
      } as PluginError
    }

    const uninstalledComponents: Array<{ filename: string; type: PluginType }> = []

    // 2. Uninstall each component
    for (const component of packageComponents) {
      try {
        await this.uninstallComponentInternal(workdir, agent, component)
        uninstalledComponents.push({
          filename: component.filename,
          type: component.type
        })
      } catch (error) {
        logger.warn('Failed to uninstall component', {
          filename: component.filename,
          type: component.type,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // 3. Remove package directory .claude/plugins/<packageName>/
    let directoryRemoved = false
    const sanitizedPackageName = this.sanitizeFolderName(packageName)
    const packageDirPath = path.join(workdir, '.claude', 'plugins', sanitizedPackageName)
    try {
      if (await this.directoryExists(packageDirPath)) {
        await deleteDirectoryRecursive(packageDirPath)
        directoryRemoved = true
        logger.info('Package directory removed', { packageDirPath })
      }
    } catch (error) {
      logger.warn('Failed to remove package directory', {
        packageDirPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    logger.info('Plugin package uninstalled', {
      agentId,
      packageName,
      componentsUninstalled: uninstalledComponents.length,
      directoryRemoved
    })

    return {
      packageName,
      uninstalledComponents,
      directoryRemoved
    }
  }

  /**
   * Internal method to uninstall a single component
   */
  private async uninstallComponentInternal(
    workdir: string,
    agent: GetAgentResponse,
    plugin: InstalledPlugin
  ): Promise<void> {
    const { filename, type } = plugin

    if (type === 'skill') {
      const sanitizedFolderName = this.sanitizeFolderName(filename)
      const skillPath = this.getClaudePluginPath(workdir, 'skill', sanitizedFolderName)
      await this.installer.uninstallSkill(agent.id, sanitizedFolderName, skillPath)
      await this.cacheStore.remove(workdir, sanitizedFolderName, 'skill')
      this.removeAgentPlugin(agent, sanitizedFolderName, 'skill')
    } else {
      const sanitizedFilename = this.sanitizeFilename(filename)
      const filePath = this.getClaudePluginPath(workdir, type, sanitizedFilename)
      await this.installer.uninstallFilePlugin(agent.id, sanitizedFilename, type, filePath)
      await this.cacheStore.remove(workdir, sanitizedFilename, type)
      this.removeAgentPlugin(agent, sanitizedFilename, type)
    }
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

  private async safeRemoveDirectory(dirPath: string): Promise<void> {
    try {
      await deleteDirectoryRecursive(dirPath)
      logger.debug('Cleaned up temp directory', { dirPath })
    } catch (error) {
      logger.warn('Failed to clean up temp directory', {
        dirPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async validateZipFile(zipFilePath: string): Promise<void> {
    try {
      const stats = await fs.promises.stat(zipFilePath)
      if (!stats.isFile()) {
        throw { type: 'INVALID_ZIP_FORMAT', path: zipFilePath, reason: 'Not a file' } as PluginError
      }
      if (!zipFilePath.toLowerCase().endsWith('.zip')) {
        throw { type: 'INVALID_ZIP_FORMAT', path: zipFilePath, reason: 'Not a ZIP file' } as PluginError
      }
    } catch (error) {
      if ((error as PluginError).type) throw error
      throw { type: 'FILE_NOT_FOUND', path: zipFilePath } as PluginError
    }
  }

  private async extractZip(zipFilePath: string, destDir: string): Promise<void> {
    const zip = new StreamZip.async({ file: zipFilePath })

    try {
      // Validate ZIP contents before extraction (zip bomb protection)
      const entries = await zip.entries()
      let totalSize = 0
      let fileCount = 0

      for (const entry of Object.values(entries)) {
        totalSize += entry.size
        fileCount++

        if (totalSize > this.MAX_EXTRACTED_SIZE) {
          throw {
            type: 'FILE_TOO_LARGE',
            size: totalSize,
            max: this.MAX_EXTRACTED_SIZE
          } as PluginError
        }
        if (fileCount > this.MAX_FILES_COUNT) {
          throw {
            type: 'ZIP_EXTRACTION_FAILED',
            path: zipFilePath,
            reason: `Too many files (${fileCount} > ${this.MAX_FILES_COUNT})`
          } as PluginError
        }
      }

      await zip.extract(null, destDir)
      logger.debug('ZIP extracted successfully', { zipFilePath, destDir, totalSize, fileCount })
    } catch (error) {
      // Re-throw PluginError as-is
      if (error && typeof error === 'object' && 'type' in error) {
        throw error
      }
      throw {
        type: 'ZIP_EXTRACTION_FAILED',
        path: zipFilePath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    } finally {
      await zip.close()
    }
  }

  /**
   * Install plugin package from ZIP file
   * Supports complete plugin packages with .claude-plugin/plugin.json
   * Supports multiple plugin packages in a single ZIP
   */
  async installFromZip(options: InstallFromZipOptions): Promise<InstallFromZipResult> {
    const { agentId, zipFilePath } = options
    logger.info('Installing plugin package from ZIP', { agentId, zipFilePath })

    const agent = await this.getAgentOrThrow(agentId)
    const workdir = this.getWorkdirOrThrow(agent, agentId)
    await this.validateWorkdir(agent, workdir)
    await this.validateZipFile(zipFilePath)

    const tempDir = path.join(app.getPath('temp'), 'cherry-studio', 'plugin-upload', `plugin-${Date.now()}`)
    await fs.promises.mkdir(tempDir, { recursive: true })

    try {
      await this.extractZip(zipFilePath, tempDir)
      return await this.installFromSourceDir(tempDir, workdir, agent, agentId, 'ZIP')
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  /**
   * Install plugin package from directory
   * Supports complete plugin packages with .claude-plugin/plugin.json
   * Supports multiple plugin packages in a single directory
   */
  async installFromDirectory(options: InstallFromDirectoryOptions): Promise<InstallFromZipResult> {
    const { agentId, directoryPath } = options
    logger.info('Installing plugin package from directory', { agentId, directoryPath })

    const agent = await this.getAgentOrThrow(agentId)
    const workdir = this.getWorkdirOrThrow(agent, agentId)
    await this.validateWorkdir(agent, workdir)

    if (!(await this.directoryExists(directoryPath))) {
      throw { type: 'FILE_NOT_FOUND', path: directoryPath } as PluginError
    }

    // Validate directory is readable
    try {
      await fs.promises.access(directoryPath, fs.constants.R_OK)
    } catch {
      throw { type: 'PERMISSION_DENIED', path: directoryPath } as PluginError
    }

    return await this.installFromSourceDir(directoryPath, workdir, agent, agentId, 'directory')
  }

  /**
   * Install plugin packages from a source directory (shared logic for ZIP and directory install)
   */
  private async installFromSourceDir(
    sourceDir: string,
    workdir: string,
    agent: GetAgentResponse,
    agentId: string,
    sourceType: 'ZIP' | 'directory'
  ): Promise<InstallFromZipResult> {
    const pluginRoots = await this.findPluginRoots(sourceDir)

    if (pluginRoots.length === 0) {
      throw { type: 'PLUGIN_MANIFEST_NOT_FOUND', path: sourceDir } as PluginError
    }

    const packages = await this.installPluginRoots(pluginRoots, workdir, agent)
    const totalInstalled = packages.reduce((sum, p) => sum + p.installed.length, 0)
    const totalFailed = packages.reduce((sum, p) => sum + p.failed.length, 0)

    logger.info(`Plugin package(s) installed from ${sourceType}`, {
      agentId,
      packageCount: packages.length,
      totalInstalled,
      totalFailed
    })

    return { packages, totalInstalled, totalFailed }
  }

  /**
   * Install multiple plugin roots and collect results
   */
  private async installPluginRoots(
    pluginRoots: string[],
    workdir: string,
    agent: GetAgentResponse
  ): Promise<SinglePluginInstallResult[]> {
    const packages: SinglePluginInstallResult[] = []
    for (const pluginRoot of pluginRoots) {
      try {
        const result = await this.installSinglePlugin(pluginRoot, workdir, agent)
        packages.push(result)
      } catch (error) {
        packages.push({
          pluginName: path.basename(pluginRoot),
          installed: [],
          failed: [{ path: pluginRoot, error: error instanceof Error ? error.message : String(error) }]
        })
      }
    }
    return packages
  }

  /**
   * Install a single plugin package from a plugin root directory
   */
  private async installSinglePlugin(
    pluginRoot: string,
    workdir: string,
    agent: GetAgentResponse
  ): Promise<SinglePluginInstallResult> {
    // 1. Read and validate plugin manifest
    const manifest = await this.readPluginManifest(pluginRoot)
    const pluginFolderName = this.sanitizeFolderName(manifest.name)
    const packageInfo = { packageName: manifest.name, packageVersion: manifest.version }

    // 2. Copy entire plugin package to .claude/plugins/<plugin-name>/
    const pluginDestPath = path.join(workdir, '.claude', 'plugins', pluginFolderName)
    await this.copyPluginDirectory(pluginRoot, pluginDestPath)

    // 3. Scan and register components (default directories + custom paths)
    const results = await Promise.all([
      this.scanComponentPaths(pluginDestPath, 'skills', manifest.skills, 'skill', workdir, agent, packageInfo),
      this.scanComponentPaths(pluginDestPath, 'agents', manifest.agents, 'agent', workdir, agent, packageInfo),
      this.scanComponentPaths(pluginDestPath, 'commands', manifest.commands, 'command', workdir, agent, packageInfo)
    ])

    const installed = results.flatMap((r) => r.installed)
    const failed = results.flatMap((r) => r.failed)

    // 4. Validate: at least one item registered
    if (installed.length === 0 && failed.length === 0) {
      throw { type: 'EMPTY_PLUGIN_PACKAGE', path: pluginRoot } as PluginError
    }

    logger.info('Single plugin package installed', {
      pluginName: manifest.name,
      installedCount: installed.length,
      failedCount: failed.length
    })

    return {
      pluginName: manifest.name,
      installed,
      failed
    }
  }

  /**
   * Read and validate plugin manifest from .claude-plugin/plugin.json
   */
  private async readPluginManifest(dir: string): Promise<PluginManifest> {
    const manifestPath = path.join(dir, '.claude-plugin', 'plugin.json')

    // Log directory contents for debugging
    try {
      const entries = await fs.promises.readdir(dir)
      logger.debug('Plugin directory contents', { dir, entries })
    } catch (e) {
      logger.warn('Failed to read plugin directory', { dir, error: e instanceof Error ? e.message : String(e) })
    }

    try {
      await fs.promises.access(manifestPath, fs.constants.R_OK)
    } catch {
      throw { type: 'PLUGIN_MANIFEST_NOT_FOUND', path: manifestPath } as PluginError
    }

    try {
      const content = await fs.promises.readFile(manifestPath, 'utf-8')
      const json = JSON.parse(content)
      return PluginManifestSchema.parse(json)
    } catch (error) {
      if ((error as PluginError).type) throw error
      throw {
        type: 'PLUGIN_MANIFEST_INVALID',
        path: manifestPath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }
  }

  /**
   * Copy plugin directory with symlink dereferencing
   */
  private async copyPluginDirectory(src: string, dest: string): Promise<void> {
    // Ensure parent directory exists
    await fs.promises.mkdir(path.dirname(dest), { recursive: true })

    // Remove existing destination if exists
    try {
      await fs.promises.rm(dest, { recursive: true, force: true })
    } catch {
      // Ignore if doesn't exist
    }

    // Copy with symlink dereferencing (as per Claude Code docs)
    await fs.promises.cp(src, dest, {
      recursive: true,
      dereference: true // Honor symlinks by dereferencing them
    })

    logger.debug('Plugin directory copied', { src, dest })
  }

  /**
   * Find all plugin root directories.
   * Supports: single plugin, single plugin with wrapper directory, multiple plugins.
   * e.g., if ZIP extracts to: tempDir/plugin-name/.claude-plugin/plugin.json
   * this method returns: [tempDir/plugin-name]
   * e.g., if ZIP extracts to: tempDir/plugins/{plugin1, plugin2}/.claude-plugin/...
   * this method returns: [tempDir/plugins/plugin1, tempDir/plugins/plugin2]
   */
  private async findPluginRoots(extractedDir: string): Promise<string[]> {
    // Case 1: Directory itself is a plugin root
    if (await this.hasClaudePluginDir(extractedDir)) {
      logger.debug('Plugin root found at extracted directory', { extractedDir })
      return [extractedDir]
    }

    // Case 2: Scan subdirectories for plugins
    const entries = await fs.promises.readdir(extractedDir, { withFileTypes: true })
    const directories = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))

    const roots: string[] = []
    for (const dir of directories) {
      const subDir = path.join(extractedDir, dir.name)
      if (await this.hasClaudePluginDir(subDir)) {
        roots.push(subDir)
      }
    }

    // If found multiple plugins, return them
    if (roots.length > 0) {
      logger.debug('Found plugin roots', { count: roots.length, roots })
      return roots
    }

    // Case 3: Single wrapper directory, recursively check inside
    if (directories.length === 1) {
      const subDir = path.join(extractedDir, directories[0].name)
      return this.findPluginRoots(subDir)
    }

    // No plugins found
    logger.warn('Could not find any plugin roots with .claude-plugin directory', {
      extractedDir,
      entries: entries.map((e) => e.name)
    })
    return []
  }

  /**
   * Check if directory contains .claude-plugin subdirectory
   */
  private async hasClaudePluginDir(dir: string): Promise<boolean> {
    return this.directoryExists(path.join(dir, '.claude-plugin'))
  }

  /**
   * Scan default directory + custom paths for components
   */
  private async scanComponentPaths(
    pluginDir: string,
    defaultSubDir: string,
    customPaths: string | string[] | undefined,
    type: PluginType,
    workdir: string,
    agent: GetAgentResponse,
    packageInfo?: { packageName: string; packageVersion?: string }
  ): Promise<{ installed: PluginMetadata[]; failed: Array<{ path: string; error: string }> }> {
    const results: { installed: PluginMetadata[]; failed: Array<{ path: string; error: string }> } = {
      installed: [],
      failed: []
    }
    const scannedPaths = new Set<string>()

    // 1. Scan default directory
    const defaultPath = path.join(pluginDir, defaultSubDir)
    if (await this.directoryExists(defaultPath)) {
      scannedPaths.add(defaultPath)
      const result = await this.scanAndRegisterComponents(defaultPath, type, workdir, agent, packageInfo)
      results.installed.push(...result.installed)
      results.failed.push(...result.failed)
    }

    // 2. Scan custom paths (supplement, not replace)
    if (customPaths) {
      const pathArray = Array.isArray(customPaths) ? customPaths : [customPaths]
      for (const p of pathArray) {
        // Validate path doesn't escape plugin directory (path traversal protection)
        const fullPath = path.resolve(pluginDir, p)
        if (!isPathInside(fullPath, pluginDir)) {
          logger.warn('Skipping custom path with path traversal', { customPath: p, pluginDir })
          results.failed.push({
            path: p,
            error: 'Path traversal detected - custom paths must stay within plugin directory'
          })
          continue
        }

        if (!scannedPaths.has(fullPath)) {
          scannedPaths.add(fullPath)
          if (await this.pathExists(fullPath)) {
            const result = await this.scanAndRegisterComponents(fullPath, type, workdir, agent, packageInfo)
            results.installed.push(...result.installed)
            results.failed.push(...result.failed)
          }
        }
      }
    }

    return results
  }

  /**
   * Scan a directory and register all valid components
   */
  private async scanAndRegisterComponents(
    dirPath: string,
    type: PluginType,
    workdir: string,
    agent: GetAgentResponse,
    packageInfo?: { packageName: string; packageVersion?: string }
  ): Promise<{ installed: PluginMetadata[]; failed: Array<{ path: string; error: string }> }> {
    const results: { installed: PluginMetadata[]; failed: Array<{ path: string; error: string }> } = {
      installed: [],
      failed: []
    }

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name)

        try {
          if (type === 'skill' && entry.isDirectory()) {
            // Skills are directories with SKILL.md
            const skillMdPath = path.join(entryPath, 'SKILL.md')
            if (await this.fileExists(skillMdPath)) {
              const metadata = await this.registerComponent(entryPath, entry.name, 'skill', workdir, agent, packageInfo)
              results.installed.push(metadata)
            }
          } else if ((type === 'agent' || type === 'command') && entry.isFile()) {
            // Agents and commands are .md files
            if (entry.name.endsWith('.md') || entry.name.endsWith('.markdown')) {
              const metadata = await this.registerComponent(entryPath, entry.name, type, workdir, agent, packageInfo)
              results.installed.push(metadata)
            }
          }
        } catch (error) {
          results.failed.push({
            path: entryPath,
            error: error instanceof Error ? error.message : String(error)
          })
          logger.warn('Failed to register component', {
            path: entryPath,
            type,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      logger.warn('Failed to scan directory', {
        dirPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return results
  }

  /**
   * Register a component (skill/agent/command) and update cache
   */
  private async registerComponent(
    componentPath: string,
    name: string,
    type: PluginType,
    workdir: string,
    agent: GetAgentResponse,
    packageInfo?: { packageName: string; packageVersion?: string }
  ): Promise<PluginMetadata> {
    const isSkill = type === 'skill'

    // Parse metadata based on type
    const metadata = isSkill
      ? await parseSkillMetadata(componentPath, name, 'plugins')
      : await parsePluginMetadata(componentPath, name, 'plugins', type as 'agent' | 'command')

    // Sanitize name based on type
    const sanitizedName = isSkill
      ? this.sanitizeFolderName(metadata.filename)
      : this.sanitizeFilename(metadata.filename)

    // Create metadata and register in cache
    const { metadata: metadataWithInstall, installedPlugin } = this.createInstalledPluginMetadata(
      metadata,
      sanitizedName,
      type,
      packageInfo
    )

    await this.registerPluginInCache(workdir, installedPlugin, agent)

    logger.debug('Component registered', { name: sanitizedName, type, packageName: packageInfo?.packageName })
    return metadataWithInstall
  }

  /**
   * Check if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(dirPath)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Check if path exists (file or directory)
   */
  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.promises.access(p, fs.constants.R_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(filePath)
      return stats.isFile()
    } catch {
      return false
    }
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
    let installedPlugins = agent.installed_plugins ?? []
    if (installedPlugins.length === 0) {
      installedPlugins = await this.cacheStore.listInstalled(workdir)
      agent.installed_plugins = installedPlugins
    }
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
    const newContentHash = await this.installer.updateFilePluginContent(agent.id, filePath, content)

    const updatedMetadata: PluginMetadata = {
      ...installedPlugin.metadata,
      contentHash: newContentHash,
      size: Buffer.byteLength(content, 'utf8'),
      updatedAt: Date.now(),
      filename,
      type: filePluginType
    }
    const updatedPlugin: InstalledPlugin = {
      filename,
      type: filePluginType,
      metadata: updatedMetadata
    }

    await this.registerPluginInCache(workdir, updatedPlugin, agent)

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
  private async getAgentOrThrow(agentId: string): Promise<GetAgentResponse> {
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

  private getWorkdirOrThrow(agent: GetAgentResponse, agentId: string): string {
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
  private async validateWorkdir(agent: GetAgentResponse, workdir: string): Promise<void> {
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
   * Create metadata and InstalledPlugin objects for a component
   */
  private createInstalledPluginMetadata(
    metadata: PluginMetadata,
    filename: string,
    type: PluginType,
    packageInfo?: { packageName: string; packageVersion?: string }
  ): ComponentInstallResult {
    const installedAt = Date.now()
    const metadataWithInstall: PluginMetadata = {
      ...metadata,
      filename,
      installedAt,
      updatedAt: metadata.updatedAt ?? installedAt,
      type,
      ...(packageInfo && {
        packageName: packageInfo.packageName,
        packageVersion: packageInfo.packageVersion
      })
    }
    const installedPlugin: InstalledPlugin = {
      filename,
      type,
      metadata: metadataWithInstall
    }
    return { metadata: metadataWithInstall, installedPlugin }
  }

  /**
   * Register plugin in both cache store and agent's installed_plugins
   */
  private async registerPluginInCache(
    workdir: string,
    installedPlugin: InstalledPlugin,
    agent: GetAgentResponse
  ): Promise<void> {
    await this.cacheStore.upsert(workdir, installedPlugin)
    this.upsertAgentPlugin(agent, installedPlugin)
  }

  private upsertAgentPlugin(agent: GetAgentResponse, plugin: InstalledPlugin): void {
    const existing = agent.installed_plugins ?? []
    const filtered = existing.filter((p) => !(p.filename === plugin.filename && p.type === plugin.type))
    agent.installed_plugins = [...filtered, plugin]
  }

  private removeAgentPlugin(agent: GetAgentResponse, filename: string, type: PluginType): void {
    if (!agent.installed_plugins) {
      agent.installed_plugins = []
      return
    }
    agent.installed_plugins = agent.installed_plugins.filter((p) => !(p.filename === filename && p.type === type))
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
