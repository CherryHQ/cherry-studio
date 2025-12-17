import { loggerService } from '@logger'
import { findAllSkillDirectories, parsePluginMetadata, parseSkillMetadata } from '@main/utils/markdownParser'
import type { CachedPluginsData, InstalledPlugin, PluginError, PluginMetadata, PluginType } from '@types'
import { CachedPluginsDataSchema } from '@types'
import * as fs from 'fs'
import * as path from 'path'

const logger = loggerService.withContext('PluginCacheStore')

interface PluginCacheStoreDeps {
  allowedExtensions: string[]
  getPluginDirectoryName: (type: PluginType) => 'agents' | 'commands' | 'skills'
  getClaudeBasePath: (workdir: string) => string
  getClaudePluginDirectory: (workdir: string, type: PluginType) => string
  getPluginsBasePath: () => string
}

export class PluginCacheStore {
  constructor(private readonly deps: PluginCacheStoreDeps) {}

  async listAvailableFilePlugins(type: 'agent' | 'command'): Promise<PluginMetadata[]> {
    const basePath = this.deps.getPluginsBasePath()
    const directory = path.join(basePath, this.deps.getPluginDirectoryName(type))

    try {
      await fs.promises.access(directory, fs.constants.R_OK)
    } catch (error) {
      logger.warn(`Plugin directory not accessible: ${directory}`, {
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }

    const plugins: PluginMetadata[] = []
    const categories = await fs.promises.readdir(directory, { withFileTypes: true })

    for (const categoryEntry of categories) {
      if (!categoryEntry.isDirectory()) {
        continue
      }

      const category = categoryEntry.name
      const categoryPath = path.join(directory, category)
      const files = await fs.promises.readdir(categoryPath, { withFileTypes: true })

      for (const file of files) {
        if (!file.isFile()) {
          continue
        }

        const ext = path.extname(file.name).toLowerCase()
        if (!this.deps.allowedExtensions.includes(ext)) {
          continue
        }

        try {
          const filePath = path.join(categoryPath, file.name)
          const sourcePath = path.join(this.deps.getPluginDirectoryName(type), category, file.name)
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

  async listAvailableSkills(): Promise<PluginMetadata[]> {
    const basePath = this.deps.getPluginsBasePath()
    const skillsPath = path.join(basePath, this.deps.getPluginDirectoryName('skill'))
    const skills: PluginMetadata[] = []

    try {
      await fs.promises.access(skillsPath)
    } catch {
      logger.warn('Skills directory not found', { skillsPath })
      return []
    }

    try {
      const skillDirectories = await findAllSkillDirectories(skillsPath, basePath)
      logger.info(`Found ${skillDirectories.length} skill directories`, { skillsPath })

      for (const { folderPath, sourcePath } of skillDirectories) {
        try {
          const metadata = await parseSkillMetadata(folderPath, sourcePath, 'skills')
          skills.push(metadata)
        } catch (error) {
          logger.warn(`Failed to parse skill folder: ${sourcePath}`, {
            folderPath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      logger.error('Failed to scan skill directory', {
        skillsPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return skills
  }

  async readSourceContent(sourcePath: string): Promise<string> {
    const absolutePath = this.resolveSourcePath(sourcePath)

    try {
      await fs.promises.access(absolutePath, fs.constants.R_OK)
    } catch {
      throw {
        type: 'FILE_NOT_FOUND',
        path: sourcePath
      } as PluginError
    }

    try {
      return await fs.promises.readFile(absolutePath, 'utf-8')
    } catch (error) {
      throw {
        type: 'READ_FAILED',
        path: sourcePath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }
  }

  resolveSourcePath(sourcePath: string): string {
    const normalized = path.normalize(sourcePath)

    if (normalized.includes('..')) {
      throw {
        type: 'PATH_TRAVERSAL',
        message: 'Path traversal detected',
        path: sourcePath
      } as PluginError
    }

    const basePath = this.deps.getPluginsBasePath()
    const absolutePath = path.join(basePath, normalized)
    const resolvedPath = path.resolve(absolutePath)

    if (!resolvedPath.startsWith(path.resolve(basePath))) {
      throw {
        type: 'PATH_TRAVERSAL',
        message: 'Path outside plugins directory',
        path: sourcePath
      } as PluginError
    }

    return resolvedPath
  }

  async ensureSkillSourceDirectory(sourceAbsolutePath: string, sourcePath: string): Promise<void> {
    let stats: fs.Stats
    try {
      stats = await fs.promises.stat(sourceAbsolutePath)
    } catch {
      throw {
        type: 'FILE_NOT_FOUND',
        path: sourceAbsolutePath
      } as PluginError
    }

    if (!stats.isDirectory()) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Skill source is not a directory',
        path: sourcePath
      } as PluginError
    }
  }

  async validatePluginFile(filePath: string, maxFileSize: number): Promise<void> {
    let stats: fs.Stats
    try {
      stats = await fs.promises.stat(filePath)
    } catch {
      throw {
        type: 'FILE_NOT_FOUND',
        path: filePath
      } as PluginError
    }

    if (stats.size > maxFileSize) {
      throw {
        type: 'FILE_TOO_LARGE',
        size: stats.size,
        max: maxFileSize
      } as PluginError
    }

    const ext = path.extname(filePath).toLowerCase()
    if (!this.deps.allowedExtensions.includes(ext)) {
      throw {
        type: 'INVALID_FILE_TYPE',
        extension: ext
      } as PluginError
    }

    try {
      const basePath = this.deps.getPluginsBasePath()
      const relativeSourcePath = path.relative(basePath, filePath)
      const segments = relativeSourcePath.split(path.sep)
      const rootDir = segments[0]
      const agentDir = this.deps.getPluginDirectoryName('agent')
      const type: 'agent' | 'command' = rootDir === agentDir ? 'agent' : 'command'
      const category = path.basename(path.dirname(filePath))

      await parsePluginMetadata(filePath, relativeSourcePath, category, type)
    } catch (error) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Failed to parse frontmatter',
        path: filePath
      } as PluginError
    }
  }

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

  async upsert(workdir: string, plugin: InstalledPlugin): Promise<void> {
    const claudePath = this.deps.getClaudeBasePath(workdir)
    let cacheData = await this.readCacheFile(claudePath)
    let plugins = cacheData?.plugins

    if (!plugins) {
      plugins = await this.rebuild(workdir)
      cacheData = {
        version: 1,
        lastUpdated: Date.now(),
        plugins
      }
    }

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
      version: cacheData?.version ?? 1,
      lastUpdated: Date.now(),
      plugins
    }

    await fs.promises.mkdir(claudePath, { recursive: true })
    await this.writeCacheFile(claudePath, data)
  }

  async remove(workdir: string, filename: string, type: PluginType): Promise<void> {
    const claudePath = this.deps.getClaudeBasePath(workdir)
    let cacheData = await this.readCacheFile(claudePath)
    let plugins = cacheData?.plugins

    if (!plugins) {
      plugins = await this.rebuild(workdir)
      cacheData = {
        version: 1,
        lastUpdated: Date.now(),
        plugins
      }
    }

    const filtered = plugins.filter((p) => !(p.filename === filename && p.type === type))

    const data: CachedPluginsData = {
      version: cacheData?.version ?? 1,
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
      this.collectSkillPlugins(workdir, plugins)
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
    const tempPath = `${cachePath}.tmp`

    const content = JSON.stringify(data, null, 2)
    await fs.promises.writeFile(tempPath, content, 'utf-8')
    await fs.promises.rename(tempPath, cachePath)
  }
}
