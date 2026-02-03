import { spawn } from 'node:child_process'

import { loggerService } from '@logger'
import { directoryExists, fileExists, isPathInside, pathExists } from '@main/utils/file'
import { deleteDirectoryRecursive } from '@main/utils/fileOperations'
import {
  findAllSkillDirectories,
  findSkillMdPath,
  parsePluginMetadata,
  parseSkillMetadata
} from '@main/utils/markdownParser'
import { findExecutable } from '@main/utils/process'
import {
  type GetAgentResponse,
  type InstalledPlugin,
  type InstallFromDirectoryOptions,
  type InstallFromSourceResult,
  type InstallFromZipOptions,
  type InstallPluginOptions,
  type MarketplaceManifest,
  MarketplaceManifestSchema,
  type MarketplacePluginEntry,
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
import { app, net } from 'electron'
import * as fs from 'fs'
import StreamZip from 'node-stream-zip'
import * as path from 'path'

import { AgentService } from '../services/AgentService'
import { PluginCacheStore } from './PluginCacheStore'
import { PluginInstaller } from './PluginInstaller'

const logger = loggerService.withContext('PluginService')

/**
 * Claude Plugins Registry API base URL.
 *
 * This API provides plugin/skill discovery and installation tracking for the
 * Claude plugins ecosystem. The API endpoints used are:
 * - GET  /api/resolve/{owner}/{marketplace}/{plugin} - Resolve plugin git URL and metadata
 * - GET  /api/skills/{owner}/{repo}/{skillName}      - Get skill metadata and source URL
 * - POST /api/skills/{owner}/{repo}/{skillName}/install - Track skill installation
 *
 * @see https://www.val.town/x/kamalnrf/claude-plugins-registry/code/API.md
 *
 * TODO: Verify accessibility from China mainland - may need proxy or alternative endpoint
 */
const MARKETPLACE_API_BASE_URL = 'https://api.claude-plugins.dev'
const MARKETPLACE_SOURCE_PREFIX = 'marketplace:'

interface PluginServiceConfig {
  maxFileSize: number // bytes
}

// Install context for component installation
interface InstallContext {
  agent: GetAgentResponse
  workdir: string
}

interface MarketplaceIdentifier {
  kind: 'plugin' | 'skill'
  owner: string
  repository: string
  name: string
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

  private config: PluginServiceConfig
  private readonly cacheStore: PluginCacheStore
  private readonly installer: PluginInstaller
  private readonly agentService: AgentService

  private readonly ALLOWED_EXTENSIONS = ['.md', '.markdown']

  private constructor(config?: Partial<PluginServiceConfig>) {
    this.config = {
      maxFileSize: config?.maxFileSize ?? 1024 * 1024 // 1MB default
    }
    this.agentService = AgentService.getInstance()
    this.cacheStore = new PluginCacheStore({
      allowedExtensions: this.ALLOWED_EXTENSIONS,
      getPluginDirectoryName: this.getPluginDirectoryName.bind(this),
      getClaudeBasePath: this.getClaudeBasePath.bind(this),
      getClaudePluginDirectory: this.getClaudePluginDirectory.bind(this)
    })
    this.installer = new PluginInstaller()

    logger.info('PluginService initialized', {
      maxFileSize: this.config.maxFileSize
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
   * Install plugin with validation and transactional safety
   */
  async install(options: InstallPluginOptions): Promise<PluginMetadata> {
    logger.info('Installing plugin', options)
    if (this.isMarketplaceSource(options.sourcePath)) {
      const agent = await this.getAgentOrThrow(options.agentId)
      const workdir = this.getWorkdirOrThrow(agent, options.agentId)
      await this.validateWorkdir(agent, workdir)
      return await this.installMarketplace(options, { agent, workdir })
    }

    throw {
      type: 'INVALID_METADATA',
      reason: 'Local preset plugin sources are disabled. Use marketplace or upload installs.',
      path: options.sourcePath
    } as PluginError
  }

  private isMarketplaceSource(sourcePath: string): boolean {
    return sourcePath.startsWith(MARKETPLACE_SOURCE_PREFIX)
  }

  private parseMarketplaceSource(sourcePath: string): MarketplaceIdentifier {
    const trimmed = sourcePath.trim()
    if (!trimmed.startsWith(MARKETPLACE_SOURCE_PREFIX)) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Invalid marketplace source path',
        path: sourcePath
      } as PluginError
    }

    const [, kind, identifier] = trimmed.split(':')
    if ((kind !== 'plugin' && kind !== 'skill') || !identifier) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Marketplace source must include kind and identifier',
        path: sourcePath
      } as PluginError
    }

    const parts = identifier.split('/').filter(Boolean)
    if (parts.length < 3) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Marketplace identifier must include owner/repo/name',
        path: sourcePath
      } as PluginError
    }

    const [owner, repository, ...rest] = parts
    const name = rest.join('/')

    return { kind, owner, repository, name }
  }

  private async installMarketplace(options: InstallPluginOptions, context: InstallContext): Promise<PluginMetadata> {
    const identifier = this.parseMarketplaceSource(options.sourcePath)
    if (identifier.kind === 'skill') {
      return await this.installMarketplaceSkill(identifier, context)
    }
    return await this.installMarketplacePlugin(identifier, context)
  }

  private async installMarketplacePlugin(
    identifier: MarketplaceIdentifier,
    context: InstallContext
  ): Promise<PluginMetadata> {
    const resolveUrl = `${MARKETPLACE_API_BASE_URL}/api/resolve/${identifier.owner}/${identifier.repository}/${identifier.name}`
    const payload = await this.requestMarketplaceJson(resolveUrl)
    const repoUrl = this.extractRepositoryUrl(payload)

    if (!repoUrl) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Marketplace resolve response missing repository URL',
        path: resolveUrl
      } as PluginError
    }

    const tempDir = await this.createMarketplaceTempDir(identifier)

    try {
      await this.cloneRepository(repoUrl, tempDir)
      const result = await this.installFromSourceDir(
        tempDir,
        context.workdir,
        context.agent,
        context.agent.id,
        'directory'
      )
      const installed = result.packages.flatMap((item) => item.installed)
      if (installed.length === 0) {
        throw { type: 'EMPTY_PLUGIN_PACKAGE', path: tempDir } as PluginError
      }
      return installed[0]
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  private async installMarketplaceSkill(
    identifier: MarketplaceIdentifier,
    context: InstallContext
  ): Promise<PluginMetadata> {
    const resolveUrl = `${MARKETPLACE_API_BASE_URL}/api/skills/${identifier.owner}/${identifier.repository}/${identifier.name}`
    const payload = await this.requestMarketplaceJson(resolveUrl)
    const sourceUrl = this.extractSkillSourceUrl(payload)
    const directoryPath = this.extractSkillDirectoryPath(payload)

    if (!sourceUrl) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Marketplace skill response missing source URL',
        path: resolveUrl
      } as PluginError
    }

    const tempDir = await this.createMarketplaceTempDir(identifier)

    try {
      await this.cloneRepository(sourceUrl, tempDir)
      const skillDir = await this.resolveSkillDirectory(tempDir, identifier.name, directoryPath)
      const metadata = await this.installMarketplaceSkillFromDirectory(skillDir, context)
      this.reportSkillInstall(identifier).catch((error) => {
        logger.warn('Failed to report skill install', {
          owner: identifier.owner,
          repository: identifier.repository,
          name: identifier.name,
          error: error instanceof Error ? error.message : String(error)
        })
      })
      return metadata
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  private async installMarketplaceSkillFromDirectory(
    skillDir: string,
    context: InstallContext
  ): Promise<PluginMetadata> {
    const folderName = path.basename(skillDir)
    const sourcePath = path.join('skills', folderName)

    const metadata = await parseSkillMetadata(skillDir, sourcePath, 'skills')
    const sanitizedName = this.sanitizeFolderName(metadata.filename)

    await this.ensureClaudeDirectory(context.workdir, 'skill')
    const destPath = this.getClaudePluginPath(context.workdir, 'skill', sanitizedName)
    await this.installer.installSkill(context.agent.id, skillDir, destPath)

    const { metadata: metadataWithInstall, installedPlugin } = this.createInstalledPluginMetadata(
      metadata,
      sanitizedName,
      'skill'
    )
    await this.registerPluginInCache(context.workdir, installedPlugin, context.agent)

    return metadataWithInstall
  }

  private async requestMarketplaceJson(url: string): Promise<unknown> {
    const response = await net.fetch(url, { method: 'GET' })
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: 'Request failed' }))
      const message =
        typeof errorBody?.message === 'string'
          ? errorBody.message
          : `HTTP ${response.status}: ${response.statusText || 'Request failed'}`
      throw {
        type: 'TRANSACTION_FAILED',
        operation: 'marketplace-fetch',
        reason: message
      } as PluginError
    }
    return response.json()
  }

  private extractRepositoryUrl(payload: unknown): string | null {
    if (typeof payload === 'string') return payload
    if (!payload || typeof payload !== 'object') return null
    const record = payload as Record<string, unknown>
    const url = record.gitUrl ?? record.git_url ?? record.url ?? record.repoUrl ?? record.repo_url
    return typeof url === 'string' && url.length > 0 ? url : null
  }

  private extractSkillSourceUrl(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const record = payload as Record<string, unknown>
    const sourceUrl = record.sourceUrl ?? record.source_url
    return typeof sourceUrl === 'string' && sourceUrl.length > 0 ? sourceUrl : null
  }

  private extractSkillDirectoryPath(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const record = payload as Record<string, unknown>
    const metadata = record.metadata
    if (!metadata || typeof metadata !== 'object') return null
    const directoryPath = (metadata as Record<string, unknown>).directoryPath
    return typeof directoryPath === 'string' && directoryPath.length > 0 ? directoryPath : null
  }

  private async resolveSkillDirectory(
    repoDir: string,
    skillName: string,
    directoryPath: string | null
  ): Promise<string> {
    if (directoryPath) {
      const resolved = path.resolve(repoDir, directoryPath)
      const skillMdPath = await findSkillMdPath(resolved)
      if (skillMdPath) {
        return resolved
      }
    }

    const candidates = await findAllSkillDirectories(repoDir, repoDir, 8)
    const matched = candidates.find((candidate) => path.basename(candidate.folderPath) === skillName)
    if (matched) {
      return matched.folderPath
    }

    if (candidates.length === 1) {
      return candidates[0].folderPath
    }

    throw {
      type: 'INVALID_METADATA',
      reason: 'Unable to locate skill directory',
      path: repoDir
    } as PluginError
  }

  private async createMarketplaceTempDir(identifier: MarketplaceIdentifier): Promise<string> {
    const safeName = this.sanitizeFolderName(`${identifier.owner}-${identifier.repository}-${identifier.name}`)
    const tempDir = path.join(app.getPath('temp'), 'cherry-studio', 'marketplace-install', `${safeName}-${Date.now()}`)
    await fs.promises.mkdir(tempDir, { recursive: true })
    return tempDir
  }

  private async cloneRepository(repoUrl: string, destDir: string): Promise<void> {
    const gitCommand = findExecutable('git') ?? 'git'
    const branch = await this.resolveDefaultBranch(gitCommand, repoUrl)
    if (branch) {
      await this.runCommand(gitCommand, ['clone', '--depth', '1', '--branch', branch, '--', repoUrl, destDir])
      return
    }

    try {
      await this.runCommand(gitCommand, ['clone', '--depth', '1', '--', repoUrl, destDir])
    } catch (error) {
      logger.warn('Default clone failed, retrying with master branch', {
        repoUrl,
        error: error instanceof Error ? error.message : String(error)
      })
      await this.runCommand(gitCommand, ['clone', '--depth', '1', '--branch', 'master', '--', repoUrl, destDir])
    }
  }

  private async runCommand(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'pipe' })
      let errorOutput = ''

      child.stderr?.on('data', (chunk) => {
        errorOutput += chunk.toString()
      })

      child.on('error', (error) => {
        reject(error)
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(errorOutput || `Command failed with code ${code}`))
        }
      })
    })
  }

  private async resolveDefaultBranch(command: string, repoUrl: string): Promise<string | null> {
    try {
      const output = await this.captureCommand(command, ['ls-remote', '--symref', '--', repoUrl, 'HEAD'])
      const match = output.match(/ref: refs\/heads\/([^\s]+)/)
      return match?.[1] ?? null
    } catch (error) {
      logger.warn('Failed to resolve default branch', {
        repoUrl,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private async captureCommand(command: string, args: string[]): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'pipe' })
      let output = ''
      let errorOutput = ''

      child.stdout?.on('data', (chunk) => {
        output += chunk.toString()
      })

      child.stderr?.on('data', (chunk) => {
        errorOutput += chunk.toString()
      })

      child.on('error', (error) => {
        reject(error)
      })

      child.on('close', (code) => {
        if (code === 0) {
          resolve(output)
        } else {
          reject(new Error(errorOutput || `Command failed with code ${code}`))
        }
      })
    })
  }

  /**
   * Report skill installation to the marketplace for usage analytics.
   *
   * This is a fire-and-forget telemetry call that increments the install count
   * for a skill in the marketplace. The request is made asynchronously and
   * failures are silently logged without affecting the installation flow.
   *
   * API: POST /api/skills/{owner}/{repo}/{skillName}/install
   * - No request body required
   * - Returns install metrics (total, weekly, monthly counts)
   * - Auto-indexes unknown skills from GitHub
   * - Used for popularity tracking and download statistics
   *
   * Note: This telemetry is sent automatically when installing skills from the
   * marketplace. No personally identifiable information is transmitted.
   *
   * @see https://www.val.town/x/kamalnrf/claude-plugins-registry/code/API.md
   * @param identifier - The marketplace skill identifier
   */
  private async reportSkillInstall(identifier: MarketplaceIdentifier): Promise<void> {
    if (identifier.kind !== 'skill') return
    const url = `${MARKETPLACE_API_BASE_URL}/api/skills/${identifier.owner}/${identifier.repository}/${identifier.name}/install`
    await net.fetch(url, { method: 'POST' })
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
      if (await directoryExists(packageDirPath)) {
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
   * List installed plugin package paths for Claude Code SDK (local plugins)
   */
  async listInstalledPluginPackagePaths(agentId: string): Promise<string[]> {
    logger.debug('Listing installed plugin package paths', { agentId })

    const agent = await this.getAgentOrThrow(agentId)
    const workdir = this.getWorkdirOrThrow(agent, agentId)
    await this.validateWorkdir(agent, workdir)

    const installedPlugins = await this.listInstalledFromCache(workdir)
    const packageNames = new Set<string>()

    for (const plugin of installedPlugins) {
      if (plugin.metadata.packageName) {
        packageNames.add(this.sanitizeFolderName(plugin.metadata.packageName))
      }
    }

    if (packageNames.size === 0) {
      return []
    }

    const pluginPaths: string[] = []

    for (const packageName of packageNames) {
      const pluginPath = path.join(workdir, '.claude', 'plugins', packageName)
      const manifestPath = path.join(pluginPath, '.claude-plugin', 'plugin.json')

      if (await fileExists(manifestPath)) {
        pluginPaths.push(pluginPath)
      } else {
        logger.warn('Skipping plugin without manifest', { pluginPath, manifestPath })
      }
    }

    logger.info('Listed installed plugin package paths', {
      agentId,
      count: pluginPaths.length
    })

    return pluginPaths
  }

  /**
   * Invalidate plugin cache.
   *
   * Note: This method is intentionally a no-op as the new architecture uses
   * file-based caching that doesn't require manual invalidation. The method
   * is kept for API compatibility with the IPC interface.
   *
   * @deprecated No longer needed - cache is automatically maintained
   */
  invalidateCache(): void {
    logger.info('Plugin cache invalidated (no-op)')
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
  async installFromZip(options: InstallFromZipOptions): Promise<InstallFromSourceResult> {
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
  async installFromDirectory(options: InstallFromDirectoryOptions): Promise<InstallFromSourceResult> {
    const { agentId, directoryPath } = options
    logger.info('Installing plugin package from directory', { agentId, directoryPath })

    const agent = await this.getAgentOrThrow(agentId)
    const workdir = this.getWorkdirOrThrow(agent, agentId)
    await this.validateWorkdir(agent, workdir)

    if (!(await directoryExists(directoryPath))) {
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
  ): Promise<InstallFromSourceResult> {
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
    logger.debug('Scanning plugin components', {
      pluginDestPath,
      manifest: {
        name: manifest.name,
        skills: manifest.skills,
        agents: manifest.agents,
        commands: manifest.commands
      }
    })
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
   * Maximum recursion depth for findPluginRoots to prevent infinite loops
   * from symlink cycles or deeply nested directories
   */
  private static readonly MAX_PLUGIN_ROOT_DEPTH = 10

  /**
   * Find all plugin root directories.
   * Supports: single plugin, single plugin with wrapper directory, multiple plugins, marketplace.
   * e.g., if ZIP extracts to: tempDir/plugin-name/.claude-plugin/plugin.json
   * this method returns: [tempDir/plugin-name]
   * e.g., if ZIP extracts to: tempDir/plugins/{plugin1, plugin2}/.claude-plugin/...
   * this method returns: [tempDir/plugins/plugin1, tempDir/plugins/plugin2]
   * e.g., if directory has .claude-plugin/marketplace.json, resolve plugin sources from it
   */
  private async findPluginRoots(extractedDir: string, depth = 0): Promise<string[]> {
    // Prevent infinite recursion from symlink cycles or deeply nested directories
    if (depth > PluginService.MAX_PLUGIN_ROOT_DEPTH) {
      logger.warn('Max recursion depth reached while finding plugin roots', {
        extractedDir,
        depth,
        maxDepth: PluginService.MAX_PLUGIN_ROOT_DEPTH
      })
      return []
    }

    // Case 0: Check for marketplace.json first
    const marketplace = await this.readMarketplaceManifest(extractedDir)
    if (marketplace) {
      logger.debug('Marketplace manifest found', {
        extractedDir,
        marketplaceName: marketplace.name,
        pluginCount: marketplace.plugins.length
      })
      return this.resolveMarketplacePluginRoots(extractedDir, marketplace)
    }

    // Case 1: Directory itself is a plugin root (has plugin.json)
    if (await this.hasPluginJson(extractedDir)) {
      logger.debug('Plugin root found at extracted directory', { extractedDir })
      return [extractedDir]
    }

    // Case 2: Scan subdirectories for plugins
    const entries = await fs.promises.readdir(extractedDir, { withFileTypes: true })
    const directories = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))

    const roots: string[] = []
    for (const dir of directories) {
      const subDir = path.join(extractedDir, dir.name)
      if (await this.hasPluginJson(subDir)) {
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
      return this.findPluginRoots(subDir, depth + 1)
    }

    // No plugins found
    logger.warn('Could not find any plugin roots with .claude-plugin directory', {
      extractedDir,
      entries: entries.map((e) => e.name)
    })
    return []
  }

  /**
   * Resolve plugin roots from marketplace manifest
   */
  private async resolveMarketplacePluginRoots(
    marketplaceDir: string,
    marketplace: MarketplaceManifest
  ): Promise<string[]> {
    const pluginRoot = marketplace.metadata?.pluginRoot
    const roots: string[] = []

    for (const entry of marketplace.plugins) {
      try {
        const sourcePath = this.resolveMarketplacePluginSource(marketplaceDir, entry, pluginRoot)

        // For relative paths, check if directory exists and has .claude-plugin
        if (await directoryExists(sourcePath)) {
          if (await this.hasPluginJson(sourcePath)) {
            roots.push(sourcePath)
            logger.debug('Resolved marketplace plugin', { name: entry.name, sourcePath })
          } else {
            // Plugin defined inline in marketplace (strict: false)
            // For now, skip these - they need special handling
            logger.debug('Marketplace plugin without plugin.json (inline definition)', {
              name: entry.name,
              sourcePath,
              strict: entry.strict
            })
          }
        } else {
          logger.warn('Marketplace plugin source not found', { name: entry.name, sourcePath })
        }
      } catch (error) {
        logger.warn('Failed to resolve marketplace plugin source', {
          name: entry.name,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return roots
  }

  /**
   * Check if directory contains .claude-plugin/plugin.json
   */
  private async hasPluginJson(dir: string): Promise<boolean> {
    return fileExists(path.join(dir, '.claude-plugin', 'plugin.json'))
  }

  /**
   * Read and validate marketplace manifest from .claude-plugin/marketplace.json
   */
  private async readMarketplaceManifest(dir: string): Promise<MarketplaceManifest | null> {
    const manifestPath = path.join(dir, '.claude-plugin', 'marketplace.json')

    try {
      await fs.promises.access(manifestPath, fs.constants.R_OK)
    } catch {
      return null
    }

    try {
      const content = await fs.promises.readFile(manifestPath, 'utf-8')
      const json = JSON.parse(content)
      return MarketplaceManifestSchema.parse(json)
    } catch (error) {
      logger.warn('Failed to parse marketplace.json', {
        path: manifestPath,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  /**
   * Resolve plugin source path from marketplace entry
   * Supports: relative paths, github: prefix, git: prefix
   */
  private resolveMarketplacePluginSource(
    marketplaceDir: string,
    entry: MarketplacePluginEntry,
    pluginRoot?: string
  ): string {
    const source = entry.source
    if (typeof source === 'string') {
      // Relative path (e.g., "./plugins/my-plugin" or "my-plugin")
      if (source.startsWith('./') || source.startsWith('../') || !source.includes(':')) {
        const basePath = pluginRoot ? path.join(marketplaceDir, pluginRoot) : marketplaceDir
        return path.resolve(basePath, source)
      }
      // Already a full path or URL
      return source
    }
    // Object source (github, npm, git)
    if (source.github) return `github:${source.github}`
    if (source.git) return `git:${source.git}`
    if (source.npm) return `npm:${source.npm}`
    throw new Error(`Invalid plugin source: ${JSON.stringify(source)}`)
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
    if (await directoryExists(defaultPath)) {
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
          if (await pathExists(fullPath)) {
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
            // Skills are directories with SKILL.md or skill.md
            const skillMdPath = await findSkillMdPath(entryPath)
            if (skillMdPath) {
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
   * Read plugin content from source (resources directory).
   *
   * Note: This method is intentionally disabled. Reading preset plugin content
   * from the bundled resources directory is no longer supported in the new
   * plugin architecture. Plugins are now installed and read from the agent's
   * .claude directory. The method is kept for API compatibility with the IPC
   * interface and throws an error to indicate the feature is not available.
   *
   * @deprecated Use installed plugin files directly instead
   * @throws Always throws INVALID_METADATA error
   */
  async readContent(sourcePath: string): Promise<string> {
    logger.info('Reading plugin content', { sourcePath })
    throw {
      type: 'INVALID_METADATA',
      reason: 'Reading local preset plugin content is disabled',
      path: sourcePath
    } as PluginError
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
