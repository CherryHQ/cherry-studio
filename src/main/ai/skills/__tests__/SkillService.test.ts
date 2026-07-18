import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { loggerService } from '@logger'
import { findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/markdownParser', () => ({
  parseSkillMetadata: vi.fn(),
  findAllSkillDirectories: vi.fn().mockResolvedValue([]),
  findSkillMdPath: vi.fn()
}))

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn().mockResolvedValue({})
}))

import { SkillService } from '../SkillService'

const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SKILL_ID_1 = '11111111-1111-4111-8111-111111111111'
const SKILL_ID_2 = '22222222-2222-4222-8222-222222222222'
const SKILL_ID_BUILTIN = '33333333-3333-4333-8333-333333333333'

describe('SkillService', () => {
  const dbh = setupTestDatabase()
  const tempDirs: string[] = []

  async function createTempDir(prefix: string) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
  })

  async function seedAgent() {
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'You are a helpful assistant.',
      model: null,
      orderKey: 'a0'
    })
  }

  async function seedSkills() {
    await dbh.db.insert(agentGlobalSkillTable).values([
      {
        id: SKILL_ID_1,
        name: 'skill-one',
        description: 'Extract web content',
        folderName: 'skill-one',
        source: 'marketplace',
        contentHash: 'abc123',
        isEnabled: true
      },
      {
        id: SKILL_ID_2,
        name: 'skill-two',
        description: 'Summarize local documents',
        folderName: 'skill-two',
        source: 'marketplace',
        contentHash: 'def456',
        isEnabled: true
      },
      {
        id: SKILL_ID_BUILTIN,
        name: 'builtin-skill',
        description: 'Builtin helper',
        folderName: 'builtin-skill',
        source: 'builtin',
        contentHash: 'bbb999',
        isEnabled: true
      }
    ])
  }

  describe('list', () => {
    it('returns empty array when no skills installed', async () => {
      const skillService = new SkillService()
      await expect(skillService.list()).resolves.toEqual([])
    })

    it('returns all skills with isEnabled: false when no agentId provided', async () => {
      const skillService = new SkillService()
      await seedSkills()

      const result = await skillService.list()

      expect(result).toHaveLength(3)
      expect(result.every((s) => s.isEnabled === false)).toBe(true)
      expect(result.map((s) => s.name)).toContain('skill-one')
    })

    it('returns source metadata tags and does not expose user tags', async () => {
      const skillService = new SkillService()
      await seedSkills()
      await dbh.db
        .update(agentGlobalSkillTable)
        .set({ tags: ['source-ai'] })
        .where(eq(agentGlobalSkillTable.id, SKILL_ID_1))

      const result = await skillService.list()
      const skill = result.find((s) => s.id === SKILL_ID_1)

      expect(skill?.sourceTags).toEqual(['source-ai'])
      expect('tags' in (skill as object)).toBe(false)
    })

    it('reflects per-agent enablement when agentId is provided', async () => {
      const skillService = new SkillService()
      await seedAgent()
      await seedSkills()
      // Enable skill-one for the agent
      await dbh.db.insert(agentSkillTable).values({
        agentId: AGENT_ID,
        skillId: SKILL_ID_1,
        isEnabled: true
      })

      const result = await skillService.list({ agentId: AGENT_ID })

      expect(result).toHaveLength(3)
      const one = result.find((s) => s.id === SKILL_ID_1)
      const two = result.find((s) => s.id === SKILL_ID_2)
      expect(one?.isEnabled).toBe(true)
      expect(two?.isEnabled).toBe(false)
    })

    it('defaults isEnabled to false for non-builtin skills and true for builtin skills when agentId has no skill rows', async () => {
      const skillService = new SkillService()
      await seedAgent()
      await seedSkills()

      const result = await skillService.list({ agentId: AGENT_ID })

      const nonBuiltin = result.filter((s) => s.id !== SKILL_ID_BUILTIN)
      const builtin = result.find((s) => s.id === SKILL_ID_BUILTIN)
      expect(nonBuiltin.every((s) => s.isEnabled === false)).toBe(true)
      expect(builtin?.isEnabled).toBe(true)
    })

    it('an explicit disabled row for a builtin skill overrides the enabled-by-default fallback', async () => {
      const skillService = new SkillService()
      await seedAgent()
      await seedSkills()
      await dbh.db.insert(agentSkillTable).values({
        agentId: AGENT_ID,
        skillId: SKILL_ID_BUILTIN,
        isEnabled: false
      })

      const result = await skillService.list({ agentId: AGENT_ID })

      expect(result.find((s) => s.id === SKILL_ID_BUILTIN)?.isEnabled).toBe(false)
    })

    it('filters by search against name or description in the database', async () => {
      const skillService = new SkillService()
      await seedSkills()

      const byName = await skillService.list({ search: 'two' })
      const byDescription = await skillService.list({ search: 'web content' })

      expect(byName.map((s) => s.id)).toEqual([SKILL_ID_2])
      expect(byDescription.map((s) => s.id)).toEqual([SKILL_ID_1])
    })

    it('treats LIKE wildcards in search as literal characters', async () => {
      const skillService = new SkillService()
      await seedSkills()
      await dbh.db
        .update(agentGlobalSkillTable)
        .set({ name: 'percent-%-skill' })
        .where(eq(agentGlobalSkillTable.id, SKILL_ID_1))

      const result = await skillService.list({ search: '%' })

      expect(result.map((s) => s.id)).toEqual([SKILL_ID_1])
    })
  })

  describe('getById', () => {
    it('returns null when skill does not exist', async () => {
      const skillService = new SkillService()
      await expect(skillService.getById('nonexistent')).resolves.toBeNull()
    })

    it('returns the skill when found', async () => {
      const skillService = new SkillService()
      await seedSkills()

      const result = await skillService.getById(SKILL_ID_1)

      expect(result).toMatchObject({
        id: SKILL_ID_1,
        name: 'skill-one',
        folderName: 'skill-one',
        source: 'marketplace'
      })
      expect('tags' in (result as object)).toBe(false)
    })
  })

  describe('listLocal', () => {
    beforeEach(() => {
      vi.mocked(parseSkillMetadata).mockClear()
      vi.mocked(parseSkillMetadata).mockImplementation(async (skillPath, sourcePath) => ({
        sourcePath,
        filename: path.basename(skillPath),
        name: path.basename(skillPath),
        description: `${sourcePath} description`,
        category: 'skills',
        type: 'skill',
        command: '',
        version: '1.0.0',
        size: 0,
        contentHash: 'hash'
      }))
    })

    it('lists user-owned local skill directories and symlinked directories', async () => {
      const skillService = new SkillService()
      const workdir = await createTempDir('skill-local-workdir-')
      const skillsDir = path.join(workdir, '.claude', 'skills')
      const externalSkillDir = await createTempDir('skill-local-external-')
      await fs.promises.mkdir(path.join(skillsDir, 'plain-skill'), { recursive: true })
      await fs.promises.writeFile(path.join(skillsDir, 'plain-skill', 'SKILL.md'), '# Plain skill')
      await fs.promises.writeFile(path.join(externalSkillDir, 'SKILL.md'), '# Linked skill')
      await fs.promises.symlink(externalSkillDir, path.join(skillsDir, 'linked-skill'), 'junction')

      const result = await skillService.listLocal(workdir)

      expect(result.map((skill) => skill.filename).sort()).toEqual(['linked-skill', 'plain-skill'])
    })

    it('skips Cherry-managed skill symlinks that point to the global skill storage', async () => {
      const skillService = new SkillService()
      const workdir = await createTempDir('skill-local-workdir-')
      const skillsDir = path.join(workdir, '.claude', 'skills')
      const globalSkillsRoot = await createTempDir('skill-global-root-')
      const managedSkillDir = path.join(globalSkillsRoot, 'managed-skill')
      await fs.promises.mkdir(managedSkillDir, { recursive: true })
      await fs.promises.writeFile(path.join(managedSkillDir, 'SKILL.md'), '# Managed skill')
      await fs.promises.mkdir(skillsDir, { recursive: true })
      await fs.promises.symlink(managedSkillDir, path.join(skillsDir, 'managed-skill'), 'junction')
      const getPathSpy = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
        if (key === 'feature.agents.skills') {
          return filename ? path.join(globalSkillsRoot, filename) : globalSkillsRoot
        }
        return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
      })

      try {
        const result = await skillService.listLocal(workdir)

        expect(result).toEqual([])
        expect(parseSkillMetadata).not.toHaveBeenCalled()
      } finally {
        getPathSpy.mockRestore()
      }
    })

    it('warns and skips broken local skill symlinks', async () => {
      const warnSpy = vi.spyOn(loggerService.withContext('SkillService'), 'warn').mockImplementation(() => undefined)
      const skillService = new SkillService()
      const workdir = await createTempDir('skill-local-workdir-')
      const skillsDir = path.join(workdir, '.claude', 'skills')
      await fs.promises.mkdir(skillsDir, { recursive: true })
      await fs.promises.symlink(path.join(workdir, 'missing-target'), path.join(skillsDir, 'broken-skill'), 'junction')

      try {
        const result = await skillService.listLocal(workdir)

        expect(result).toEqual([])
        expect(warnSpy).toHaveBeenCalledWith(
          'Failed to resolve local skill symlink; skipping',
          expect.objectContaining({ entry: 'broken-skill', skillsDir })
        )
      } finally {
        warnSpy.mockRestore()
      }
    })
  })

  describe('system skills', () => {
    let skillService: SkillService
    let home: string
    let dataSkillsRoot: string
    let mirrorRoot: string
    let sourceSkillDir: string
    let restoreGetPath = () => {}

    beforeEach(async () => {
      skillService = new SkillService()
      home = await createTempDir('skill-system-home-')
      dataSkillsRoot = path.join(home, 'app-data', 'Skills')
      mirrorRoot = path.join(home, 'app-data', '.claude', 'skills')
      sourceSkillDir = path.join(home, '.codex', 'skills', 'large-skill')
      await fs.promises.mkdir(dataSkillsRoot, { recursive: true })
      await fs.promises.mkdir(mirrorRoot, { recursive: true })
      await fs.promises.mkdir(sourceSkillDir, { recursive: true })
      await fs.promises.writeFile(path.join(sourceSkillDir, 'SKILL.md'), '# Large skill')

      const getPathSpy = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
        const roots: Record<string, string> = {
          'sys.home': home,
          'feature.agents.skills': dataSkillsRoot,
          'feature.agents.claude.skills': mirrorRoot
        }
        const root = roots[key] ?? path.join(home, 'mock', key)
        return filename ? path.join(root, filename) : root
      })
      restoreGetPath = () => getPathSpy.mockRestore()

      vi.mocked(parseSkillMetadata).mockResolvedValue({
        sourcePath: 'large-skill',
        filename: 'large-skill',
        name: 'Large Skill',
        description: 'Lives outside Cherry',
        category: 'skills',
        type: 'skill',
        version: '1.0.0',
        size: 0,
        contentHash: 'system-hash'
      })
      vi.mocked(findSkillMdPath).mockImplementation(async (directoryPath) => path.join(directoryPath, 'SKILL.md'))
    })

    afterEach(() => {
      restoreGetPath()
      vi.mocked(parseSkillMetadata).mockReset()
      vi.mocked(findSkillMdPath).mockReset()
    })

    it('discovers direct children of known system roots without calculating directory size', async () => {
      const result = await skillService.discoverSystem()

      expect(result).toEqual([
        expect.objectContaining({
          name: 'Large Skill',
          filename: 'large-skill',
          directoryPath: await fs.promises.realpath(sourceSkillDir),
          status: 'available',
          placements: [expect.objectContaining({ sourceId: 'codex', sourceName: 'Codex' })]
        })
      ])
      expect(parseSkillMetadata).toHaveBeenCalledWith(
        await fs.promises.realpath(sourceSkillDir),
        'large-skill',
        'skills',
        { calculateSize: false }
      )
    })

    it('imports a system skill into the managed library without changing agent associations', async () => {
      const result = await skillService.importSystem({ directoryPath: sourceSkillDir })

      expect(result).toMatchObject({
        name: 'Large Skill',
        source: 'system',
        sourceUrl: expect.stringMatching(/^file:/),
        namespace: 'codex',
        isEnabled: false
      })
      await expect(fs.promises.readFile(path.join(dataSkillsRoot, 'large-skill', 'SKILL.md'), 'utf-8')).resolves.toBe(
        '# Large skill'
      )
      expect((await fs.promises.lstat(path.join(dataSkillsRoot, 'large-skill'))).isSymbolicLink()).toBe(false)
      expect(await fs.promises.realpath(path.join(mirrorRoot, 'large-skill'))).toBe(
        await fs.promises.realpath(path.join(dataSkillsRoot, 'large-skill'))
      )
      expect(skillService.getInstalledSkillDirectory(result)).toBe(path.join(dataSkillsRoot, 'large-skill'))
      expect(await dbh.db.select().from(agentSkillTable)).toEqual([])
    })

    it('does not overwrite the editable managed copy when the system skill is already imported', async () => {
      const imported = await skillService.importSystem({ directoryPath: sourceSkillDir })
      const managedSkillFile = path.join(dataSkillsRoot, 'large-skill', 'SKILL.md')
      await fs.promises.writeFile(managedSkillFile, '# Managed edit')

      await expect(skillService.importSystem({ directoryPath: sourceSkillDir })).rejects.toThrow(
        'System skill is already imported: large-skill'
      )
      await expect(fs.promises.readFile(managedSkillFile, 'utf-8')).resolves.toBe('# Managed edit')
      await expect(skillService.getById(imported.id)).resolves.toMatchObject({ id: imported.id })
    })

    it('uninstalls the managed copy without deleting the system source directory', async () => {
      const registered = await skillService.importSystem({ directoryPath: sourceSkillDir })
      const uninstallSpy = vi.spyOn(skillService['installer'], 'uninstall')

      await skillService.uninstall(registered.id)

      expect(uninstallSpy).toHaveBeenCalledWith(path.join(dataSkillsRoot, 'large-skill'))
      await expect(fs.promises.access(path.join(sourceSkillDir, 'SKILL.md'))).resolves.toBeUndefined()
      await expect(fs.promises.access(path.join(dataSkillsRoot, 'large-skill'))).rejects.toThrow()
      await expect(fs.promises.access(path.join(mirrorRoot, 'large-skill'))).rejects.toThrow()
    })
  })

  describe('toggle', () => {
    let skillService: SkillService

    beforeEach(() => {
      skillService = new SkillService()
    })

    it('returns null when skill does not exist', async () => {
      const result = skillService.toggle({ agentId: AGENT_ID, skillId: 'nonexistent', isEnabled: true })
      expect(result).toBeNull()
    })

    it('creates agent_skill row and returns enabled skill', async () => {
      await seedAgent()
      await seedSkills()

      const result = skillService.toggle({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })

      expect(result).toMatchObject({ id: SKILL_ID_1, isEnabled: true })
      const [row] = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_1))
      expect(row?.isEnabled).toBe(true)
    })

    it('updates existing agent_skill row when toggling off', async () => {
      await seedAgent()
      await seedSkills()
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })

      const result = skillService.toggle({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: false })

      expect(result).toMatchObject({ id: SKILL_ID_1, isEnabled: false })
      const [row] = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_1))
      expect(row?.isEnabled).toBe(false)
    })
  })

  describe('uninstall', () => {
    it('throws when skill does not exist', async () => {
      const skillService = new SkillService()
      await expect(skillService.uninstall('nonexistent')).rejects.toThrow('Skill not found: nonexistent')
    })

    it('removes DB row and delegates fs cleanup to installer', async () => {
      const skillService = new SkillService()
      await seedSkills()
      vi.spyOn(skillService['installer'], 'uninstall').mockResolvedValue(undefined)

      await skillService.uninstall(SKILL_ID_1)

      const rows = await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID_1))
      expect(rows).toHaveLength(0)
      expect(skillService['installer'].uninstall).toHaveBeenCalledOnce()
    })
  })

  describe('install', () => {
    it('throws on unknown install source', async () => {
      const skillService = new SkillService()
      await expect(skillService.install({ installSource: 'unknown:foo/bar' })).rejects.toThrow(
        'Unknown install source: unknown'
      )
    })

    it('delegates to installFromClaudePlugins for claude-plugins source', async () => {
      const skillService = new SkillService()
      const spy = vi.spyOn(skillService as never, 'installFromClaudePlugins').mockResolvedValue({} as never)
      await skillService.install({ installSource: 'claude-plugins:owner/repo/skill' })
      expect(spy).toHaveBeenCalledWith('owner/repo/skill')
    })

    it('rejects ambiguous claude-plugins identifiers without a directory path', async () => {
      const skillService = new SkillService()
      const createTempDirSpy = vi.spyOn(skillService as never, 'createTempDir')

      await expect(skillService.install({ installSource: 'claude-plugins:owner/repo/' })).rejects.toThrow(
        'Invalid claude-plugins identifier: owner/repo/'
      )
      expect(createTempDirSpy).not.toHaveBeenCalled()
    })

    it('delegates to installFromSkillsSh for skills.sh source', async () => {
      const skillService = new SkillService()
      const spy = vi.spyOn(skillService as never, 'installFromSkillsSh').mockResolvedValue({} as never)
      await skillService.install({ installSource: 'skills.sh:owner/repo' })
      expect(spy).toHaveBeenCalledWith('owner/repo')
    })

    it('delegates to installFromClawhub for clawhub source', async () => {
      const skillService = new SkillService()
      const spy = vi.spyOn(skillService as never, 'installFromClawhub').mockResolvedValue({} as never)
      await skillService.install({ installSource: 'clawhub:my-skill' })
      expect(spy).toHaveBeenCalledWith('my-skill')
    })

    it('installs clawhub skills through current API endpoints and owner source URL', async () => {
      const skillService = new SkillService()
      const tempDir = await createTempDir('skill-clawhub-install-')
      const extractDir = path.join(tempDir, 'extracted')
      const locatedSkillDir = path.join(extractDir, 'code')
      const installedSkill = {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Code',
        description: 'Coding workflow',
        folderName: 'code',
        source: 'marketplace',
        sourceUrl: 'https://clawhub.ai/ivangdavila/skills/code',
        namespace: null,
        author: null,
        sourceTags: [],
        contentHash: 'hash-code',
        isEnabled: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }

      vi.mocked(net.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ owner: { handle: 'ivangdavila' } }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
          })
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      const createTempDirSpy = vi.spyOn(skillService as never, 'createTempDir').mockResolvedValue(tempDir as never)
      const extractZipSpy = vi.spyOn(skillService as never, 'extractZip').mockResolvedValue(undefined as never)
      const locateSkillDirSpy = vi
        .spyOn(skillService as never, 'locateSkillDir')
        .mockResolvedValue(locatedSkillDir as never)
      const installSkillDirSpy = vi
        .spyOn(skillService as never, 'installSkillDir')
        .mockResolvedValue(installedSkill as never)

      try {
        const result = await skillService.install({ installSource: 'clawhub:code' })

        expect(result).toBe(installedSkill)
        expect(net.fetch).toHaveBeenNthCalledWith(1, 'https://clawhub.ai/api/v1/skills/code', {
          headers: { 'User-Agent': 'CherryStudio' }
        })
        expect(net.fetch).toHaveBeenNthCalledWith(2, 'https://clawhub.ai/api/v1/download?slug=code', {
          headers: { 'User-Agent': 'CherryStudio' }
        })
        expect(createTempDirSpy).toHaveBeenCalledWith('clawhub')
        expect(extractZipSpy).toHaveBeenCalledWith(path.join(tempDir, 'skill.zip'), extractDir)
        expect(locateSkillDirSpy).toHaveBeenCalledWith(extractDir)
        expect(installSkillDirSpy).toHaveBeenCalledWith(
          locatedSkillDir,
          'marketplace',
          'https://clawhub.ai/ivangdavila/skills/code'
        )
      } finally {
        createTempDirSpy.mockRestore()
        extractZipSpy.mockRestore()
        locateSkillDirSpy.mockRestore()
        installSkillDirSpy.mockRestore()
        vi.mocked(net.fetch).mockReset()
      }
    })
  })

  describe('syncBuiltinSkill', () => {
    const FOLDER_NAME = 'my-builtin'
    const DEST_PATH = '/skills/my-builtin'

    beforeEach(() => {
      vi.mocked(parseSkillMetadata).mockResolvedValue({
        name: 'My Builtin',
        description: 'A builtin skill',
        author: 'cherry',
        tags: ['ai'],
        command: '',
        version: '1.0.0'
      } as never)
    })

    it('does not re-hash or re-parse metadata when skill exists and files were not updated', async () => {
      const skillService = new SkillService()
      vi.spyOn(skillService['installer'], 'computeContentHash').mockResolvedValue('hash1')
      await seedAgent()
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'My Builtin',
        folderName: FOLDER_NAME,
        source: 'builtin',
        contentHash: 'hash1',
        isEnabled: false
      })

      await skillService.syncBuiltinSkill(FOLDER_NAME, DEST_PATH, false)

      expect(skillService['installer'].computeContentHash).not.toHaveBeenCalled()
      expect(parseSkillMetadata).not.toHaveBeenCalled()
    })

    it('never writes agent_skill rows, leaving per-agent enablement to the read-time builtin default', async () => {
      const skillService = new SkillService()
      await seedAgent()
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'My Builtin',
        folderName: FOLDER_NAME,
        source: 'builtin',
        contentHash: 'hash1',
        isEnabled: false
      })
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_BUILTIN, isEnabled: false })

      await skillService.syncBuiltinSkill(FOLDER_NAME, DEST_PATH, false)

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_BUILTIN))
      expect(rows).toEqual([expect.objectContaining({ agentId: AGENT_ID, isEnabled: false })])
    })

    it('updates metadata when skill exists and files were updated', async () => {
      const skillService = new SkillService()
      vi.spyOn(skillService['installer'], 'computeContentHash').mockResolvedValue('hash2')
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'Old Name',
        folderName: FOLDER_NAME,
        source: 'builtin',
        contentHash: 'hash1',
        isEnabled: false
      })

      await skillService.syncBuiltinSkill(FOLDER_NAME, DEST_PATH, true)

      const [row] = await dbh.db
        .select()
        .from(agentGlobalSkillTable)
        .where(eq(agentGlobalSkillTable.id, SKILL_ID_BUILTIN))
      expect(row?.name).toBe('My Builtin')
      expect(row?.contentHash).toBe('hash2')
    })

    it('inserts a new builtin skill on first install, already enabled for existing agents without any agent_skill row', async () => {
      const skillService = new SkillService()
      vi.spyOn(skillService['installer'], 'computeContentHash').mockResolvedValue('hash3')
      await seedAgent()

      await skillService.syncBuiltinSkill(FOLDER_NAME, DEST_PATH, false)

      const rows = await dbh.db
        .select()
        .from(agentGlobalSkillTable)
        .where(eq(agentGlobalSkillTable.folderName, FOLDER_NAME))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.source).toBe('builtin')

      const joinRows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, AGENT_ID))
      expect(joinRows).toHaveLength(0)
      const [installed] = await skillService.list({ agentId: AGENT_ID })
      expect(installed?.isEnabled).toBe(true)
    })
  })

  describe('skill mirror', () => {
    let skillService: SkillService
    let dataSkillsRoot: string
    let mirrorRoot: string
    let restoreGetPath = () => {}

    beforeEach(async () => {
      skillService = new SkillService()
      const root = await createTempDir('skill-mirror-')
      dataSkillsRoot = path.join(root, 'Data', 'Skills')
      mirrorRoot = path.join(root, '.claude', 'skills')
      await fs.promises.mkdir(dataSkillsRoot, { recursive: true })
      await fs.promises.mkdir(mirrorRoot, { recursive: true })
      const spy = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
        if (key === 'feature.agents.skills') return filename ? path.join(dataSkillsRoot, filename) : dataSkillsRoot
        if (key === 'feature.agents.claude.skills') return filename ? path.join(mirrorRoot, filename) : mirrorRoot
        return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
      })
      restoreGetPath = () => spy.mockRestore()
    })

    afterEach(() => {
      restoreGetPath()
    })

    async function writeLibrarySkill(folderName: string, body = '# Skill') {
      const dir = path.join(dataSkillsRoot, folderName)
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(path.join(dir, 'SKILL.md'), body)
      return dir
    }

    it('linkMirror mirrors a library skill into the Claude config dir; unlinkMirror removes it', async () => {
      await writeLibrarySkill('pdf')

      await skillService.linkMirror('pdf')
      await expect(fs.promises.access(path.join(mirrorRoot, 'pdf', 'SKILL.md'))).resolves.toBeUndefined()
      expect((await fs.promises.lstat(path.join(mirrorRoot, 'pdf'))).isSymbolicLink()).toBe(true)

      await skillService.unlinkMirror('pdf')
      await expect(fs.promises.access(path.join(mirrorRoot, 'pdf'))).rejects.toThrow()
    })

    it('linkMirror replaces a broken mirror symlink', async () => {
      await writeLibrarySkill('pdf')
      await fs.promises.symlink(path.join(dataSkillsRoot, 'missing'), path.join(mirrorRoot, 'pdf'), 'dir')

      await skillService.linkMirror('pdf')

      await expect(fs.promises.access(path.join(mirrorRoot, 'pdf', 'SKILL.md'))).resolves.toBeUndefined()
      expect(await fs.promises.realpath(path.join(mirrorRoot, 'pdf'))).toBe(
        await fs.promises.realpath(path.join(dataSkillsRoot, 'pdf'))
      )
    })

    it('linkMirror warns and skips when the library source files are missing', async () => {
      const warnSpy = vi.spyOn(loggerService.withContext('SkillService'), 'warn').mockImplementation(() => undefined)
      try {
        await skillService.linkMirror('ghost')
        expect(warnSpy).toHaveBeenCalledWith(
          'Skill source files missing; skipping mirror',
          expect.objectContaining({ folderName: 'ghost' })
        )
        await expect(fs.promises.access(path.join(mirrorRoot, 'ghost'))).rejects.toThrow()
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('uninstall removes the mirror entry', async () => {
      await seedSkills()
      vi.spyOn(skillService['installer'], 'uninstall').mockResolvedValue(undefined)
      const unlinkSpy = vi.spyOn(skillService, 'unlinkMirror')

      await skillService.uninstall(SKILL_ID_1)

      expect(unlinkSpy).toHaveBeenCalledWith('skill-one')
    })

    it('reconcileSkills heals mirrors, prunes managed orphans, leaves user-dropped skills untouched', async () => {
      // DB skill with files → mirrored. DB skill without files → warned, not mirrored.
      await writeLibrarySkill('skill-one')
      await dbh.db.insert(agentGlobalSkillTable).values([
        {
          id: SKILL_ID_1,
          name: 'skill-one',
          folderName: 'skill-one',
          source: 'marketplace',
          contentHash: 'a',
          isEnabled: false
        },
        { id: SKILL_ID_2, name: 'gone', folderName: 'gone', source: 'marketplace', contentHash: 'b', isEnabled: false }
      ])

      // Managed-orphan: a mirror symlink into Data/Skills with no DB row → pruned.
      await writeLibrarySkill('orphan')
      await fs.promises.symlink(path.join(dataSkillsRoot, 'orphan'), path.join(mirrorRoot, 'orphan'), 'dir')

      // User-dropped real skill (has SKILL.md) → left untouched, never adopted.
      const dropped = path.join(mirrorRoot, 'dropped')
      await fs.promises.mkdir(dropped, { recursive: true })
      await fs.promises.writeFile(path.join(dropped, 'SKILL.md'), '# dropped')

      const warnSpy = vi.spyOn(loggerService.withContext('SkillService'), 'warn').mockImplementation(() => undefined)

      try {
        await skillService.reconcileSkills()

        await expect(
          fs.promises.readFile(path.join(path.dirname(mirrorRoot), '.claude-plugin', 'plugin.json'), 'utf-8')
        ).resolves.toBe('{\n  "name": "cherry-studio-skills"\n}\n')

        // heal: DB skill with files is mirrored
        await expect(fs.promises.access(path.join(mirrorRoot, 'skill-one', 'SKILL.md'))).resolves.toBeUndefined()
        // warn: DB skill whose source files are missing
        expect(warnSpy).toHaveBeenCalledWith(
          'Skill source files missing; skipping mirror',
          expect.objectContaining({ folderName: 'gone' })
        )
        // user-dropped: no DB row created, files left in place
        const droppedRow = await dbh.db
          .select()
          .from(agentGlobalSkillTable)
          .where(eq(agentGlobalSkillTable.folderName, 'dropped'))
        expect(droppedRow).toHaveLength(0)
        await expect(fs.promises.access(path.join(mirrorRoot, 'dropped', 'SKILL.md'))).resolves.toBeUndefined()
        await expect(fs.promises.access(path.join(dataSkillsRoot, 'dropped'))).rejects.toThrow()
        // prune: managed-orphan mirror entry removed
        await expect(fs.promises.access(path.join(mirrorRoot, 'orphan'))).rejects.toThrow()
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
