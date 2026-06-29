import * as fs from 'node:fs'
import * as path from 'node:path'

import { application } from '@application'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { directoryExists } from '@main/utils/file'
import { deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { executeCommand, findExecutableInEnv } from '@main/utils/process'
import type { InstalledSkill, ListSkillsQuery } from '@shared/data/api/schemas/skills'
import type {
  SkillFileNode,
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillToggleOptions
} from '@shared/types/skill'
import { net } from 'electron'
import StreamZip from 'node-stream-zip'

import { SkillInstaller } from './SkillInstaller'

const logger = loggerService.withContext('SkillService')

// API base URLs for the 3 search sources
const CLAUDE_PLUGINS_API = 'https://api.claude-plugins.dev'

// ZIP extraction limits
const MAX_EXTRACTED_SIZE = 100 * 1024 * 1024 // 100MB
const MAX_FILES_COUNT = 1000
const MAX_FOLDER_NAME_LENGTH = 80

/**
 * Skill management service.
 *
 * Skills are stored in `{dataPath}/Skills/{folderName}/` — the app-owned canonical
 * library. They are mirrored into `CLAUDE_CONFIG_DIR/skills` (where the Claude Agent
 * SDK discovers them) at install / uninstall / startup reconcile — see `linkMirror` /
 * `reconcileSkills`. Per-session the SDK is given only a name whitelist
 * (`buildSkillWhitelist`), so the mirror is never mutated at session-build time.
 *
 * Skill library metadata lives in `agent_global_skill`. Per-agent enablement
 * state lives in the `agent_skill` join table.
 */
export class SkillService {
  private readonly installer: SkillInstaller

  constructor() {
    this.installer = new SkillInstaller()
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * List installed skills.
   *
   * When `agentId` is provided, each skill's `isEnabled` field reflects the
   * per-agent enablement state from `agent_skill`. Without `agentId`,
   * the field is forced to `false`.
   */
  async getById(id: string): Promise<InstalledSkill | null> {
    return agentGlobalSkillService.getById(id)
  }

  async list(query: ListSkillsQuery = {}): Promise<InstalledSkill[]> {
    return agentGlobalSkillService.list(query)
  }

  /** Enable or disable a skill for a specific agent. */
  async toggle(options: SkillToggleOptions): Promise<InstalledSkill | null> {
    const skill = await agentGlobalSkillService.getById(options.skillId)
    if (!skill) return null

    await agentGlobalSkillService.upsertJoin(options.agentId, options.skillId, options.isEnabled)

    return { ...skill, isEnabled: options.isEnabled }
  }

  /** Enable a skill across every existing agent. Used when a new builtin skill is installed. */
  async enableForAllAgents(skillId: string): Promise<void> {
    const agentIds = await agentGlobalSkillService.upsertJoinForAllAgents(skillId, true)

    logger.info('Enabled skill for all agents', { skillId, agentCount: agentIds.length })
  }

  async readFile(skillId: string, filename: string): Promise<string | null> {
    const skill = await agentGlobalSkillService.getById(skillId)
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
    const skill = await agentGlobalSkillService.getById(skillId)
    if (!skill) return []

    const skillRoot = this.getSkillStoragePath(skill.folderName)
    try {
      return await this.buildFileTree(skillRoot, skillRoot)
    } catch {
      return []
    }
  }

  async uninstallByFolderName(folderName: string): Promise<void> {
    const skill = await agentGlobalSkillService.getByFolderName(folderName)
    if (!skill) {
      throw new Error(`Skill not found by folder name: ${folderName}`)
    }
    await this.uninstall(skill.id)
  }

  async getByFolderName(name: string): Promise<InstalledSkill | null> {
    const folderName = this.sanitizeFolderName(name)
    return agentGlobalSkillService.getByFolderName(folderName)
  }

  /**
   * Resolve the absolute path a skill with the given name would live at under
   * the global Skills storage root.
   */
  getSkillDirectory(name: string): string {
    return this.getSkillStoragePath(this.sanitizeFolderName(name))
  }

  async uninstall(skillId: string): Promise<void> {
    const skill = await agentGlobalSkillService.getById(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    // Remove from global storage; FK cascade on skill_id deletes agent_skills rows.
    const skillPath = this.getSkillStoragePath(skill.folderName)
    await this.installer.uninstall(skillPath)
    await this.unlinkMirror(skill.folderName)
    await agentGlobalSkillService.deleteById(skillId)
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
        if (!(await this.isLocalSkillDirectoryEntry(skillsDir, entry))) continue
        try {
          const skillPath = path.join(skillsDir, entry.name)
          const metadata = await parseSkillMetadata(skillPath, entry.name, 'skills')
          results.push({ name: metadata.name, description: metadata.description, filename: entry.name })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          logger.warn('Failed to parse skill metadata; skipping', {
            skillsDir,
            entry: entry.name,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return results
      logger.warn('Failed to enumerate skills directory', {
        skillsDir,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return results
  }

  /**
   * `listLocal` is only for user/project-owned workspace skills that already
   * live under `.claude/skills/`. Those entries can be real directories or
   * user-created symlinks to directories.
   *
   * Cherry-managed skills also appear under `.claude/skills/` as symlinks when
   * enabled for Claude SDK discovery, but their source of truth is
   * `agent_global_skill` and they are rendered by `list({ agentId })`. Keep
   * them out of this local-only list.
   */
  private async isLocalSkillDirectoryEntry(skillsDir: string, entry: fs.Dirent): Promise<boolean> {
    if (entry.isDirectory()) return true
    if (!entry.isSymbolicLink()) return false

    const entryPath = path.join(skillsDir, entry.name)
    try {
      const stats = await fs.promises.stat(entryPath)
      if (!stats.isDirectory()) return false
      if (await this.isManagedSkillSymlinkTarget(entryPath)) return false
      return true
    } catch (error) {
      logger.warn('Failed to resolve local skill symlink; skipping', {
        skillsDir,
        entry: entry.name,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  /** Existing workspace entries pointing into app-owned global storage are managed DB-backed skills. */
  private async isManagedSkillSymlinkTarget(entryPath: string): Promise<boolean> {
    try {
      const [entryRealPath, skillsRootRealPath] = await Promise.all([
        fs.promises.realpath(entryPath),
        fs.promises.realpath(application.getPath('feature.agents.skills'))
      ])
      return entryRealPath === skillsRootRealPath || entryRealPath.startsWith(skillsRootRealPath + path.sep)
    } catch {
      return false
    }
  }

  // ===========================================================================
  // Source-specific install flows
  // ===========================================================================

  private async installFromClaudePlugins(identifier: string): Promise<InstalledSkill> {
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

      this.reportInstall(owner, repo, skillName).catch((err) => {
        logger.warn('Failed to report install', { error: err instanceof Error ? err.message : String(err) })
      })

      return installed
    } finally {
      await this.safeRemoveDirectory(tempDir)
    }
  }

  private async installFromSkillsSh(identifier: string): Promise<InstalledSkill> {
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
    const detailUrl = `https://api.clawhub.ai/api/v1/skills/${slug}`
    const detailResp = await net.fetch(detailUrl, {
      headers: { 'User-Agent': 'CherryStudio' }
    })

    if (!detailResp.ok) {
      throw new Error(`clawhub detail failed: HTTP ${detailResp.status}`)
    }

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

  private async installSkillDir(skillDir: string, source: string, sourceUrl: string | null): Promise<InstalledSkill> {
    const metadata = await parseSkillMetadata(skillDir, path.basename(skillDir), 'skills')

    const skillsRoot = path.resolve(application.getPath('feature.agents.skills'))
    const isInPlace = path.resolve(path.dirname(skillDir)) === skillsRoot
    const folderName = isInPlace ? path.basename(skillDir) : this.sanitizeFolderName(metadata.filename)

    const existing = await agentGlobalSkillService.getByFolderName(folderName)

    const contentHash = await this.installer.computeContentHash(skillDir)
    const destPath = this.getSkillStoragePath(folderName)

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await this.installer.install(skillDir, destPath)
    await this.linkMirror(folderName)

    const tags = metadata.tags ?? []

    if (existing) {
      // Update metadata in-place to preserve the skill ID and its agent_skills rows.
      await agentGlobalSkillService.update(existing.id, {
        name: metadata.name,
        description: metadata.description ?? null,
        author: metadata.author ?? null,
        tags,
        contentHash
      })
      const updated = (await agentGlobalSkillService.getById(existing.id))!
      logger.info('Skill updated', { id: existing.id, name: metadata.name, folderName, source })
      return updated
    }

    const isBuiltin = source === 'builtin'

    let inserted: InstalledSkill | undefined
    try {
      const insertedRow = await agentGlobalSkillService.insert({
        name: metadata.name,
        description: metadata.description ?? null,
        folderName,
        source,
        sourceUrl,
        namespace: null,
        author: metadata.author ?? null,
        tags,
        contentHash,
        isEnabled: false
      })
      inserted = (await agentGlobalSkillService.getById(insertedRow.id)) ?? undefined
    } catch (error) {
      try {
        await this.installer.uninstall(destPath)
      } catch (cleanupError) {
        logger.error('Failed to clean up skill files after DB insert failure', {
          folderName,
          destPath,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        })
      }
      throw error
    }
    if (!inserted) {
      await this.installer.uninstall(destPath)
      throw new Error(`Failed to insert skill: ${metadata.name}`)
    }

    if (isBuiltin) {
      await this.enableForAllAgents(inserted.id)
    }

    logger.info('Skill installed', { id: inserted.id, name: metadata.name, folderName, source })
    return inserted
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
    if (directoryPath) {
      const resolved = path.resolve(repoDir, directoryPath)
      const skillMdPath = await findSkillMdPath(resolved)
      if (skillMdPath) return resolved

      logger.debug('SKILL.md not found at directoryPath, falling through to search', { directoryPath })
    }

    const candidates = await findAllSkillDirectories(repoDir, repoDir, 8)

    if (skillName) {
      const matched = candidates.find((c) => path.basename(c.folderPath) === skillName)
      if (matched) return matched.folderPath
    }

    if (candidates.length === 1) {
      return candidates[0].folderPath
    }

    if (candidates.length > 1 && skillName) {
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

    const rootSkill = await findSkillMdPath(repoDir)
    if (rootSkill) return repoDir

    throw new Error(`No skill directory found in ${repoDir}`)
  }

  // ===========================================================================
  // Path helpers
  // ===========================================================================

  private getSkillStoragePath(folderName: string): string {
    return path.join(application.getPath('feature.agents.skills'), folderName)
  }

  // ===========================================================================
  // Claude config-dir mirror
  //
  // The Claude Agent SDK discovers skill files from CLAUDE_CONFIG_DIR/skills
  // (`feature.agents.claude.skills` = <userData>/.claude/skills). We keep that
  // directory as a mirror of the owned `Data/Skills` library, maintained at
  // install / uninstall / startup reconcile — NOT per session. The SDK's
  // `Options.skills` is only a name whitelist, so the files must physically
  // live here for a whitelisted name to load.
  // ===========================================================================

  private getMirrorRoot(): string {
    return application.getPath('feature.agents.claude.skills')
  }

  private getMirrorPath(folderName: string): string {
    return path.join(this.getMirrorRoot(), folderName)
  }

  /** Mirror `Data/Skills/<folderName>` into CLAUDE_CONFIG_DIR/skills. Idempotent. */
  async linkMirror(folderName: string): Promise<void> {
    const sourceDir = this.getSkillStoragePath(folderName)
    const rootDir = path.resolve(this.getMirrorRoot())
    const targetDir = path.resolve(rootDir, folderName)
    const relativeTarget = path.relative(rootDir, targetDir)
    if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      logger.warn('Refusing to mirror skill outside Claude config root', { folderName, targetDir })
      return
    }

    try {
      await fs.promises.access(path.join(sourceDir, 'SKILL.md'), fs.constants.R_OK)
    } catch {
      logger.warn('Skill source files missing; skipping mirror', { folderName, sourceDir })
      return
    }

    try {
      await fs.promises.mkdir(rootDir, { recursive: true })

      if (!isWin) {
        const stat = await fs.promises.lstat(targetDir).catch(() => null)
        if (stat?.isSymbolicLink()) {
          const [targetRealPath, sourceRealPath] = await Promise.all([
            fs.promises.realpath(targetDir).catch(() => null),
            fs.promises.realpath(sourceDir)
          ])
          if (targetRealPath === sourceRealPath) return
        }
      }

      await fs.promises.rm(targetDir, { recursive: true, force: true })
      if (isWin) {
        // Windows uses a real copy instead of symlink/junction (privilege/packaging quirks).
        await fs.promises.cp(sourceDir, targetDir, { recursive: true, force: true })
      } else {
        await fs.promises.symlink(sourceDir, targetDir, 'dir')
      }
    } catch (error) {
      logger.warn('Failed to mirror skill to Claude config', { folderName, sourceDir, targetDir, error })
    }
  }

  /** Remove the CLAUDE_CONFIG_DIR/skills mirror entry for a skill. */
  async unlinkMirror(folderName: string): Promise<void> {
    const targetDir = this.getMirrorPath(folderName)
    try {
      await fs.promises.rm(targetDir, { recursive: true, force: true })
    } catch (error) {
      logger.warn('Failed to remove skill mirror', { folderName, targetDir, error })
    }
  }

  /**
   * Register a skill the user dropped into CLAUDE_CONFIG_DIR/skills that we do
   * not manage yet: copy its files into the owned `Data/Skills` library, insert
   * a DB row, and replace the entry with a managed mirror — so it shows in the
   * UI and is per-agent toggleable like any other skill.
   */
  private async adoptUnmanagedSkill(folderName: string, configEntryPath: string): Promise<void> {
    const metadata = await parseSkillMetadata(configEntryPath, folderName, 'skills')
    const realSource = await fs.promises.realpath(configEntryPath)
    const destPath = this.getSkillStoragePath(folderName)
    const contentHash = await this.installer.computeContentHash(realSource)

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await this.installer.install(realSource, destPath)

    await agentGlobalSkillService.insert({
      name: metadata.name,
      description: metadata.description ?? null,
      folderName,
      source: 'local',
      sourceUrl: null,
      namespace: null,
      author: metadata.author ?? null,
      tags: metadata.tags ?? [],
      contentHash,
      isEnabled: false
    })

    await this.linkMirror(folderName)
    logger.info('Adopted unmanaged skill from Claude config', { folderName })
  }

  /**
   * Reconcile the CLAUDE_CONFIG_DIR/skills mirror with the owned library.
   *
   * 1. DB → mirror: every library skill is mirrored (warns if its files are missing).
   * 2. mirror → DB (adopt): user-dropped skills become managed + toggleable.
   * 3. prune: managed mirror entries whose DB row is gone are removed.
   *
   * Idempotent; runs once at startup. Mutations never happen at session build,
   * so concurrent session builds only read this directory.
   */
  async reconcileSkills(): Promise<void> {
    const all = await agentGlobalSkillService.listAll()
    const known = new Set(all.map((s) => s.folderName))

    for (const skill of all) {
      await this.linkMirror(skill.folderName)
    }

    const root = this.getMirrorRoot()
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const folderName = entry.name
      if (known.has(folderName)) continue

      const entryPath = path.join(root, folderName)

      if (await this.isManagedSkillSymlinkTarget(entryPath)) {
        // Mirror left behind by an uninstalled skill — drop it.
        await this.unlinkMirror(folderName)
        continue
      }

      // ponytail: adopt = entry with a top-level SKILL.md only; ignores
      // settings.json, plugins/, projects/, etc. — never swallows non-skill config.
      try {
        await fs.promises.access(path.join(entryPath, 'SKILL.md'), fs.constants.R_OK)
      } catch {
        continue
      }
      try {
        await this.adoptUnmanagedSkill(folderName, entryPath)
      } catch (error) {
        logger.warn('Failed to adopt unmanaged skill', {
          folderName,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
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
    const tempDir = path.join(application.getPath('feature.agents.skills.install.temp'), `${prefix}-${Date.now()}`)
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

  /**
   * Register or refresh a built-in skill's DB row after its files have been
   * copied to the global skills directory. Called by `installBuiltinSkills`.
   *
   * - If the row exists and files weren't updated, no-ops.
   * - If files were updated, refreshes the metadata row in-place.
   * - If the row is missing (first install), inserts it and fans it out to
   *   every existing agent via `enableForAllAgents`.
   */
  async syncBuiltinSkill(folderName: string, destPath: string, filesUpdated: boolean): Promise<void> {
    const existing = await agentGlobalSkillService.getByFolderName(folderName)
    if (existing && !filesUpdated) return

    const metadata = await parseSkillMetadata(destPath, folderName, 'skills')
    const contentHash = await this.installer.computeContentHash(destPath)
    const tags = metadata.tags ?? []

    if (existing) {
      await agentGlobalSkillService.update(existing.id, {
        name: metadata.name,
        description: metadata.description ?? null,
        author: metadata.author ?? null,
        tags,
        contentHash
      })
    } else {
      const inserted = await agentGlobalSkillService.insert({
        name: metadata.name,
        description: metadata.description ?? null,
        folderName,
        source: 'builtin',
        sourceUrl: null,
        namespace: null,
        author: metadata.author ?? null,
        tags,
        contentHash,
        isEnabled: false
      })
      await this.enableForAllAgents(inserted.id)
    }

    await this.linkMirror(folderName)
    logger.info('Built-in skill synced to DB', { folderName, firstInstall: !existing })
  }

  private async reportInstall(owner: string, repo: string, skillName: string): Promise<void> {
    const url = `${CLAUDE_PLUGINS_API}/api/skills/${owner}/${repo}/${skillName}/install`
    await net.fetch(url, { method: 'POST' })
  }
}

export const skillService = new SkillService()
