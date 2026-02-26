import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { isPathInside } from '@main/utils/file'
import { copyDirectoryRecursive, deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { parseSkillMetadata } from '@main/utils/markdownParser'
import type { InstalledSkillEntry, LibrarySkillEntry, PluginError } from '@types'
import { app } from 'electron'

const logger = loggerService.withContext('SkillsService')

type SkillsServiceConfig = {
  userDataPath?: string
  /** 单个 SKILL.md 最大允许读取大小（字节），避免 UI 卡顿 */
  maxSkillMdBytes?: number
  /** 扫描库目录最大深度（root=0） */
  maxLibraryScanDepth?: number
}

const SKILL_MD_VARIANTS = ['SKILL.md', 'skill.md'] as const

const isSafeFolderNameSegment = (value: string): boolean => {
  if (!value) return false
  if (value === '.' || value === '..') return false
  if (value.includes('/') || value.includes('\\')) return false
  return true
}

const normalizeInstalledFolderName = (rawFolderName: string): string => {
  const trimmed = rawFolderName.trim()
  if (/^[a-z0-9-]{1,80}$/.test(trimmed)) {
    return trimmed
  }

  // 尝试将常见“可读名字”转为跨平台安全的 kebab-case
  const slug = trimmed
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  if (slug) return slug

  // 兜底：用哈希保证稳定性
  const hash = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 8)
  return `skill-${hash}`
}

const stripFrontmatter = (content: string): string => {
  const lines = content.split(/\r?\n/)
  if (lines.length === 0) return ''

  if (lines[0].trim() !== '---') {
    return content.trim()
  }

  let endIndex = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIndex = i
      break
    }
  }

  // 不完整 frontmatter：按原文返回
  if (endIndex === -1) return content.trim()

  return lines
    .slice(endIndex + 1)
    .join('\n')
    .trim()
}

async function findSkillMdInFolder(folderPath: string): Promise<string | null> {
  for (const filename of SKILL_MD_VARIANTS) {
    const filePath = path.join(folderPath, filename)
    try {
      const stat = await fs.promises.lstat(filePath)
      if (stat.isFile()) return filePath
    } catch {
      // ignore
    }
  }
  return null
}

async function scanSkillFoldersNoSymlink(
  rootDir: string,
  maxDepth: number
): Promise<Array<{ folderName: string; absolutePath: string }>> {
  const results: Array<{ folderName: string; absolutePath: string }> = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }]
  const seen = new Set<string>()

  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break

    const resolvedDir = path.resolve(item.dir)
    if (seen.has(resolvedDir)) continue
    seen.add(resolvedDir)

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(resolvedDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.isSymbolicLink()) continue

      const subDir = path.join(resolvedDir, entry.name)

      // 识别技能目录：包含 SKILL.md / skill.md
      const skillMd = await findSkillMdInFolder(subDir)
      if (skillMd) {
        results.push({ folderName: entry.name, absolutePath: subDir })
        continue
      }

      // 没有 SKILL.md 才继续递归，避免重复扫描
      if (item.depth < maxDepth) {
        queue.push({ dir: subDir, depth: item.depth + 1 })
      }
    }
  }

  return results
}

export class SkillsService {
  private static instance: SkillsService | null = null

  private readonly userDataPath: string
  private readonly skillsBaseDir: string
  private readonly maxSkillMdBytes: number
  private readonly maxLibraryScanDepth: number

  private constructor(config?: SkillsServiceConfig) {
    this.userDataPath = config?.userDataPath ?? app.getPath('userData')
    this.skillsBaseDir = path.join(this.userDataPath, 'skills')
    this.maxSkillMdBytes = config?.maxSkillMdBytes ?? 1024 * 1024
    this.maxLibraryScanDepth = config?.maxLibraryScanDepth ?? 2
  }

  /**
   * 创建一个独立实例（不影响单例），用于单元测试或隔离场景。
   */
  static create(config?: SkillsServiceConfig): SkillsService {
    return new SkillsService(config)
  }

  static getInstance(config?: SkillsServiceConfig): SkillsService {
    if (!SkillsService.instance) {
      SkillsService.instance = new SkillsService(config)
    }
    return SkillsService.instance
  }

  private async ensureSkillsBaseDir(): Promise<void> {
    await fs.promises.mkdir(this.skillsBaseDir, { recursive: true })
  }

  async listInstalled(): Promise<InstalledSkillEntry[]> {
    const base = this.skillsBaseDir
    try {
      await fs.promises.access(base, fs.constants.R_OK)
    } catch {
      return []
    }

    const folders = await scanSkillFoldersNoSymlink(base, 0)
    const entries: InstalledSkillEntry[] = []

    for (const folder of folders) {
      try {
        const metadata = await parseSkillMetadata(folder.absolutePath, `skills/${folder.folderName}`, 'skills')
        entries.push({
          folderName: folder.folderName,
          absolutePath: folder.absolutePath,
          metadata
        })
      } catch (error) {
        logger.warn('解析已安装技能失败，已跳过', {
          folder: folder.absolutePath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    entries.sort((a, b) => (a.metadata.name || a.folderName).localeCompare(b.metadata.name || b.folderName))
    return entries
  }

  async listLibrary(libraryPath: string, options?: { maxDepth?: number }): Promise<LibrarySkillEntry[]> {
    const root = path.resolve(libraryPath)

    try {
      const stat = await fs.promises.lstat(root)
      if (!stat.isDirectory()) {
        throw { type: 'INVALID_METADATA', reason: 'Library path is not a directory', path: root } as PluginError
      }
      if (stat.isSymbolicLink()) {
        throw { type: 'INVALID_METADATA', reason: 'Library path must not be a symlink', path: root } as PluginError
      }
      await fs.promises.access(root, fs.constants.R_OK)
    } catch (error) {
      if (error && typeof error === 'object' && 'type' in error) throw error
      throw { type: 'PERMISSION_DENIED', path: root } as PluginError
    }

    const maxDepth = options?.maxDepth ?? this.maxLibraryScanDepth
    const folders = await scanSkillFoldersNoSymlink(root, maxDepth)
    const entries: LibrarySkillEntry[] = []

    for (const folder of folders) {
      try {
        const metadata = await parseSkillMetadata(folder.absolutePath, `library/${folder.folderName}`, 'skills')
        entries.push({
          folderName: folder.folderName,
          absolutePath: folder.absolutePath,
          metadata
        })
      } catch (error) {
        logger.warn('解析技能库条目失败，已跳过', {
          folder: folder.absolutePath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    entries.sort((a, b) => (a.metadata.name || a.folderName).localeCompare(b.metadata.name || b.folderName))
    return entries
  }

  async importFromLibrary(params: { libraryPath: string; skillFolderPath: string }): Promise<InstalledSkillEntry> {
    const root = path.resolve(params.libraryPath)
    const source = path.resolve(params.skillFolderPath)

    if (!isPathInside(source, root)) {
      throw {
        type: 'INVALID_METADATA',
        reason: 'Skill folder must be inside library path',
        path: source
      } as PluginError
    }

    let sourceStat: fs.Stats
    try {
      sourceStat = await fs.promises.lstat(source)
    } catch {
      throw { type: 'FILE_NOT_FOUND', path: source } as PluginError
    }
    if (!sourceStat.isDirectory()) {
      throw { type: 'INVALID_METADATA', reason: 'Skill folder is not a directory', path: source } as PluginError
    }
    if (sourceStat.isSymbolicLink()) {
      throw { type: 'INVALID_METADATA', reason: 'Skill folder must not be a symlink', path: source } as PluginError
    }

    // 校验存在 SKILL.md
    const skillMd = await findSkillMdInFolder(source)
    if (!skillMd) {
      throw { type: 'SKILL_MD_NOT_FOUND', path: source } as PluginError
    }

    await this.ensureSkillsBaseDir()

    const sourceFolderName = path.basename(source)
    const destFolderName = normalizeInstalledFolderName(sourceFolderName)
    if (!isSafeFolderNameSegment(destFolderName)) {
      throw { type: 'INVALID_METADATA', reason: 'Invalid destination folder name', path: destFolderName } as PluginError
    }

    const destPath = path.join(this.skillsBaseDir, destFolderName)

    // 覆盖更新：先删后拷，删除范围严格限制在 skillsBaseDir 下
    try {
      await fs.promises.access(destPath, fs.constants.F_OK)
      await deleteDirectoryRecursive(destPath, { allowedBasePath: this.skillsBaseDir })
    } catch {
      // ignore ENOENT
    }

    try {
      await copyDirectoryRecursive(source, destPath)
    } catch (error) {
      logger.error('导入技能复制失败', { source, destPath, error })
      throw {
        type: 'WRITE_FAILED',
        path: destPath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }

    // 再次确认导入后的目标目录存在 SKILL.md（避免目录被复制但缺少关键文件）
    const destSkillMd = await findSkillMdInFolder(destPath)
    if (!destSkillMd) {
      await deleteDirectoryRecursive(destPath, { allowedBasePath: this.skillsBaseDir })
      throw { type: 'SKILL_MD_NOT_FOUND', path: destPath } as PluginError
    }

    const metadata = await parseSkillMetadata(destPath, `skills/${destFolderName}`, 'skills')
    return {
      folderName: destFolderName,
      absolutePath: destPath,
      metadata
    }
  }

  async readBody(folderName: string): Promise<string> {
    if (!isSafeFolderNameSegment(folderName)) {
      throw { type: 'INVALID_METADATA', reason: 'Invalid skill folder name', path: folderName } as PluginError
    }

    const folderPath = path.join(this.skillsBaseDir, folderName)
    const skillMdPath = await findSkillMdInFolder(folderPath)
    if (!skillMdPath) {
      throw { type: 'SKILL_MD_NOT_FOUND', path: folderPath } as PluginError
    }

    let stat: fs.Stats
    try {
      stat = await fs.promises.lstat(skillMdPath)
    } catch {
      throw { type: 'FILE_NOT_FOUND', path: skillMdPath } as PluginError
    }

    if (!stat.isFile()) {
      throw { type: 'INVALID_METADATA', reason: 'SKILL.md is not a file', path: skillMdPath } as PluginError
    }
    if (stat.size > this.maxSkillMdBytes) {
      throw { type: 'FILE_TOO_LARGE', size: stat.size, max: this.maxSkillMdBytes } as PluginError
    }

    let content: string
    try {
      content = await fs.promises.readFile(skillMdPath, 'utf-8')
    } catch (error) {
      throw {
        type: 'READ_FAILED',
        path: skillMdPath,
        reason: error instanceof Error ? error.message : String(error)
      } as PluginError
    }

    return stripFrontmatter(content)
  }
}

export const skillsService = SkillsService.getInstance()
