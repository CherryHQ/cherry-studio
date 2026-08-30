import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { application } from '@application'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { directoryExists } from '@main/utils/legacyFile'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { getShellEnv } from '@main/utils/shellEnv'
import type { InstalledSkill, ListSkillsQuery } from '@shared/data/api/schemas/skills'
import { skillErrorCodes } from '@shared/ipc/errors/skill'
import type {
  SkillImportSystemOptions,
  SkillInstallFromDirectoryOptions,
  SkillInstallFromZipOptions,
  SkillInstallOptions,
  SkillRemoteUpdateCheck,
  SkillToggleOptions,
  SystemSkillCandidate,
  SystemSkillPlacement
} from '@shared/types/skill'
import { Mutex } from 'async-mutex'

import { extractZip, resolveSkillDirectory, validateZipFile } from './skillArchive'
import { SkillInstaller } from './SkillInstaller'
import { createTempDir, normalizeFolderKey, safeRemoveDirectory, sanitizeFolderName } from './skillPaths'
import { fetchRemoteSkill } from './skillRemoteSource'
import { buildSystemSkillSources } from './systemSkillSources'

const logger = loggerService.withContext('SkillService')

const SKILLS_PLUGIN_MANIFEST = `${JSON.stringify({ name: 'cherry-studio-skills' }, null, 2)}\n`
const BUILTIN_VERSION_FILE = '.version'

type SkillRemoteUpdateErrorCode = (typeof skillErrorCodes)[keyof typeof skillErrorCodes]

export class SkillRemoteUpdateError extends Error {
  constructor(
    readonly code: SkillRemoteUpdateErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SkillRemoteUpdateError'
  }
}

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
  // Serializes every library mutation — install / uninstall / builtin sync / reconcile — so a
  // reconcile can't read a mid-mutation snapshot (and, e.g., prune a row an install just wrote).
  private readonly mutationLock = new Mutex()
  // Dedupes concurrent reconcile-on-open triggers onto a single run.
  private reconcileInFlight: Promise<void> | null = null

  constructor() {
    this.installer = new SkillInstaller()
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * List installed skills.
   *
   * Without `agentId`, the global catalog includes disabled skills and forces
   * `isEnabled` to false. With `agentId`, globally disabled skills are omitted
   * and `isEnabled` reflects the per-agent state of the remaining skills.
   */
  async getById(id: string): Promise<InstalledSkill | null> {
    return agentGlobalSkillService.getById(id)
  }

  async list(query: ListSkillsQuery = {}): Promise<InstalledSkill[]> {
    return agentGlobalSkillService.list(query)
  }

  /** Enable or disable a skill for a specific agent. */
  toggle(options: SkillToggleOptions): InstalledSkill | null {
    const skill = agentGlobalSkillService.getById(options.skillId)
    if (!skill) return null

    agentGlobalSkillService.upsertJoin(options.agentId, options.skillId, options.isEnabled)

    return { ...skill, isEnabled: options.isEnabled }
  }

  /** Enable a skill across every existing agent. Used when a new builtin skill is installed. */
  enableForAllAgents(skillId: string): void {
    const agentIds = agentGlobalSkillService.upsertJoinForAllAgents(skillId, true)

    logger.info('Enabled skill for all agents', { skillId, agentCount: agentIds.length })
  }

  async uninstallByFolderName(folderName: string): Promise<void> {
    const skill = agentGlobalSkillService.getByFolderName(folderName)
    if (!skill) {
      throw new Error(`Skill not found by folder name: ${folderName}`)
    }
    await this.uninstall(skill.id)
  }

  async getByFolderName(name: string): Promise<InstalledSkill | null> {
    const folderName = sanitizeFolderName(name)
    return agentGlobalSkillService.getByFolderName(folderName)
  }

  /**
   * Resolve the absolute path a skill with the given name would live at under
   * the global Skills storage root.
   */
  getSkillDirectory(name: string): string {
    return this.getSkillStoragePath(sanitizeFolderName(name))
  }

  /** Resolve the app-owned directory for an installed skill. */
  getInstalledSkillDirectory(skill: Pick<InstalledSkill, 'folderName' | 'source' | 'sourceUrl'>): string {
    const rootPath = path.resolve(application.getPath('feature.agents.skills'))
    const skillPath = path.resolve(rootPath, skill.folderName)
    const relativePath = path.relative(rootPath, skillPath)
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`Invalid managed Skill folder: ${skill.folderName}`)
    }
    return skillPath
  }

  /** Local plugin bridge used when the SDK user setting source must remain isolated. */
  getSkillPluginDirectory(): string {
    return path.dirname(this.getMirrorRoot())
  }

  async uninstall(skillId: string): Promise<void> {
    return this.mutationLock.runExclusive(async () => {
      const skill = agentGlobalSkillService.getById(skillId)
      if (!skill) {
        throw new Error(`Skill not found: ${skillId}`)
      }
      await this.uninstallLocked(skill)
    })
  }

  /** Remove an app-owned conditional builtin without touching a colliding user skill. */
  async uninstallBuiltinSkill(folderName: string, namespace: string): Promise<boolean> {
    return this.mutationLock.runExclusive(async () => {
      const skill = this.findCatalogSkillCaseInsensitive(sanitizeFolderName(folderName))
      if (!skill) return false
      if (skill.source !== 'builtin' || skill.namespace !== namespace) {
        throw new Error(
          `Skill folder "${folderName}" is not owned by builtin namespace "${namespace}"; refusing to remove it.`
        )
      }
      await this.uninstallLocked(skill)
      return true
    })
  }

  /**
   * Install from a marketplace installSource handle.
   * Format: "claude-plugins:{owner}/{repo}/{directoryPath}",
   * "skills.sh:{owner}/{repo}/{skillId}", "clawhub:{owner}/{slug}",
   * or "github:{https URL of the skill's SKILL.md}".
   */
  async install(options: SkillInstallOptions): Promise<InstalledSkill> {
    const [source, ...rest] = options.installSource.split(':')
    const fetched = await fetchRemoteSkill(source, rest.join(':'))

    try {
      const installed = await this.installSkillDir(fetched.skillDir, 'marketplace', fetched.sourceUrl, {
        installSource: options.installSource
      })
      fetched.onInstalled?.()
      return installed
    } finally {
      await safeRemoveDirectory(fetched.tempDir)
    }
  }

  async installFromZip(options: SkillInstallFromZipOptions): Promise<InstalledSkill> {
    const { zipFilePath } = options
    logger.info('Installing skill from ZIP', { zipFilePath })

    await validateZipFile(zipFilePath)
    const canonicalZipPath = await fs.promises.realpath(zipFilePath)
    const sourceUrl = pathToFileURL(canonicalZipPath).href
    const tempDir = await createTempDir('zip-install')

    try {
      await extractZip(canonicalZipPath, tempDir)
      const skillDir = await resolveSkillDirectory(tempDir, null, null)
      return await this.installSkillDir(skillDir, 'zip', sourceUrl)
    } finally {
      await safeRemoveDirectory(tempDir)
    }
  }

  async installFromDirectory(options: SkillInstallFromDirectoryOptions): Promise<InstalledSkill> {
    const { directoryPath } = options
    logger.info('Installing skill from directory', { directoryPath })

    if (!(await directoryExists(directoryPath))) {
      throw new Error(`Directory not found: ${directoryPath}`)
    }

    const canonicalPath = await fs.promises.realpath(directoryPath)
    return this.installSkillDir(canonicalPath, 'local', pathToFileURL(canonicalPath).href)
  }

  /** List user-owned workspace skills from supported project skill roots. */
  async listLocal(workdir: string): Promise<Array<{ name: string; description?: string; filename: string }>> {
    const results: Array<{ name: string; description?: string; filename: string }> = []

    for (const skill of await this.listLocalSkillDirectories(workdir)) {
      try {
        const metadata = await parseSkillMetadata(skill.path, skill.name, 'skills', {
          calculateSize: false
        })
        results.push({ name: metadata.name, description: metadata.description, filename: skill.name })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        logger.warn('Failed to parse skill metadata; skipping', {
          skillsDir: path.dirname(skill.path),
          entry: skill.name,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return results
  }

  /**
   * List only the directory names needed by the Claude SDK skills whitelist.
   * The SDK owns SKILL.md parsing; this path only verifies that a skill file
   * exists after applying the same local/symlink ownership filter as listLocal.
   */
  async listLocalFolderNames(workdir: string): Promise<string[]> {
    const names: string[] = []
    for (const skill of await this.listLocalSkillDirectories(workdir)) {
      if (await findSkillMdPath(skill.path)) names.push(skill.name)
    }
    return names
  }

  /** Resolve workspace skill directories for runtimes that accept explicit skill paths. */
  async listLocalSkillPaths(workdir: string): Promise<string[]> {
    const paths: string[] = []
    for (const skill of await this.listLocalSkillDirectories(workdir)) {
      if (await findSkillMdPath(skill.path)) paths.push(skill.path)
    }
    return paths
  }

  private async listLocalSkillDirectories(workdir: string): Promise<Array<{ name: string; path: string }>> {
    const results: Array<{ name: string; path: string }> = []
    const seenNames = new Set<string>()

    // Keep the existing Claude-specific root first when duplicate folder names exist.
    for (const skillsDir of [path.join(workdir, '.claude', 'skills'), path.join(workdir, '.agents', 'skills')]) {
      try {
        const entries = await fs.promises.readdir(skillsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (seenNames.has(entry.name) || !(await this.isLocalSkillDirectoryEntry(skillsDir, entry))) continue
          seenNames.add(entry.name)
          results.push({ name: entry.name, path: path.join(skillsDir, entry.name) })
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        logger.warn('Failed to enumerate skills directory', {
          skillsDir,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return results
  }

  /** Discover skills in known system-level CLI directories without copying them. */
  async discoverSystem(): Promise<SystemSkillCandidate[]> {
    const env = await getShellEnv()
    const sources = buildSystemSkillSources(application.getPath('sys.home'), env)
    const installed = agentGlobalSkillService.list()
    const installedByPath = new Map(
      installed.flatMap((skill) => {
        if (skill.source !== 'system' || !skill.sourceUrl?.startsWith('file:')) return []
        try {
          return [[fileURLToPath(skill.sourceUrl), skill] as const]
        } catch {
          return []
        }
      })
    )
    const installedByFolder = new Map(installed.map((skill) => [normalizeFolderKey(skill.folderName), skill]))
    const managedRoot = await fs.promises
      .realpath(application.getPath('feature.agents.skills'))
      .catch(() => path.resolve(application.getPath('feature.agents.skills')))
    const mirrorRoot = path.resolve(this.getMirrorRoot())
    const candidates = new Map<string, SystemSkillCandidate>()

    for (const source of sources) {
      if (path.resolve(source.directoryPath) === mirrorRoot) continue

      const skillDirectories = await findAllSkillDirectories(source.directoryPath, source.directoryPath)
      for (const skillDirectory of skillDirectories) {
        const entryPath = skillDirectory.folderPath
        try {
          const canonicalPath = await fs.promises.realpath(entryPath)
          if (canonicalPath === managedRoot || canonicalPath.startsWith(managedRoot + path.sep)) continue

          const placement: SystemSkillPlacement = {
            sourceId: source.id,
            sourceName: source.name,
            directoryPath: entryPath
          }
          const duplicate = candidates.get(canonicalPath)
          if (duplicate) {
            duplicate.placements.push(placement)
            continue
          }

          const metadata = await parseSkillMetadata(canonicalPath, skillDirectory.sourcePath, 'skills', {
            calculateSize: false
          })
          const folderName = sanitizeFolderName(metadata.filename)
          const registered = installedByPath.get(canonicalPath)
          const folderConflict = installedByFolder.get(normalizeFolderKey(folderName))
          const status = registered ? 'registered' : folderConflict ? 'conflict' : 'available'

          candidates.set(canonicalPath, {
            id: createHash('sha256').update(canonicalPath).digest('hex'),
            name: metadata.name,
            description: metadata.description,
            filename: folderName,
            directoryPath: canonicalPath,
            placements: [placement],
            status,
            registeredSkillId: registered?.id
          })
        } catch (error) {
          logger.warn('Failed to inspect system skill; skipping', {
            sourceId: source.id,
            directoryPath: entryPath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }

    return Array.from(candidates.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Import a discovered system skill into the managed library. Agent enablement is a separate data mutation. */
  async importSystem(options: SkillImportSystemOptions): Promise<InstalledSkill> {
    const canonicalPath = await fs.promises.realpath(options.directoryPath)
    const candidates = await this.discoverSystem()
    const candidate = candidates.find((item) => item.directoryPath === canonicalPath)
    if (!candidate) {
      throw new Error(`Directory is not a discovered system skill: ${options.directoryPath}`)
    }
    if (candidate.registeredSkillId) {
      throw new Error(`System skill is already imported: ${candidate.filename}`)
    }
    if (candidate.status === 'conflict') {
      throw new Error(`A different skill already uses the folder name: ${candidate.filename}`)
    }

    const installed = await this.installSkillDir(canonicalPath, 'system', pathToFileURL(canonicalPath).href, {
      namespace: candidate.placements[0]?.sourceId ?? null
    })

    logger.info('System skill installed from local CLI', {
      skillId: installed.id,
      folderName: installed.folderName,
      directoryPath: canonicalPath
    })
    return installed
  }

  /**
   * `listLocal` is only for user/project-owned workspace skills that already
   * live under `.claude/skills/` or `.agents/skills/`. Those entries can be real directories or
   * user-created symlinks to directories.
   *
   * Cherry-managed skills also appear under `.claude/skills/` as app-owned mirror
   * entries when enabled for Claude SDK discovery, but their source of truth is
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

  // ===========================================================================
  // Core install logic
  // ===========================================================================

  private installSkillDir(
    skillDir: string,
    source: string,
    sourceUrl: string | null,
    provenance: { namespace?: string | null; installSource?: string | null } = {}
  ): Promise<InstalledSkill> {
    // Serialize against reconcile / uninstall / builtin sync so a concurrent reconcile can't see
    // this install's transient `.bak` / half-copied state and then prune or mis-adopt the row.
    return this.mutationLock.runExclusive(() => this.installSkillDirLocked(skillDir, source, sourceUrl, provenance))
  }

  private async installSkillDirLocked(
    skillDir: string,
    source: string,
    sourceUrl: string | null,
    provenance: { namespace?: string | null; installSource?: string | null } = {}
  ): Promise<InstalledSkill> {
    const metadata = await parseSkillMetadata(skillDir, path.basename(skillDir), 'skills')

    const skillsRoot = path.resolve(application.getPath('feature.agents.skills'))
    const isInPlace = path.resolve(path.dirname(skillDir)) === skillsRoot
    const folderName = isInPlace ? path.basename(skillDir) : sanitizeFolderName(metadata.filename)

    const existing = this.findCatalogSkillCaseInsensitive(folderName)
    if (existing) {
      // Only a re-install of the exact same skill (same source + origin URL) may overwrite the
      // existing folder in place. Anything else — a marketplace install colliding with a builtin,
      // system, local, or different-origin skill of the same folder name — is a conflict, not a
      // silent replace: overwriting would clobber the files while the DB row keeps the old source
      // (e.g. a third-party `skill-creator` replacing the builtin, which then stays
      // enabled-for-all-agents), or irrecoverably destroy the user's own local skill.
      const sameOrigin = existing.source === source && (existing.sourceUrl ?? null) === (sourceUrl ?? null)
      if (!sameOrigin) {
        throw new Error(
          `Folder name "${folderName}" is already used by a ${existing.source} skill; ` +
            `refusing to overwrite it with a ${source} install.`
        )
      }
    }

    const storageEntry = await this.findStorageFolderCaseInsensitive(folderName)
    if (!existing && storageEntry) {
      throw new Error(
        `Folder name "${folderName}" conflicts with an existing library directory "${storageEntry}"; ` +
          'reconcile or remove that directory before installing.'
      )
    }
    if (existing && storageEntry && storageEntry !== existing.folderName) {
      throw new Error(
        `Catalog folder "${existing.folderName}" conflicts with library directory "${storageEntry}" by case; ` +
          'reconcile the library before installing.'
      )
    }

    const contentHash = await this.installer.computeContentHash(skillDir)
    const upstreamHash = provenance.installSource ? await this.installer.computeDirectoryHash(skillDir) : null
    const destFolderName = existing?.folderName ?? folderName
    const destPath = this.getSkillStoragePath(destFolderName)

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await this.installer.install(skillDir, destPath)
    await this.linkMirror(destFolderName)

    const tags = metadata.tags ?? []

    if (existing) {
      // Update metadata in-place to preserve the skill ID and its agent_skills rows.
      application.get('DbService').withWriteTx((tx) => {
        agentGlobalSkillService.updateTx(tx, existing.id, {
          name: metadata.name,
          description: metadata.description ?? null,
          author: metadata.author ?? null,
          version: metadata.version ?? null,
          tags,
          contentHash,
          ...(source === 'marketplace'
            ? { sourceUrl, installSource: provenance.installSource ?? null, upstreamHash }
            : {}),
          ...(source === 'system' ? { sourceUrl, namespace: provenance.namespace ?? null } : {})
        })
      })
      const updated = agentGlobalSkillService.getById(existing.id)!
      logger.info('Skill updated', { id: existing.id, name: metadata.name, folderName: destFolderName, source })
      return updated
    }

    const isBuiltin = source === 'builtin'

    let inserted: InstalledSkill | undefined
    try {
      application.get('DbService').withWriteTx((tx) => {
        const insertedRow = agentGlobalSkillService.insertTx(tx, {
          name: metadata.name,
          description: metadata.description ?? null,
          folderName: destFolderName,
          source,
          sourceUrl,
          namespace: provenance.namespace ?? null,
          author: metadata.author ?? null,
          version: metadata.version ?? null,
          tags,
          contentHash,
          installSource: provenance.installSource ?? null,
          upstreamHash
        })
        inserted = agentGlobalSkillService.getById(insertedRow.id) ?? undefined
      })
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
      this.enableForAllAgents(inserted.id)
    }

    logger.info('Skill installed', { id: inserted.id, name: metadata.name, folderName: destFolderName, source })
    return inserted
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
  // (`feature.agents.claude.skills` = <userData>/Data/Agents/.claude/skills).
  // We keep that directory as a mirror of the owned `Data/Skills` library,
  // maintained at install / uninstall / startup reconcile — NOT per session.
  // The SDK's `Options.skills` is only a name whitelist, so the files must
  // physically live here for a whitelisted name to load.
  // ===========================================================================

  private getMirrorRoot(): string {
    return application.getPath('feature.agents.claude.skills')
  }

  private getMirrorPath(folderName: string): string {
    return path.join(this.getMirrorRoot(), folderName)
  }

  private async ensureSkillPluginManifest(): Promise<void> {
    const manifestDirectory = path.join(this.getSkillPluginDirectory(), '.claude-plugin')
    await fs.promises.mkdir(manifestDirectory, { recursive: true })
    await fs.promises.writeFile(path.join(manifestDirectory, 'plugin.json'), SKILLS_PLUGIN_MANIFEST, 'utf-8')
  }

  /** Mirror `Data/Skills/<folderName>` into CLAUDE_CONFIG_DIR/skills. Idempotent. */
  async linkMirror(folderName: string, options: { throwOnError?: boolean } = {}): Promise<void> {
    const sourceDir = this.getSkillStoragePath(folderName)
    const rootDir = path.resolve(this.getMirrorRoot())
    const targetDir = path.resolve(rootDir, folderName)
    const relativeTarget = path.relative(rootDir, targetDir)
    if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      logger.warn('Refusing to mirror skill outside Claude config root', { folderName, targetDir })
      return
    }

    let catalogSkill: InstalledSkill | null
    try {
      catalogSkill = this.findCatalogSkillCaseInsensitive(folderName)
    } catch (error) {
      await this.unlinkMirror(folderName)
      logger.warn('Refusing to mirror a case-ambiguous catalog skill', {
        folderName,
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }

    // Accept either casing so a lowercase-only skill still mirrors (reconcile normalizes to
    // SKILL.md, but install paths may not have run yet) — otherwise it would be in the catalog
    // but absent from the mirror the SDK loads.
    const descriptor = await this.readSkillMdState(sourceDir)
    if (descriptor.status !== 'found') {
      await this.unlinkMirror(folderName)
      logger.warn('Skill source descriptor unavailable; removed mirror', {
        folderName,
        sourceDir,
        status: descriptor.status
      })
      return
    }

    const builtinSkill = catalogSkill?.source === 'builtin' ? catalogSkill : null
    const isBuiltin = builtinSkill !== null
    if (builtinSkill) {
      try {
        const actualHash = await this.computeBuiltinDirectoryHash(sourceDir)
        if (actualHash !== builtinSkill.contentHash) {
          await this.unlinkMirror(folderName)
          logger.warn('Refusing to mirror modified built-in skill content', { folderName })
          return
        }
      } catch (error) {
        await this.unlinkMirror(folderName)
        logger.warn('Failed to verify built-in skill content; removed mirror', {
          folderName,
          error: error instanceof Error ? error.message : String(error)
        })
        return
      }
    }

    try {
      await fs.promises.mkdir(rootDir, { recursive: true })

      // Builtins are copied even on POSIX. A symlink would expose direct writes to the canonical
      // authoring root immediately to every other agent before reconcile can reject the change.
      if (!isWin && !isBuiltin) {
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
      if (isWin || isBuiltin) {
        // Windows avoids symlink/junction privilege quirks; builtins use a verified copy so
        // out-of-band writes to the authoring root cannot change another agent's loaded instructions.
        await fs.promises.cp(sourceDir, targetDir, { recursive: true, force: true })
      } else {
        await fs.promises.symlink(sourceDir, targetDir, 'dir')
      }
    } catch (error) {
      logger.warn('Failed to mirror skill to Claude config', { folderName, sourceDir, targetDir, error })
      if (options.throwOnError) throw error
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
   * Reconcile the managed skill library (Data/Skills) with the DB catalog and the
   * CLAUDE_CONFIG_DIR/skills mirror. The filesystem is the source of truth for
   * user-authored skills; builtins remain owned by the bundled source and are never
   * reclassified from direct filesystem writes. Agents write new skills directly to the
   * managed library exposed by CHERRY_STUDIO_SKILLS_DIR; reconcile projects that library
   * into the catalog and the read-only Claude config mirror.
   *
   * 1. library → DB: adopt newly-present library skills, refresh changed ones, and
   *    prune non-builtin rows whose files have vanished. Pruning is gated on a
   *    successful library scan so a transient read error can't wipe the catalog.
   * 2. DB → mirror: heal every trusted catalog mirror entry and drop managed orphans.
   *
   * Idempotent. Mutations never happen at session build, so concurrent session
   * builds only read these directories.
   */
  async reconcileSkills(): Promise<void> {
    // Single-flight: reconcile-on-open can fire from several UI entry points at once — dedupe
    // them onto one run instead of stampeding the filesystem and DB.
    if (this.reconcileInFlight) return this.reconcileInFlight
    // Under the mutation lock so reconcile can't interleave with install / uninstall / builtin
    // sync (which would let it read a stale snapshot and prune a just-installed row).
    this.reconcileInFlight = this.mutationLock
      .runExclusive(async () => {
        const storageRoot = application.getPath('feature.agents.skills')
        await this.installer.recoverInterruptedInstalls(storageRoot)
        try {
          await this.ensureSkillPluginManifest()
        } catch (error) {
          logger.warn('Failed to prepare external CLI skill plugin bridge', { error })
        }
        await this.reconcileLibraryToDb()
        await this.reconcileMirror()
      })
      .finally(() => {
        this.reconcileInFlight = null
      })
    return this.reconcileInFlight
  }

  async reconcileSkill(skillId: string): Promise<void> {
    await this.mutationLock.runExclusive(() => this.reconcileSkillLocked(skillId))
  }

  private async reconcileSkillLocked(skillId: string): Promise<void> {
    const skill = agentGlobalSkillService.getById(skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)
    if (skill.source === 'builtin') throw new Error(`Built-in Skill is read-only: ${skill.folderName}`)

    const skillDir = this.getSkillStoragePath(skill.folderName)
    let stats: fs.Stats
    try {
      stats = await fs.promises.lstat(skillDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      agentGlobalSkillService.deleteById(skillId)
      await this.unlinkMirror(skill.folderName)
      agentGlobalSkillService.notifySkillMembershipChange(skillId)
      logger.info('Pruned missing Skill during scoped reconcile', { skillId, folderName: skill.folderName })
      return
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Managed Skill path is not a directory: ${skill.folderName}`)
    }

    await this.normalizeSkillMdCasing(skillDir)
    const descriptor = await this.readSkillMdState(skillDir)
    if (descriptor.status !== 'found') {
      await this.unlinkMirror(skill.folderName)
      throw new Error(`Skill descriptor is ${descriptor.status}: ${skill.folderName}`)
    }

    let metadata: Awaited<ReturnType<typeof parseSkillMetadata>>
    try {
      metadata = await parseSkillMetadata(skillDir, skill.folderName, 'skills')
    } catch (error) {
      await this.unlinkMirror(skill.folderName)
      throw error
    }

    agentGlobalSkillService.update(skillId, {
      name: metadata.name,
      description: metadata.description ?? null,
      author: metadata.author ?? null,
      version: metadata.version ?? null,
      tags: metadata.tags ?? [],
      contentHash: createHash('sha256').update(descriptor.content).digest('hex')
    })
    await this.linkMirror(skill.folderName, { throwOnError: true })
    agentGlobalSkillService.notifySkillProjectionChange(skillId)
    logger.info('Scoped Skill reconcile completed', { skillId, folderName: skill.folderName })
  }

  async checkRemoteUpdate(skillId: string): Promise<SkillRemoteUpdateCheck> {
    const record = agentGlobalSkillService.getByIdWithProvenance(skillId)
    if (!record) throw new Error(`Skill not found: ${skillId}`)
    if (record.skill.source !== 'marketplace') return { state: 'unsupported', reason: 'not_remote' }
    if (!record.installSource || !record.upstreamHash) {
      return { state: 'unsupported', reason: 'missing_provenance' }
    }

    const fetched = await this.fetchRemote(record.installSource)
    try {
      const [currentHash, remoteHash, metadata] = await Promise.all([
        this.installer.computeDirectoryHash(this.getSkillStoragePath(record.skill.folderName)),
        this.installer.computeDirectoryHash(fetched.skillDir),
        parseSkillMetadata(fetched.skillDir, record.skill.folderName, 'skills')
      ])
      const localChanges = currentHash !== record.upstreamHash
      if (remoteHash === record.upstreamHash) {
        return { state: 'up_to_date', localChanges, remoteVersion: metadata.version ?? null }
      }
      return {
        state: 'available',
        localChanges,
        remoteVersion: metadata.version ?? null,
        revision: this.createRemoteRevision({
          skillId,
          installSource: record.installSource,
          upstreamHash: record.upstreamHash,
          currentHash,
          remoteHash
        })
      }
    } finally {
      await safeRemoveDirectory(fetched.tempDir)
    }
  }

  async applyRemoteUpdate(options: {
    skillId: string
    revision: string
    overwriteLocalChanges: boolean
  }): Promise<InstalledSkill> {
    const record = agentGlobalSkillService.getByIdWithProvenance(options.skillId)
    if (!record) throw new Error(`Skill not found: ${options.skillId}`)
    if (record.skill.source !== 'marketplace' || !record.installSource || !record.upstreamHash) {
      throw new SkillRemoteUpdateError(skillErrorCodes.REMOTE_UNSUPPORTED, 'Skill has no supported remote source')
    }

    const fetched = await this.fetchRemote(record.installSource)
    try {
      const [remoteHash, metadata, contentHash] = await Promise.all([
        this.installer.computeDirectoryHash(fetched.skillDir),
        parseSkillMetadata(fetched.skillDir, record.skill.folderName, 'skills'),
        this.installer.computeContentHash(fetched.skillDir)
      ])

      return await this.mutationLock.runExclusive(async () => {
        const currentRecord = agentGlobalSkillService.getByIdWithProvenance(options.skillId)
        if (
          !currentRecord ||
          currentRecord.skill.source !== 'marketplace' ||
          !currentRecord.installSource ||
          currentRecord.installSource !== record.installSource ||
          !currentRecord.upstreamHash
        ) {
          throw new SkillRemoteUpdateError(skillErrorCodes.REMOTE_STALE, 'Skill update provenance changed')
        }

        const destination = this.getSkillStoragePath(currentRecord.skill.folderName)
        const currentHash = await this.installer.computeDirectoryHash(destination)
        const revision = this.createRemoteRevision({
          skillId: options.skillId,
          installSource: currentRecord.installSource,
          upstreamHash: currentRecord.upstreamHash,
          currentHash,
          remoteHash
        })
        if (revision !== options.revision || remoteHash === currentRecord.upstreamHash) {
          throw new SkillRemoteUpdateError(skillErrorCodes.REMOTE_STALE, 'Skill update check is stale')
        }

        const hasLocalChanges = currentHash !== currentRecord.upstreamHash
        if (hasLocalChanges && !options.overwriteLocalChanges) {
          throw new SkillRemoteUpdateError(
            skillErrorCodes.REMOTE_LOCAL_CHANGES,
            'Skill has local changes that require explicit overwrite'
          )
        }

        await this.installer.install(fetched.skillDir, destination)
        agentGlobalSkillService.update(options.skillId, {
          name: metadata.name,
          description: metadata.description ?? null,
          author: metadata.author ?? null,
          version: metadata.version ?? null,
          tags: metadata.tags ?? [],
          sourceUrl: fetched.sourceUrl,
          contentHash,
          installSource: currentRecord.installSource,
          upstreamHash: remoteHash
        })
        await this.linkMirror(currentRecord.skill.folderName, { throwOnError: true })

        const updated = agentGlobalSkillService.getById(options.skillId)
        if (!updated) throw new Error(`Skill disappeared after remote update: ${options.skillId}`)
        agentGlobalSkillService.notifySkillProjectionChange(options.skillId)
        logger.info('Remote Skill update applied', {
          skillId: options.skillId,
          folderName: currentRecord.skill.folderName,
          overwriteLocalChanges: options.overwriteLocalChanges
        })
        return updated
      })
    } finally {
      await safeRemoveDirectory(fetched.tempDir)
    }
  }

  private fetchRemote(installSource: string) {
    const [source, ...identifier] = installSource.split(':')
    return fetchRemoteSkill(source, identifier.join(':'))
  }

  private createRemoteRevision(input: {
    skillId: string
    installSource: string
    upstreamHash: string
    currentHash: string
    remoteHash: string
  }): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex')
  }

  /**
   * Reconcile the managed library (Data/Skills) with the `agent_global_skill`
   * catalog: adopt skills present on disk but missing a row, refresh non-builtin rows
   * whose SKILL.md changed, and prune non-builtin rows whose files are gone. Builtins
   * are owned by `installBuiltinSkills`; direct changes are not adopted and fail mirror
   * integrity checks. Presence and authored-skill change detection read SKILL.md directly.
   */
  private async reconcileLibraryToDb(): Promise<void> {
    const storageRoot = application.getPath('feature.agents.skills')
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(storageRoot, { withFileTypes: true })
    } catch (error) {
      // A whole-root read failure (or a not-yet-created root) is transient — never
      // prune on it, or a hiccup would drop every skill and its enablement.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Failed to scan skill library; skipping DB reconcile', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
      return
    }

    const dbSkills = agentGlobalSkillService.listAll()
    const dbGroups = new Map<string, InstalledSkill[]>()
    for (const skill of dbSkills) {
      const key = normalizeFolderKey(skill.folderName)
      const group = dbGroups.get(key)
      if (group) group.push(skill)
      else dbGroups.set(key, [skill])
    }
    const dbByFolder = new Map(
      [...dbGroups.entries()].flatMap(([key, group]) => (group.length === 1 ? [[key, group[0]] as const] : []))
    )
    const conflictingDbKeys = new Set<string>()
    for (const [folderKey, group] of dbGroups) {
      if (group.length > 1) {
        conflictingDbKeys.add(folderKey)
        logger.warn('Rejected case-colliding skill catalog rows during reconcile', {
          folderKey,
          folderNames: group.map((skill) => skill.folderName)
        })
      }
    }
    const onDisk = new Map<string, string>()
    // Every skill folder physically enumerated on disk, regardless of whether its descriptor is
    // currently readable. Pruning keys off THIS set, not off a successful descriptor read: an editor
    // saving a SKILL.md atomically briefly removes it (both casings ENOENT), and that transient
    // window must not be mistaken for the skill being deleted — which would cascade-delete the
    // catalog row and every agent's enablement via the agent_skill FK.
    const presentFolders = new Set<string>()
    const directoryGroups = new Map<string, fs.Dirent[]>()
    for (const entry of entries) {
      // Hidden entries (an install's `.<name>.bak` backup, temporary dirs, …) are bookkeeping, never
      // skills — skip them so a backup can't be adopted as a phantom skill.
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink()) {
        logger.warn('Rejected symlink in managed skill library', { folderName: entry.name })
        try {
          await fs.promises.unlink(path.join(storageRoot, entry.name))
        } catch (error) {
          logger.warn('Failed to remove rejected managed-library symlink', {
            folderName: entry.name,
            error: error instanceof Error ? error.message : String(error)
          })
        }
        continue
      }
      if (!entry.isDirectory()) continue
      const folderKey = normalizeFolderKey(entry.name)
      const group = directoryGroups.get(folderKey)
      if (group) group.push(entry)
      else directoryGroups.set(folderKey, [entry])
    }

    for (const [folderKey, group] of directoryGroups) {
      presentFolders.add(folderKey)
      if (group.length > 1) {
        logger.warn('Rejected case-colliding skill library folders', {
          folderNames: group.map((entry) => entry.name)
        })
        continue
      }
      const [entry] = group
      const dir = path.join(storageRoot, entry.name)
      // The scanner/parser accept lowercase `skill.md`, but the mirror + SDK load `SKILL.md`, so
      // normalize first — else a lowercase-only skill enters the catalog yet never loads.
      await this.normalizeSkillMdCasing(dir)
      const read = await this.readSkillMdState(dir)
      if (read.status === 'found') {
        onDisk.set(entry.name, createHash('sha256').update(read.content).digest('hex'))
      } else if (read.status === 'error') {
        logger.warn('Skill descriptor unreadable during reconcile; keeping any catalog row', {
          folderName: entry.name
        })
      }
      // 'found' → adopt/refresh below. 'missing'/'error' → present folder with no usable descriptor:
      // not adopted, and the presentFolders guard below keeps any existing row + enablement intact.
    }

    for (const [folderName, contentHash] of onDisk) {
      const folderKey = normalizeFolderKey(folderName)
      if (conflictingDbKeys.has(folderKey)) continue

      const existing = dbByFolder.get(folderKey)
      if (existing?.source === 'builtin') {
        // Builtins are owned by the bundled source and synchronized before reconcile. Never adopt
        // out-of-band writes as new trusted builtin metadata; linkMirror verifies the full directory
        // hash and removes the mirror when canonical content no longer matches the trusted DB hash.
        continue
      }
      if (existing && existing.contentHash === contentHash) continue

      let metadata: Awaited<ReturnType<typeof parseSkillMetadata>>
      try {
        metadata = await parseSkillMetadata(path.join(storageRoot, folderName), folderName, 'skills')
      } catch (error) {
        logger.warn('Failed to parse library skill during reconcile; skipping', {
          folderName,
          error: error instanceof Error ? error.message : String(error)
        })
        continue
      }
      if (!metadata) continue
      const tags = metadata.tags ?? []

      if (existing) {
        agentGlobalSkillService.update(existing.id, {
          name: metadata.name,
          description: metadata.description ?? null,
          author: metadata.author ?? null,
          version: metadata.version ?? null,
          tags,
          contentHash
        })
      } else {
        agentGlobalSkillService.insert({
          name: metadata.name,
          description: metadata.description ?? null,
          folderName,
          source: 'local',
          sourceUrl: null,
          namespace: null,
          author: metadata.author ?? null,
          version: metadata.version ?? null,
          tags,
          contentHash
        })
        logger.info('Adopted library skill into catalog', { folderName })
      }
    }

    for (const skill of dbSkills) {
      if (skill.source === 'builtin') continue
      // Prune ONLY when the whole folder is gone from disk. A present folder whose descriptor is
      // momentarily missing/unreadable (atomic save, EACCES) keeps its row — see presentFolders.
      if (presentFolders.has(normalizeFolderKey(skill.folderName))) continue
      // Agent file tools write outside mutationLock. Recheck the canonical path immediately before
      // deleting so a folder recreated after the initial readdir snapshot keeps its row and all
      // agent_skill enablement.
      try {
        await fs.promises.lstat(this.getSkillStoragePath(skill.folderName))
        continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('Failed to verify missing skill folder; keeping catalog row', {
            folderName: skill.folderName,
            error: error instanceof Error ? error.message : String(error)
          })
          continue
        }
      }
      agentGlobalSkillService.deleteById(skill.id)
      await this.unlinkMirror(skill.folderName)
      logger.info('Pruned skill whose library folder was removed', { folderName: skill.folderName })
    }
  }

  /**
   * Heal the app-owned CLAUDE_CONFIG_DIR/skills mirror and drop entries whose DB row
   * is gone. POSIX authored skills use symlinks; Windows skills and builtins use copies.
   */
  private async reconcileMirror(): Promise<void> {
    const all = agentGlobalSkillService.listAll()
    const known = new Set(all.map((s) => normalizeFolderKey(s.folderName)))
    const groups = new Map<string, InstalledSkill[]>()
    for (const skill of all) {
      const key = normalizeFolderKey(skill.folderName)
      const group = groups.get(key)
      if (group) group.push(skill)
      else groups.set(key, [skill])
    }

    for (const [folderKey, group] of groups) {
      if (group.length > 1) {
        logger.warn('Removed mirrors for case-ambiguous catalog skills', {
          folderKey,
          folderNames: group.map((skill) => skill.folderName)
        })
        for (const skill of group) {
          await this.unlinkMirror(skill.folderName)
        }
        continue
      }
      await this.linkMirror(group[0].folderName)
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
      if (known.has(normalizeFolderKey(folderName))) continue

      // This is an app-owned one-way projection. Unknown entries are either stale POSIX symlinks,
      // stale Windows directory copies, or out-of-band writes; none belong in the SDK discovery root.
      await this.unlinkMirror(folderName)
    }
  }

  /**
   * Read a skill descriptor with a three-state result so a transient read failure is not mistaken
   * for deletion: `found` (content), `missing` (no SKILL.md at all — ENOENT for both casings), or
   * `error` (a descriptor exists but reading it threw — EACCES / EIO / atomic-replace window).
   */
  private async readSkillMdState(
    dir: string
  ): Promise<{ status: 'found'; content: string } | { status: 'missing' } | { status: 'error' }> {
    let sawError = false
    for (const variant of ['SKILL.md', 'skill.md']) {
      try {
        return { status: 'found', content: await fs.promises.readFile(path.join(dir, variant), 'utf-8') }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') sawError = true
      }
    }
    return sawError ? { status: 'error' } : { status: 'missing' }
  }

  /**
   * Normalize a library skill's descriptor to the SDK's expected `SKILL.md` casing. The scanner
   * and parser accept lowercase `skill.md`, but the mirror + SDK load `SKILL.md`, so a lowercase-only
   * skill would enter the catalog yet never load. No-op when an uppercase descriptor already
   * resolves (including on case-insensitive filesystems, where the two names are the same file).
   */
  private async normalizeSkillMdCasing(dir: string): Promise<void> {
    try {
      await fs.promises.access(path.join(dir, 'SKILL.md'))
      return
    } catch {
      // No uppercase descriptor resolves — check for a lowercase one to rename.
    }
    try {
      await fs.promises.access(path.join(dir, 'skill.md'))
    } catch {
      return
    }
    try {
      await fs.promises.rename(path.join(dir, 'skill.md'), path.join(dir, 'SKILL.md'))
      logger.info('Normalized skill descriptor to SKILL.md', { dir })
    } catch (error) {
      logger.warn('Failed to normalize skill descriptor casing', {
        dir,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private computeBuiltinDirectoryHash(skillDir: string): Promise<string> {
    return this.installer.computeDirectoryHash(skillDir, {
      ignoredRelativePaths: [BUILTIN_VERSION_FILE]
    })
  }

  private findCatalogSkillCaseInsensitive(folderName: string): InstalledSkill | null {
    const key = normalizeFolderKey(folderName)
    const matches = agentGlobalSkillService.listAll().filter((skill) => normalizeFolderKey(skill.folderName) === key)
    if (matches.length > 1) {
      throw new Error(
        `Multiple catalog skills conflict by case for "${folderName}": ${matches.map((skill) => skill.folderName).join(', ')}`
      )
    }
    return matches[0] ?? null
  }

  private async findStorageFolderCaseInsensitive(folderName: string): Promise<string | null> {
    const storageRoot = application.getPath('feature.agents.skills')
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(storageRoot, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const key = normalizeFolderKey(folderName)
    const matches = entries.filter((entry) => !entry.name.startsWith('.') && normalizeFolderKey(entry.name) === key)
    if (matches.length > 1) {
      throw new Error(
        `Multiple library directories conflict by case for "${folderName}": ${matches.map((entry) => entry.name).join(', ')}`
      )
    }
    return matches[0]?.name ?? null
  }

  /**
   * Atomically publish a bundled skill and synchronize its DB row under the
   * same library mutation lock used by install, uninstall, and reconcile.
   *
   * - If the row exists and files weren't updated, no-ops.
   * - If files were updated, refreshes the metadata row in-place.
   * - If the row is missing (first install), inserts it.
   *
   * Per-agent enablement needs no fan-out here: `AgentGlobalSkillService.list()`
   * defaults a builtin skill to enabled for every agent until a user explicitly
   * toggles it off, so a fresh `agent_global_skill` row is enabled everywhere —
   * for existing and future agents alike — without any `agent_skill` rows.
   */
  async syncBuiltinSkill(
    folderName: string,
    sourcePath: string,
    appVersion: string,
    namespace: string | null = null
  ): Promise<boolean> {
    return this.mutationLock.runExclusive(async () => {
      const existing = this.findCatalogSkillCaseInsensitive(folderName)
      if (existing && existing.source !== 'builtin') {
        throw new Error(
          `Folder name "${folderName}" is already used by a ${existing.source} skill; refusing to overwrite it with a builtin.`
        )
      }
      if (existing && existing.namespace !== namespace) {
        throw new Error(
          `Folder name "${folderName}" belongs to builtin namespace "${existing.namespace ?? 'default'}"; ` +
            `refusing to overwrite it with "${namespace ?? 'default'}".`
        )
      }

      const storageEntry = await this.findStorageFolderCaseInsensitive(folderName)
      const destFolderName = existing?.folderName ?? storageEntry ?? folderName
      const destPath = this.getSkillStoragePath(destFolderName)
      const sourceHash = await this.computeBuiltinDirectoryHash(sourcePath)
      if (!existing && storageEntry) {
        try {
          await fs.promises.access(path.join(destPath, BUILTIN_VERSION_FILE))
          const installedHash = await this.computeBuiltinDirectoryHash(destPath)
          if (installedHash !== sourceHash) {
            throw new Error('content does not match the bundled builtin')
          }
        } catch {
          throw new Error(
            `Folder name "${folderName}" conflicts with an existing user-authored library directory "${storageEntry}".`
          )
        }
      }

      let filesUpdated = true
      try {
        const installedVersion = (await fs.promises.readFile(path.join(destPath, BUILTIN_VERSION_FILE), 'utf-8')).trim()
        const installedHash = await this.computeBuiltinDirectoryHash(destPath)
        filesUpdated = installedVersion !== appVersion || installedHash !== sourceHash
      } catch {
        filesUpdated = true
      }

      if (filesUpdated) {
        await this.installer.install(sourcePath, destPath)
        await fs.promises.writeFile(path.join(destPath, BUILTIN_VERSION_FILE), appVersion, 'utf-8')
      }

      // Builtin contentHash is the trusted full-directory hash (excluding Cherry's version marker),
      // unlike authored skills whose hash tracks SKILL.md metadata changes.
      if (existing && !filesUpdated && existing.contentHash === sourceHash) return false

      const metadata = await parseSkillMetadata(destPath, folderName, 'skills')
      const tags = metadata.tags ?? []

      if (existing) {
        agentGlobalSkillService.update(existing.id, {
          name: metadata.name,
          description: metadata.description ?? null,
          author: metadata.author ?? null,
          version: metadata.version ?? null,
          tags,
          contentHash: sourceHash,
          namespace
        })
      } else {
        agentGlobalSkillService.insert({
          name: metadata.name,
          description: metadata.description ?? null,
          folderName: destFolderName,
          source: 'builtin',
          sourceUrl: null,
          namespace,
          author: metadata.author ?? null,
          version: metadata.version ?? null,
          tags,
          contentHash: sourceHash
        })
      }

      await this.linkMirror(destFolderName)
      logger.info('Built-in skill synced to DB', { folderName: destFolderName, firstInstall: !existing, filesUpdated })
      return filesUpdated
    })
  }

  private async uninstallLocked(skill: InstalledSkill): Promise<void> {
    const skillPath = this.getSkillStoragePath(skill.folderName)
    await this.installer.uninstall(skillPath)
    await this.unlinkMirror(skill.folderName)
    agentGlobalSkillService.deleteById(skill.id)
    logger.info('Skill uninstalled', { skillId: skill.id, folderName: skill.folderName })
  }
}

export const skillService = new SkillService()
