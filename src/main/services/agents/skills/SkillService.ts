import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { getDataPath } from '@main/utils'
import { directoryExists } from '@main/utils/file'
import { deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { executeCommand, findExecutableInEnv } from '@main/utils/process'
import type {
  InstalledSkill,
  SkillFileNode,
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillToggleOptions
} from '@types'
import { app, net } from 'electron'
import StreamZip from 'node-stream-zip'

import { SkillInstaller } from './SkillInstaller'
import { SkillRepository } from './SkillRepository'

const logger = loggerService.withContext('SkillService')

// API base URLs for the 3 search sources
const CLAUDE_PLUGINS_API = 'https://api.claude-plugins.dev'

// ZIP extraction limits
const MAX_EXTRACTED_SIZE = 100 * 1024 * 1024 // 100MB
const MAX_FILES_COUNT = 1000
const MAX_FOLDER_NAME_LENGTH = 80

/**
 * Global skill management service.
 *
 * Skills are stored in {userData}/global-skills/{folderName}/ (inert storage).
 * When enabled, a symlink is created at {userData}/.claude/skills/{folderName}/
 * pointing to the global storage, making the skill discoverable by Claude Code.
 *
 * Metadata is tracked in the `skills` DB table.
 */
export class SkillService {
  private static instance: SkillService | null = null

  private readonly repository: SkillRepository
  private readonly installer: SkillInstaller

  private constructor() {
    this.repository = SkillRepository.getInstance()
    this.installer = new SkillInstaller()
    logger.info('SkillService initialized')
  }

  static getInstance(): SkillService {
    if (!SkillService.instance) {
      SkillService.instance = new SkillService()
    }
    return SkillService.instance
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  async list(): Promise<InstalledSkill[]> {
    return this.repository.list()
  }

  async toggle(options: SkillToggleOptions): Promise<InstalledSkill | null> {
    const skill = await this.repository.getById(options.skillId)
    if (!skill) return null

    // Update DB
    const updated = await this.repository.toggleEnabled(options.skillId, options.isEnabled)

    // Create or remove symlink
    if (options.isEnabled) {
      await this.linkSkill(skill.folderName)
    } else {
      await this.unlinkSkill(skill.folderName)
    }

    return updated
  }

  async readFile(skillId: string, filename: string): Promise<string | null> {
    const skill = await this.repository.getById(skillId)
    if (!skill) return null

    const skillRoot = this.getSkillStoragePath(skill.folderName)
    const filePath = path.resolve(skillRoot, filename)

    // Prevent path traversal
    if (!filePath.startsWith(skillRoot + path.sep) && filePath !== skillRoot) return null

    try {
      return await fs.promises.readFile(filePath, 'utf-8')
    } catch {
      return null
    }
  }

  async listFiles(skillId: string): Promise<SkillFileNode[]> {
    const skill = await this.repository.getById(skillId)
    if (!skill) return []

    const skillRoot = this.getSkillStoragePath(skill.folderName)
    try {
      return await this.buildFileTree(skillRoot, skillRoot)
    } catch {
      return []
    }
  }

  async uninstallByFolderName(folderName: string): Promise<void> {
    const skill = await this.repository.getByFolderName(folderName)
    if (!skill) {
      throw new Error(`Skill not found by folder name: ${folderName}`)
    }
    await this.uninstall(skill.id)
  }

  async uninstall(skillId: string): Promise<void> {
    const skill = await this.repository.getById(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    // Remove symlink first
    await this.unlinkSkill(skill.folderName)

    // Remove from global storage
    const skillPath = this.getSkillStoragePath(skill.folderName)
    await this.installer.uninstall(skillPath)
    await this.repository.delete(skillId)
    logger.info('Skill uninstalled', { skillId, folderName: skill.folderName })
  }

  /**
   * Install from a marketplace installSource handle.
   * Format: "claude-plugins:{owner}/{repo}/{skillName}" or "skills.sh:{owner}/{repo}" or "clawhub:{slug}"
   */
  async install(options: SkillInstallOptions): Promise<InstalledSkill> {
    const { installSource } = options
    const [source, ...rest] = installSource.split(':')
    const identifier = rest.join(':')

    switch (source) {
      case 'claude-plugins':
        return this.installFromClaudePlugins(identifier)
      case 'skills.sh':
        return this.installFromSkillsSh(identifier)
      case 'clawhub':
        return this.installFromClawhub(identifier)
      default:
        throw new Error(`Unknown install source: ${source}`)
    }
  }

  async installFromZip(options: SkillInstallFromZipOptions): Promise<InstalledSkill> {
    const { zipFilePath } = options
    logger.info('Installing skill from ZIP', { zipFilePath })

    await this.validateZipFile(zipFilePath)
    const tempDir = await this.createTempDir('zip-install')

    try {
      await this.extractZip(zipFilePath, tempDir)
      const skillDir = await this.locateSkillDir(tempDir)
      return await this.installSkillDir(skillDir, 'zip', null)
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  async installFromDirectory(options: SkillInstallFromDirectoryOptions): Promise<InstalledSkill> {
    const { directoryPath } = options
    logger.info('Installing skill from directory', { directoryPath })

    if (!(await directoryExists(directoryPath))) {
      throw new Error(`Directory not found: ${directoryPath}`)
    }

    return this.installSkillDir(directoryPath, 'local', null)
  }

  /**
   * List local skills from an agent workdir's .claude/skills/ directory.
   */
  async listLocal(workdir: string): Promise<Array<{ name: string; description?: string; filename: string }>> {
    const results: Array<{ name: string; description?: string; filename: string }> = []
    const skillsDir = path.join(workdir, '.claude', 'skills')

    try {
      const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const skillPath = path.join(skillsDir, entry.name)
          const metadata = await parseSkillMetadata(skillPath, entry.name, 'skills')
          results.push({ name: metadata.name, description: metadata.description, filename: entry.name })
        } catch {
          // No SKILL.md or parse error, skip
        }
      }
    } catch {
      // .claude/skills/ doesn't exist
    }

    return results
  }

  // ===========================================================================
  // Symlink management
  // ===========================================================================

  /**
   * Create a symlink from .claude/skills/{folderName} → global-skills/{folderName}
   */
  async linkSkill(folderName: string): Promise<void> {
    const target = this.getSkillStoragePath(folderName)
    const linkPath = this.getSkillLinkPath(folderName)

    try {
      // Ensure .claude/skills/ directory exists
      await fs.promises.mkdir(path.dirname(linkPath), { recursive: true })

      // Remove existing link/directory if present
      try {
        const stat = await fs.promises.lstat(linkPath)
        if (stat.isSymbolicLink() || stat.isDirectory()) {
          await fs.promises.rm(linkPath, { recursive: true })
        }
      } catch {
        // Does not exist, fine
      }

      await fs.promises.symlink(target, linkPath, 'junction')
      logger.info('Skill linked', { folderName, target, linkPath })
    } catch (error) {
      logger.error('Failed to link skill', {
        folderName,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  /**
   * Remove the symlink at .claude/skills/{folderName}
   */
  async unlinkSkill(folderName: string): Promise<void> {
    const linkPath = this.getSkillLinkPath(folderName)

    try {
      const stat = await fs.promises.lstat(linkPath)
      if (stat.isSymbolicLink()) {
        await fs.promises.unlink(linkPath)
        logger.info('Skill unlinked', { folderName })
      }
    } catch {
      // Link doesn't exist, nothing to do
    }
  }

  // ===========================================================================
  // Source-specific install flows
  // ===========================================================================

  private async installFromClaudePlugins(identifier: string): Promise<InstalledSkill> {
    // identifier: "owner/repo/directoryPath" e.g. "vercel-labs/agent-skills/skills/react-best-practices"
    const parts = identifier.split('/')
    if (parts.length < 3) {
      throw new Error(`Invalid claude-plugins identifier: ${identifier}`)
    }

    const [owner, repo, ...rest] = parts
    const directoryPath = rest.join('/')
    const repoUrl = `https://github.com/${owner}/${repo}`
    const sourceUrl = `${repoUrl}/tree/main/${directoryPath}`
    const tempDir = await this.createTempDir('claude-plugins')

    try {
      await this.cloneRepository(repoUrl, tempDir)
      const skillName = parts[parts.length - 1]
      const skillDir = await this.resolveSkillDirectory(tempDir, skillName, directoryPath)
      const installed = await this.installSkillDir(skillDir, 'marketplace', sourceUrl)

      // Fire-and-forget install telemetry
      this.reportInstall(owner, repo, skillName).catch((err) => {
        logger.warn('Failed to report install', { error: err instanceof Error ? err.message : String(err) })
      })

      return installed
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  private async installFromSkillsSh(identifier: string): Promise<InstalledSkill> {
    // identifier: "owner/repo" or "owner/repo/skill-name"
    const parts = identifier.split('/')
    if (parts.length < 2) {
      throw new Error(`Invalid skills.sh identifier: ${identifier}`)
    }
    logger.info('Installing from skills.sh', { identifier })

    const owner = parts[0]
    const repo = parts[1]
    const skillName = parts.length > 2 ? parts.slice(2).join('/') : null
    const repoUrl = `https://github.com/${owner}/${repo}`
    const tempDir = await this.createTempDir('skills-sh')

    try {
      await this.cloneRepository(repoUrl, tempDir)
      const skillDir = await this.resolveSkillDirectory(tempDir, skillName, null)
      return await this.installSkillDir(skillDir, 'marketplace', repoUrl)
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  private async installFromClawhub(slug: string): Promise<InstalledSkill> {
    // Fetch skill detail to get download URL
    const detailUrl = `https://api.clawhub.ai/api/v1/skills/${slug}`
    const detailResp = await net.fetch(detailUrl, {
      headers: { 'User-Agent': 'CherryStudio' }
    })

    if (!detailResp.ok) {
      throw new Error(`clawhub detail failed: HTTP ${detailResp.status}`)
    }

    // Download the skill zip
    const downloadUrl = `https://api.clawhub.ai/api/v1/skills/${slug}/download`
    const downloadResp = await net.fetch(downloadUrl, {
      headers: { 'User-Agent': 'CherryStudio' }
    })

    if (!downloadResp.ok) {
      throw new Error(`clawhub download failed: HTTP ${downloadResp.status}`)
    }

    const tempDir = await this.createTempDir('clawhub')
    const zipPath = path.join(tempDir, 'skill.zip')

    try {
      const buffer = Buffer.from(await downloadResp.arrayBuffer())
      await fs.promises.writeFile(zipPath, buffer)
      const extractDir = path.join(tempDir, 'extracted')
      await fs.promises.mkdir(extractDir, { recursive: true })
      await this.extractZip(zipPath, extractDir)
      const skillDir = await this.locateSkillDir(extractDir)
      return await this.installSkillDir(skillDir, 'marketplace', `https://clawhub.ai/skills/${slug}`)
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  // ===========================================================================
  // Core install logic
  // ===========================================================================

  /**
   * Install a skill from a directory containing SKILL.md into global-skills storage.
   * Built-in skills are auto-linked; other sources default to disabled.
   */
  private async installSkillDir(skillDir: string, source: string, sourceUrl: string | null): Promise<InstalledSkill> {
    const metadata = await parseSkillMetadata(skillDir, path.basename(skillDir), 'skills')
    const folderName = this.sanitizeFolderName(metadata.filename)

    // Check for existing skill with same folder name
    const existing = await this.repository.getByFolderName(folderName)

    const contentHash = await this.installer.computeContentHash(skillDir)
    const destPath = this.getSkillStoragePath(folderName)

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await this.installer.install(skillDir, destPath)

    if (existing) {
      // Update existing skill
      await this.repository.delete(existing.id)
    }

    const isBuiltin = source === 'builtin'
    const id = randomUUID()
    const now = Date.now()
    const tags = metadata.tags ? JSON.stringify(metadata.tags) : null

    const skill = await this.repository.insert({
      id,
      name: metadata.name,
      description: metadata.description ?? null,
      folder_name: folderName,
      source,
      source_url: sourceUrl,
      namespace: null,
      author: metadata.author ?? null,
      tags,
      content_hash: contentHash,
      is_enabled: isBuiltin,
      created_at: now,
      updated_at: now
    })

    // Built-in skills are always linked
    if (isBuiltin) {
      await this.linkSkill(folderName)
    }

    logger.info('Skill installed', { id, name: metadata.name, folderName, source })
    return skill
  }

  // ===========================================================================
  // Git operations
  // ===========================================================================

  private async cloneRepository(repoUrl: string, destDir: string): Promise<void> {
    const gitCommand = (await findExecutableInEnv('git')) ?? 'git'

    const branch = await this.resolveDefaultBranch(gitCommand, repoUrl)
    if (branch) {
      await executeCommand(gitCommand, ['clone', '--depth', '1', '--branch', branch, '--', repoUrl, destDir])
      return
    }

    try {
      await executeCommand(gitCommand, ['clone', '--depth', '1', '--', repoUrl, destDir])
    } catch {
      await executeCommand(gitCommand, ['clone', '--depth', '1', '--branch', 'master', '--', repoUrl, destDir])
    }
  }

  private async resolveDefaultBranch(command: string, repoUrl: string): Promise<string | null> {
    try {
      const output = await executeCommand(command, ['ls-remote', '--symref', '--', repoUrl, 'HEAD'], { capture: true })
      const match = output.match(/ref: refs\/heads\/([^\s]+)/)
      return match?.[1] ?? null
    } catch {
      return null
    }
  }

  // ===========================================================================
  // ZIP operations
  // ===========================================================================

  private async validateZipFile(zipFilePath: string): Promise<void> {
    const stats = await fs.promises.stat(zipFilePath)
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${zipFilePath}`)
    }
    if (!zipFilePath.toLowerCase().endsWith('.zip')) {
      throw new Error(`Not a ZIP file: ${zipFilePath}`)
    }
  }

  private async extractZip(zipFilePath: string, destDir: string): Promise<void> {
    const zip = new StreamZip.async({ file: zipFilePath })

    try {
      const entries = await zip.entries()
      let totalSize = 0
      let fileCount = 0

      for (const entry of Object.values(entries)) {
        totalSize += entry.size
        fileCount++

        if (totalSize > MAX_EXTRACTED_SIZE) {
          throw new Error(`ZIP too large: ${totalSize} bytes exceeds ${MAX_EXTRACTED_SIZE}`)
        }
        if (fileCount > MAX_FILES_COUNT) {
          throw new Error(`ZIP has too many files: ${fileCount} exceeds ${MAX_FILES_COUNT}`)
        }
      }

      await zip.extract(null, destDir)
    } finally {
      await zip.close()
    }
  }

  // ===========================================================================
  // Directory resolution
  // ===========================================================================

  private async locateSkillDir(extractedDir: string): Promise<string> {
    return this.resolveSkillDirectory(extractedDir, null, null)
  }

  private async resolveSkillDirectory(
    repoDir: string,
    skillName: string | null,
    directoryPath: string | null
  ): Promise<string> {
    // 1. Check explicit directory path
    if (directoryPath) {
      const resolved = path.resolve(repoDir, directoryPath)
      const skillMdPath = await findSkillMdPath(resolved)
      if (skillMdPath) return resolved

      // directoryPath didn't resolve — fall through to search.
      // This handles cases where the identifier is a skill name rather than a repo path
      // (e.g. "react-best-practices" vs "skills/react-best-practices").
      logger.debug('SKILL.md not found at directoryPath, falling through to search', { directoryPath })
    }

    // 2. Search for skill directories (only when no explicit path given)
    const candidates = await findAllSkillDirectories(repoDir, repoDir, 8)

    if (skillName) {
      const matched = candidates.find((c) => path.basename(c.folderPath) === skillName)
      if (matched) return matched.folderPath
    }

    if (candidates.length === 1) {
      return candidates[0].folderPath
    }

    if (candidates.length > 1 && skillName) {
      // Bidirectional fuzzy match: registry name may contain or be contained by folder name
      // e.g. skillName="vercel-react-best-practices" vs folder="react-best-practices"
      const lowerName = skillName.toLowerCase()
      const fuzzy = candidates.find((c) => {
        const base = path.basename(c.folderPath).toLowerCase()
        return base.includes(lowerName) || lowerName.includes(base)
      })
      if (fuzzy) return fuzzy.folderPath
    }

    if (candidates.length > 0) {
      logger.warn('resolveSkillDirectory: fallback to first candidate', {
        directoryPath,
        skillName,
        candidateCount: candidates.length,
        selected: candidates[0].folderPath
      })
      return candidates[0].folderPath
    }

    // 3. Check if the directory itself has SKILL.md
    const rootSkill = await findSkillMdPath(repoDir)
    if (rootSkill) return repoDir

    throw new Error(`No skill directory found in ${repoDir}`)
  }

  // ===========================================================================
  // Path helpers
  // ===========================================================================

  /** Full path to a skill in global storage */
  private getSkillStoragePath(folderName: string): string {
    return path.join(getDataPath('Skills'), folderName)
  }

  /** Symlink location: {userData}/.claude/skills/{folderName} */
  private getSkillLinkPath(folderName: string): string {
    return path.join(app.getPath('userData'), '.claude', 'skills', folderName)
  }

  private sanitizeFolderName(folderName: string): string {
    let sanitized = folderName.replace(/[/\\]/g, '_')
    sanitized = sanitized.replace(new RegExp(String.fromCharCode(0), 'g'), '')
    sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '_')

    if (sanitized.length > MAX_FOLDER_NAME_LENGTH) {
      sanitized = sanitized.slice(0, MAX_FOLDER_NAME_LENGTH)
    }

    return sanitized
  }

  private async createTempDir(prefix: string): Promise<string> {
    const tempDir = path.join(app.getPath('temp'), 'cherry-studio', 'skill-install', `${prefix}-${Date.now()}`)
    await fs.promises.mkdir(tempDir, { recursive: true })
    return tempDir
  }

  private async safeRemoveDirectory(dirPath: string): Promise<void> {
    try {
      await deleteDirectoryRecursive(dirPath)
    } catch (error) {
      logger.warn('Failed to clean up temp directory', {
        dirPath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async buildFileTree(dir: string, root: string): Promise<SkillFileNode[]> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    const nodes: SkillFileNode[] = []

    // Sort: directories first, then files, alphabetically
    const sorted = entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    for (const entry of sorted) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(root, fullPath)

      if (entry.isDirectory()) {
        const children = await this.buildFileTree(fullPath, root)
        nodes.push({ name: entry.name, path: relativePath, type: 'directory', children })
      } else {
        nodes.push({ name: entry.name, path: relativePath, type: 'file' })
      }
    }

    return nodes
  }

  private async reportInstall(owner: string, repo: string, skillName: string): Promise<void> {
    const url = `${CLAUDE_PLUGINS_API}/api/skills/${owner}/${repo}/${skillName}/install`
    await net.fetch(url, { method: 'POST' })
  }
}

export const skillService = SkillService.getInstance()
