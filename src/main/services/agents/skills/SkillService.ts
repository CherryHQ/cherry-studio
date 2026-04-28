import * as fs from 'node:fs'
import * as path from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import {
  type AgentGlobalSkillRow,
  agentGlobalSkillTable,
  type InsertAgentGlobalSkillRow
} from '@data/db/schemas/agentGlobalSkill'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { tagService } from '@data/services/TagService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { directoryExists } from '@main/utils/file'
import { deleteDirectoryRecursive } from '@main/utils/fileOperations'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { executeCommand, findExecutableInEnv } from '@main/utils/process'
import type { ListSkillsQuery } from '@shared/data/api/schemas/agents'
import type { Tag } from '@shared/data/types/tag'
import type {
  InstalledSkill,
  SkillFileNode,
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillToggleOptions
} from '@types'
import { and, asc, eq, inArray, or, type SQL, sql } from 'drizzle-orm'
import { net } from 'electron'
import StreamZip from 'node-stream-zip'

import { SkillInstaller } from './SkillInstaller'

const logger = loggerService.withContext('SkillService')

type SkillListOptions = string | ListSkillsQuery

// API base URLs for the 3 search sources
const CLAUDE_PLUGINS_API = 'https://api.claude-plugins.dev'

// ZIP extraction limits
const MAX_EXTRACTED_SIZE = 100 * 1024 * 1024 // 100MB
const MAX_FILES_COUNT = 1000
const MAX_FOLDER_NAME_LENGTH = 80

/**
 * Skill management service.
 *
 * Skills are stored in `{dataPath}/Skills/{folderName}/` (inert global library).
 * When enabled for a specific agent, a symlink is created at
 * `{agentWorkspace}/.claude/skills/{folderName}/` pointing to the library,
 * making the skill discoverable by Claude Code running against that workspace.
 *
 * Skill library metadata lives in `agent_global_skill`. Per-agent enablement
 * state lives in the `agent_skill` join table.
 */
export class SkillService {
  private readonly installer: SkillInstaller

  constructor() {
    this.installer = new SkillInstaller()
  }

  private get db() {
    return application.get('DbService').getDb()
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
    return this.getSkillById(id)
  }

  async list(options?: SkillListOptions): Promise<InstalledSkill[]> {
    const query: ListSkillsQuery = typeof options === 'string' ? { agentId: options } : (options ?? {})
    const conditions: SQL[] = []

    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
      const nameMatch = sql`${agentGlobalSkillTable.name} LIKE ${pattern} ESCAPE '\\'`
      const descMatch = sql`${agentGlobalSkillTable.description} LIKE ${pattern} ESCAPE '\\'`
      const searchClause = or(nameMatch, descMatch)
      if (searchClause) conditions.push(searchClause)
    }

    if (query.tagIds && query.tagIds.length > 0) {
      const tagIds = Array.from(new Set(query.tagIds))
      conditions.push(
        inArray(
          agentGlobalSkillTable.id,
          this.db
            .select({ entityId: entityTagTable.entityId })
            .from(entityTagTable)
            .where(and(eq(entityTagTable.entityType, 'skill'), inArray(entityTagTable.tagId, tagIds)))
        )
      )
    }

    const rows =
      conditions.length > 0
        ? await this.db
            .select()
            .from(agentGlobalSkillTable)
            .where(and(...conditions))
            .orderBy(asc(agentGlobalSkillTable.createdAt))
        : await this.db.select().from(agentGlobalSkillTable).orderBy(asc(agentGlobalSkillTable.createdAt))
    const tagMap = await this.getTagsBySkillIds(rows.map((row) => row.id))
    const skills = rows.map((row) => this.rowToInstalledSkill(row, tagMap.get(row.id) ?? []))
    if (!query.agentId) {
      return skills.map((s) => ({ ...s, isEnabled: false }))
    }

    const agentSkillRows = await this.db
      .select()
      .from(agentSkillTable)
      .where(eq(agentSkillTable.agentId, query.agentId))
    const enabledMap = new Map<string, boolean>()
    for (const row of agentSkillRows) {
      enabledMap.set(row.skillId, row.isEnabled)
    }
    return skills.map((s) => ({ ...s, isEnabled: enabledMap.get(s.id) ?? false }))
  }

  /**
   * Enable or disable a skill for a specific agent.
   *
   * Updates the `agent_skill` join row and creates / removes the
   * corresponding symlink under `{agentWorkspace}/.claude/skills/`.
   */
  async toggle(options: SkillToggleOptions): Promise<InstalledSkill | null> {
    const skill = await this.getSkillById(options.skillId)
    if (!skill) return null

    const workspace = await this.getAgentWorkspace(options.agentId)

    await this.upsertAgentSkill(options.agentId, options.skillId, options.isEnabled)

    if (workspace) {
      try {
        if (options.isEnabled) {
          await this.linkSkill(skill.folderName, workspace)
        } else {
          await this.unlinkSkill(skill.folderName, workspace)
        }
      } catch (error) {
        let rollbackError: unknown
        await this.upsertAgentSkill(options.agentId, options.skillId, !options.isEnabled).catch((e) => {
          rollbackError = e
          logger.error('Failed to roll back agent_skill after symlink error', {
            agentId: options.agentId,
            skillId: options.skillId,
            error: e instanceof Error ? e.message : String(e)
          })
        })
        logger.error('Failed to (un)link skill for agent', {
          agentId: options.agentId,
          skillId: options.skillId,
          isEnabled: options.isEnabled,
          error: error instanceof Error ? error.message : String(error)
        })
        if (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Skill toggle and rollback both failed')
        }
        throw error
      }
    } else {
      logger.warn('Skipping skill symlink: agent has no resolvable workspace', {
        agentId: options.agentId,
        skillId: options.skillId
      })
    }

    return { ...skill, isEnabled: options.isEnabled }
  }

  /**
   * Seed skill enablement for a freshly created agent.
   *
   * Every skill marked `source = 'builtin'` is auto-enabled for the new agent.
   */
  async initSkillsForAgent(agentId: string, workspace: string | undefined): Promise<void> {
    const rows = await this.db.select().from(agentGlobalSkillTable)
    const builtinSkills = rows.filter((r) => r.source === 'builtin').map((row) => this.rowToInstalledSkill(row))
    if (builtinSkills.length === 0) return

    for (const skill of builtinSkills) {
      await this.upsertAgentSkill(agentId, skill.id, true)
      if (workspace) {
        try {
          await this.linkSkill(skill.folderName, workspace)
        } catch (error) {
          logger.warn('Failed to link builtin skill for new agent', {
            agentId,
            skillId: skill.id,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }
    logger.info('Seeded builtin skills for agent', { agentId, count: builtinSkills.length })
  }

  /**
   * Enable a skill across every existing agent and create per-workspace symlinks.
   * Used when a new builtin skill is installed.
   */
  async enableForAllAgents(skillId: string, folderName: string): Promise<void> {
    const agents = await this.db
      .select({ id: agentTable.id, accessiblePaths: agentTable.accessiblePaths })
      .from(agentTable)

    for (const agent of agents) {
      await this.upsertAgentSkill(agent.id, skillId, true)
      const workspace = this.parseFirstAccessiblePath(agent.accessiblePaths)
      if (!workspace || !(await directoryExists(workspace))) continue
      try {
        await this.linkSkill(folderName, workspace)
      } catch (error) {
        logger.warn('Failed to link builtin skill for agent', {
          agentId: agent.id,
          skillId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    logger.info('Enabled skill for all agents', { skillId, folderName, agentCount: agents.length })
  }

  /**
   * Ensure the workspace's `.claude/skills/` directory matches the
   * `agent_skill` DB state for the given agent.
   */
  async reconcileAgentSkills(agentId: string, workspace: string): Promise<void> {
    if (!workspace) return
    const agentSkillRows = await this.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, agentId))

    for (const row of agentSkillRows) {
      if (!row.isEnabled) continue
      const skill = await this.getSkillById(row.skillId)
      if (!skill) continue
      try {
        await this.linkSkill(skill.folderName, workspace)
      } catch (error) {
        logger.warn('Reconcile: failed to link skill', {
          agentId,
          skillId: row.skillId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  async readFile(skillId: string, filename: string): Promise<string | null> {
    const skill = await this.getSkillById(skillId)
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
    const skill = await this.getSkillById(skillId)
    if (!skill) return []

    const skillRoot = this.getSkillStoragePath(skill.folderName)
    try {
      return await this.buildFileTree(skillRoot, skillRoot)
    } catch {
      return []
    }
  }

  async uninstallByFolderName(folderName: string): Promise<void> {
    const skill = await this.getSkillByFolderName(folderName)
    if (!skill) {
      throw new Error(`Skill not found by folder name: ${folderName}`)
    }
    await this.uninstall(skill.id)
  }

  async getByFolderName(name: string): Promise<InstalledSkill | null> {
    const folderName = this.sanitizeFolderName(name)
    return this.getSkillByFolderName(folderName)
  }

  /**
   * Resolve the absolute path a skill with the given name would live at under
   * the global Skills storage root.
   */
  getSkillDirectory(name: string): string {
    return this.getSkillStoragePath(this.sanitizeFolderName(name))
  }

  async uninstall(skillId: string): Promise<void> {
    const skill = await this.getSkillById(skillId)
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    // Remove symlinks from every agent workspace that had this skill enabled,
    // before we lose the join rows to the cascade delete below.
    const agentSkillRows = await this.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, skillId))
    for (const row of agentSkillRows) {
      if (!row.isEnabled) continue
      const workspace = await this.getAgentWorkspace(row.agentId)
      if (!workspace) continue
      try {
        await this.unlinkSkill(skill.folderName, workspace)
      } catch (error) {
        logger.warn('Failed to unlink skill during uninstall', {
          skillId,
          agentId: row.agentId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // Remove from global storage; FK cascade on skill_id deletes agent_skills rows.
    const skillPath = this.getSkillStoragePath(skill.folderName)
    await this.installer.uninstall(skillPath)
    await this.db.transaction(async (tx) => {
      await tx.delete(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, skillId))
      await tagService.purgeForEntity(tx, 'skill', skillId)
    })
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
   * Create a symlink from `{workspace}/.claude/skills/{folderName}` →
   * global skills storage (`{dataPath}/Skills/{folderName}`).
   */
  async linkSkill(folderName: string, workspace: string): Promise<void> {
    const target = this.getSkillStoragePath(folderName)
    const linkPath = this.getSkillLinkPath(folderName, workspace)

    try {
      await fs.promises.mkdir(path.dirname(linkPath), { recursive: true })

      try {
        const stat = await fs.promises.lstat(linkPath)
        if (stat.isSymbolicLink()) {
          await fs.promises.rm(linkPath)
        } else if (stat.isDirectory()) {
          logger.warn('Refusing to overwrite non-symlink directory for skill', { folderName, linkPath })
          return
        }
      } catch {
        // Does not exist, fine
      }

      await fs.promises.symlink(target, linkPath, 'junction')
      logger.info('Skill linked', { folderName, target, linkPath })
    } catch (error) {
      logger.error('Failed to link skill', {
        folderName,
        linkPath,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  /**
   * Remove the symlink at `{workspace}/.claude/skills/{folderName}`.
   */
  async unlinkSkill(folderName: string, workspace: string): Promise<void> {
    const linkPath = this.getSkillLinkPath(folderName, workspace)

    try {
      const stat = await fs.promises.lstat(linkPath)
      if (stat.isSymbolicLink()) {
        await fs.promises.unlink(linkPath)
        logger.info('Skill unlinked', { folderName, linkPath })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Failed to unlink skill', {
          folderName,
          linkPath,
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
      // Link doesn't exist, nothing to do
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

    const existing = await this.getSkillByFolderName(folderName)

    const contentHash = await this.installer.computeContentHash(skillDir)
    const destPath = this.getSkillStoragePath(folderName)

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await this.installer.install(skillDir, destPath)

    const tags = metadata.tags ?? []

    if (existing) {
      // Update metadata in-place to preserve the skill ID and its agent_skills rows.
      await this.db
        .update(agentGlobalSkillTable)
        .set({
          name: metadata.name,
          description: metadata.description ?? null,
          author: metadata.author ?? null,
          tags,
          contentHash
        })
        .where(eq(agentGlobalSkillTable.id, existing.id))
      const updated = (await this.getSkillById(existing.id))!
      logger.info('Skill updated', { id: existing.id, name: metadata.name, folderName, source })
      return updated
    }

    const isBuiltin = source === 'builtin'

    const insertData: InsertAgentGlobalSkillRow = {
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
    }
    const [inserted] = await this.db.insert(agentGlobalSkillTable).values(insertData).returning()
    if (!inserted) throw new Error(`Failed to insert skill: ${metadata.name}`)
    const skill = this.rowToInstalledSkill(inserted)

    if (isBuiltin) {
      await this.enableForAllAgents(skill.id, folderName)
    }

    logger.info('Skill installed', { id: skill.id, name: metadata.name, folderName, source })
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

  private getSkillLinkPath(folderName: string, workspace: string): string {
    return path.join(workspace, '.claude', 'skills', folderName)
  }

  private async getAgentWorkspace(agentId: string): Promise<string | undefined> {
    const rows = await this.db
      .select({ accessiblePaths: agentTable.accessiblePaths })
      .from(agentTable)
      .where(eq(agentTable.id, agentId))
      .limit(1)
    const workspace = this.parseFirstAccessiblePath(rows[0]?.accessiblePaths)
    if (!workspace) return undefined
    if (!(await directoryExists(workspace))) return undefined
    return workspace
  }

  private parseFirstAccessiblePath(paths: string[] | null | undefined): string | undefined {
    if (!paths || paths.length === 0) return undefined
    return typeof paths[0] === 'string' ? paths[0] : undefined
  }

  private async getSkillById(id: string): Promise<InstalledSkill | null> {
    const rows = await this.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, id)).limit(1)
    if (!rows[0]) return null
    const tagMap = await this.getTagsBySkillIds([rows[0].id])
    return this.rowToInstalledSkill(rows[0], tagMap.get(rows[0].id) ?? [])
  }

  private async getSkillByFolderName(folderName: string): Promise<InstalledSkill | null> {
    const rows = await this.db
      .select()
      .from(agentGlobalSkillTable)
      .where(eq(agentGlobalSkillTable.folderName, folderName))
      .limit(1)
    if (!rows[0]) return null
    const tagMap = await this.getTagsBySkillIds([rows[0].id])
    return this.rowToInstalledSkill(rows[0], tagMap.get(rows[0].id) ?? [])
  }

  private async upsertAgentSkill(agentId: string, skillId: string, isEnabled: boolean): Promise<void> {
    await this.db
      .insert(agentSkillTable)
      .values({ agentId, skillId, isEnabled })
      .onConflictDoUpdate({
        target: [agentSkillTable.agentId, agentSkillTable.skillId],
        set: { isEnabled }
      })
  }

  private async getTagsBySkillIds(skillIds: string[]): Promise<Map<string, Tag[]>> {
    const tagMap = new Map<string, Tag[]>()
    if (skillIds.length === 0) return tagMap

    for (const id of skillIds) {
      tagMap.set(id, [])
    }

    const rows = await this.db
      .select({
        skillId: entityTagTable.entityId,
        tagId: tagTable.id,
        tagName: tagTable.name,
        tagColor: tagTable.color,
        tagCreatedAt: tagTable.createdAt,
        tagUpdatedAt: tagTable.updatedAt
      })
      .from(entityTagTable)
      .innerJoin(tagTable, eq(entityTagTable.tagId, tagTable.id))
      .where(and(eq(entityTagTable.entityType, 'skill'), inArray(entityTagTable.entityId, skillIds)))
      .orderBy(asc(entityTagTable.entityId), asc(tagTable.name))

    for (const row of rows) {
      // Bucket is initialized above for every requested id, and `inArray`
      // bounds rows to that same set — so `get` is non-null here.
      const bucket = tagMap.get(row.skillId)!
      bucket.push({
        id: row.tagId,
        name: row.tagName,
        color: row.tagColor ?? null,
        createdAt: timestampToISO(row.tagCreatedAt),
        updatedAt: timestampToISO(row.tagUpdatedAt)
      })
    }

    return tagMap
  }

  private rowToInstalledSkill(row: AgentGlobalSkillRow, tags: Tag[] = []): InstalledSkill {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      folderName: row.folderName,
      source: row.source,
      sourceUrl: row.sourceUrl,
      namespace: row.namespace,
      author: row.author,
      tags,
      sourceTags: row.tags ?? [],
      contentHash: row.contentHash,
      isEnabled: row.isEnabled,
      createdAt: timestampToISO(row.createdAt ?? Date.now()),
      updatedAt: timestampToISO(row.updatedAt ?? Date.now())
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
    const existing = await this.getSkillByFolderName(folderName)
    if (existing && !filesUpdated) return

    const metadata = await parseSkillMetadata(destPath, folderName, 'skills')
    const contentHash = await this.installer.computeContentHash(destPath)
    const tags = metadata.tags ?? []

    if (existing) {
      await this.db
        .update(agentGlobalSkillTable)
        .set({
          name: metadata.name,
          description: metadata.description ?? null,
          author: metadata.author ?? null,
          tags,
          contentHash
        })
        .where(eq(agentGlobalSkillTable.id, existing.id))
    } else {
      const [inserted] = await this.db
        .insert(agentGlobalSkillTable)
        .values({
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
        .returning()
      if (!inserted) throw new Error(`Failed to insert builtin skill: ${folderName}`)
      await this.enableForAllAgents(inserted.id, folderName)
    }

    logger.info('Built-in skill synced to DB', { folderName, firstInstall: !existing })
  }

  private async reportInstall(owner: string, repo: string, skillName: string): Promise<void> {
    const url = `${CLAUDE_PLUGINS_API}/api/skills/${owner}/${repo}/${skillName}/install`
    await net.fetch(url, { method: 'POST' })
  }
}

export const skillService = new SkillService()
