import { loggerService } from '@logger'
import { directoryExists, fileExists, isPathInside, pathExists, writeWithLock } from '@main/utils/file'
import {
  findAllSkillDirectories,
  findSkillMdPath,
  parsePluginMetadata,
  parseSkillMetadata
} from '@main/utils/markdownParser'
import type { CachedPluginsData, InstalledPlugin, PluginManifest, PluginType } from '@types'
import { CachedPluginsDataSchema, PluginManifestSchema } from '@types'
import * as fs from 'fs'
import * as path from 'path'

const logger = loggerService.withContext('PluginCacheStore')

interface PluginCacheStoreDeps {
  allowedExtensions: string[]
  getPluginDirectoryName: (type: PluginType) => 'agents' | 'commands' | 'skills'
  getClaudeBasePath: (workdir: string) => string
  getClaudePluginDirectory: (workdir: string, type: PluginType) => string
}

export class PluginCacheStore {
  constructor(private readonly deps: PluginCacheStoreDeps) {}

  async listInstalled(workdir: string): Promise<InstalledPlugin[]> {
    const claudePath = this.deps.getClaudeBasePath(workdir)
    const cacheData = await this.readCacheFile(claudePath)

    if (cacheData) {
      logger.debug(`Loaded ${cacheData.plugins.length} plugins from cache`, { workdir })
      return cacheData.plugins
    }

    logger.info('Cache read failed, rebuilding from filesystem', { workdir })
    return await this.rebuild(workdir)
  }

  /**
   * Ensure cache data exists, rebuilding from filesystem if necessary
   */
  private async ensureCacheData(workdir: string): Promise<{ cacheData: CachedPluginsData; claudePath: string }> {
    const claudePath = this.deps.getClaudeBasePath(workdir)
    const existingCache = await this.readCacheFile(claudePath)

    if (existingCache) {
      return { cacheData: existingCache, claudePath }
    }

    const plugins = await this.rebuild(workdir)
    return {
      cacheData: { version: 1, lastUpdated: Date.now(), plugins },
      claudePath
    }
  }

  async upsert(workdir: string, plugin: InstalledPlugin): Promise<void> {
    const { cacheData, claudePath } = await this.ensureCacheData(workdir)
    const plugins = cacheData.plugins

    const updatedPlugin: InstalledPlugin = {
      ...plugin,
      metadata: {
        ...plugin.metadata,
        installedAt: plugin.metadata.installedAt ?? Date.now()
      }
    }

    const index = plugins.findIndex((p) => p.filename === updatedPlugin.filename && p.type === updatedPlugin.type)
    if (index >= 0) {
      plugins[index] = updatedPlugin
    } else {
      plugins.push(updatedPlugin)
    }

    const data: CachedPluginsData = {
      version: cacheData.version,
      lastUpdated: Date.now(),
      plugins
    }

    await fs.promises.mkdir(claudePath, { recursive: true })
    await this.writeCacheFile(claudePath, data)
  }

  async remove(workdir: string, filename: string, type: PluginType): Promise<void> {
    const { cacheData, claudePath } = await this.ensureCacheData(workdir)
    const filtered = cacheData.plugins.filter((p) => !(p.filename === filename && p.type === type))

    const data: CachedPluginsData = {
      version: cacheData.version,
      lastUpdated: Date.now(),
      plugins: filtered
    }

    await fs.promises.mkdir(claudePath, { recursive: true })
    await this.writeCacheFile(claudePath, data)
  }

  async rebuild(workdir: string): Promise<InstalledPlugin[]> {
    logger.info('Rebuilding plugin cache from filesystem', { workdir })

    const claudePath = this.deps.getClaudeBasePath(workdir)

    try {
      await fs.promises.access(claudePath, fs.constants.R_OK)
    } catch {
      logger.warn('.claude directory not found, returning empty plugin list', { claudePath })
      return []
    }

    const plugins: InstalledPlugin[] = []

    await Promise.all([
      this.collectFilePlugins(workdir, 'agent', plugins),
      this.collectFilePlugins(workdir, 'command', plugins),
      this.collectSkillPlugins(workdir, plugins),
      this.collectPackagePlugins(workdir, plugins)
    ])

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

  private async collectFilePlugins(
    workdir: string,
    type: Exclude<PluginType, 'skill'>,
    plugins: InstalledPlugin[]
  ): Promise<void> {
    const directory = this.deps.getClaudePluginDirectory(workdir, type)

    try {
      await fs.promises.access(directory, fs.constants.R_OK)
    } catch {
      logger.debug(`${type} directory not found or not accessible`, { directory })
      return
    }

    const files = await fs.promises.readdir(directory, { withFileTypes: true })

    for (const file of files) {
      if (!file.isFile()) {
        continue
      }

      const ext = path.extname(file.name).toLowerCase()
      if (!this.deps.allowedExtensions.includes(ext)) {
        continue
      }

      try {
        const filePath = path.join(directory, file.name)
        const sourcePath = path.join(this.deps.getPluginDirectoryName(type), file.name)
        const metadata = await parsePluginMetadata(filePath, sourcePath, this.deps.getPluginDirectoryName(type), type)
        plugins.push({ filename: file.name, type, metadata })
      } catch (error) {
        logger.warn(`Failed to parse ${type} plugin: ${file.name}`, {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  private async collectSkillPlugins(workdir: string, plugins: InstalledPlugin[]): Promise<void> {
    const skillsPath = this.deps.getClaudePluginDirectory(workdir, 'skill')
    const claudePath = this.deps.getClaudeBasePath(workdir)

    try {
      await fs.promises.access(skillsPath, fs.constants.R_OK)
    } catch {
      logger.debug('Skills directory not found or not accessible', { skillsPath })
      return
    }

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
  }

  private async collectPackagePlugins(workdir: string, plugins: InstalledPlugin[]): Promise<void> {
    const claudePath = this.deps.getClaudeBasePath(workdir)
    const pluginsPath = path.join(claudePath, 'plugins')

    if (!(await directoryExists(pluginsPath))) {
      return
    }

    const entries = await fs.promises.readdir(pluginsPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue
      }

      const pluginDir = path.join(pluginsPath, entry.name)
      const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json')

      if (!(await fileExists(manifestPath))) {
        logger.debug('Plugin manifest not found while rebuilding cache', { pluginDir })
        continue
      }

      let manifest: PluginManifest
      try {
        const content = await fs.promises.readFile(manifestPath, 'utf-8')
        const json = JSON.parse(content)
        manifest = PluginManifestSchema.parse(json)
      } catch (error) {
        logger.warn('Failed to parse plugin manifest while rebuilding cache', {
          manifestPath,
          error: error instanceof Error ? error.message : String(error)
        })
        continue
      }

      const packageInfo = { packageName: manifest.name, packageVersion: manifest.version }

      await Promise.all([
        this.collectPackageComponentPaths(pluginDir, 'skills', manifest.skills, 'skill', plugins, packageInfo),
        this.collectPackageComponentPaths(pluginDir, 'agents', manifest.agents, 'agent', plugins, packageInfo),
        this.collectPackageComponentPaths(pluginDir, 'commands', manifest.commands, 'command', plugins, packageInfo)
      ])
    }
  }

  private async collectPackageComponentPaths(
    pluginDir: string,
    defaultSubDir: string,
    customPaths: string | string[] | undefined,
    type: PluginType,
    plugins: InstalledPlugin[],
    packageInfo: { packageName: string; packageVersion?: string }
  ): Promise<void> {
    const scannedPaths = new Set<string>()

    const defaultPath = path.join(pluginDir, defaultSubDir)
    if (await directoryExists(defaultPath)) {
      scannedPaths.add(defaultPath)
      await this.scanAndCollectComponents(defaultPath, type, plugins, packageInfo)
    }

    if (customPaths) {
      const pathArray = Array.isArray(customPaths) ? customPaths : [customPaths]
      for (const customPath of pathArray) {
        const fullPath = path.resolve(pluginDir, customPath)
        if (!isPathInside(fullPath, pluginDir)) {
          logger.warn('Skipping custom path with path traversal while rebuilding cache', {
            customPath,
            pluginDir
          })
          continue
        }

        if (!scannedPaths.has(fullPath) && (await pathExists(fullPath))) {
          scannedPaths.add(fullPath)
          await this.scanAndCollectComponents(fullPath, type, plugins, packageInfo)
        }
      }
    }
  }

  private async scanAndCollectComponents(
    dirPath: string,
    type: PluginType,
    plugins: InstalledPlugin[],
    packageInfo: { packageName: string; packageVersion?: string }
  ): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name)

        try {
          if (type === 'skill' && entry.isDirectory()) {
            const skillMdPath = await findSkillMdPath(entryPath)
            if (skillMdPath) {
              const metadata = await parseSkillMetadata(entryPath, entry.name, 'plugins')
              plugins.push({
                filename: metadata.filename,
                type: 'skill',
                metadata: {
                  ...metadata,
                  packageName: packageInfo.packageName,
                  packageVersion: packageInfo.packageVersion
                }
              })
            }
          } else if ((type === 'agent' || type === 'command') && entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase()
            if (!this.deps.allowedExtensions.includes(ext)) {
              continue
            }
            const metadata = await parsePluginMetadata(entryPath, entry.name, 'plugins', type)
            plugins.push({
              filename: metadata.filename,
              type,
              metadata: {
                ...metadata,
                packageName: packageInfo.packageName,
                packageVersion: packageInfo.packageVersion
              }
            })
          }
        } catch (error) {
          logger.warn('Failed to parse plugin component while rebuilding cache', {
            path: entryPath,
            type,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      logger.warn('Failed to scan plugin package directory while rebuilding cache', {
        dirPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

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

  private async writeCacheFile(claudePath: string, data: CachedPluginsData): Promise<void> {
    const cachePath = path.join(claudePath, 'plugins.json')
    const content = JSON.stringify(data, null, 2)
    await writeWithLock(cachePath, content, { atomic: true, encoding: 'utf-8' })
  }
}
