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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/markdownParser', () => ({
  parseSkillMetadata: vi.fn(),
  findAllSkillDirectories: vi.fn().mockResolvedValue([]),
  findSkillMdPath: vi.fn()
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

    it('returns isEnabled: false for all skills when agentId has no skill rows', async () => {
      const skillService = new SkillService()
      await seedAgent()
      await seedSkills()

      const result = await skillService.list({ agentId: AGENT_ID })

      expect(result.every((s) => s.isEnabled === false)).toBe(true)
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

  describe('toggle', () => {
    let skillService: SkillService

    beforeEach(() => {
      skillService = new SkillService()
    })

    it('returns null when skill does not exist', async () => {
      const result = await skillService.toggle({ agentId: AGENT_ID, skillId: 'nonexistent', isEnabled: true })
      expect(result).toBeNull()
    })

    it('creates agent_skill row and returns enabled skill', async () => {
      await seedAgent()
      await seedSkills()

      const result = await skillService.toggle({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })

      expect(result).toMatchObject({ id: SKILL_ID_1, isEnabled: true })
      const [row] = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_1))
      expect(row?.isEnabled).toBe(true)
    })

    it('updates existing agent_skill row when toggling off', async () => {
      await seedAgent()
      await seedSkills()
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })

      const result = await skillService.toggle({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: false })

      expect(result).toMatchObject({ id: SKILL_ID_1, isEnabled: false })
      const [row] = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_1))
      expect(row?.isEnabled).toBe(false)
    })
  })

  describe('initSkillsForAgent', () => {
    it('creates enabled agent_skill rows for all builtin skills', async () => {
      const skillService = new SkillService()
      await seedAgent()
      await seedSkills()

      // Pass undefined workspace to skip symlink ops
      await skillService.initSkillsForAgent(AGENT_ID, undefined)

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, AGENT_ID))

      // Only the builtin skill should be seeded
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ skillId: SKILL_ID_BUILTIN, isEnabled: true })
    })

    it('is a no-op when no builtin skills exist', async () => {
      const skillService = new SkillService()
      await seedAgent()
      // Only insert marketplace skills
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_1,
        name: 'skill-one',
        folderName: 'skill-one',
        source: 'marketplace',
        contentHash: 'abc123',
        isEnabled: true
      })

      await skillService.initSkillsForAgent(AGENT_ID, undefined)

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, AGENT_ID))
      expect(rows).toHaveLength(0)
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

    it('is a no-op when skill exists and files were not updated', async () => {
      const skillService = new SkillService()
      vi.spyOn(skillService['installer'], 'computeContentHash').mockResolvedValue('hash1')
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

    it('inserts and enables for all agents on first install', async () => {
      const skillService = new SkillService()
      vi.spyOn(skillService['installer'], 'computeContentHash').mockResolvedValue('hash3')
      const enableSpy = vi.spyOn(skillService, 'enableForAllAgents').mockResolvedValue(undefined)
      await seedAgent()

      await skillService.syncBuiltinSkill(FOLDER_NAME, DEST_PATH, false)

      const rows = await dbh.db
        .select()
        .from(agentGlobalSkillTable)
        .where(eq(agentGlobalSkillTable.folderName, FOLDER_NAME))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.source).toBe('builtin')
      expect(enableSpy).toHaveBeenCalledOnce()
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

    it('reconcileSkills heals mirrors, adopts user-dropped skills, ignores non-skills, prunes orphans', async () => {
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

      // User-dropped real skill (has SKILL.md) → adopted.
      const dropped = path.join(mirrorRoot, 'dropped')
      await fs.promises.mkdir(dropped, { recursive: true })
      await fs.promises.writeFile(path.join(dropped, 'SKILL.md'), '# dropped')

      // Non-skill config entry (no SKILL.md) → ignored.
      await fs.promises.mkdir(path.join(mirrorRoot, 'notaskill'), { recursive: true })

      vi.mocked(parseSkillMetadata).mockResolvedValue({
        name: 'dropped',
        description: 'd',
        author: null,
        tags: [],
        filename: 'dropped',
        command: '',
        version: '1.0.0'
      } as never)
      // `computeContentHash` resolves SKILL.md via `findSkillMdPath` (module-mocked).
      vi.mocked(findSkillMdPath).mockImplementation(async (dir: string) => path.join(dir, 'SKILL.md'))
      const warnSpy = vi.spyOn(loggerService.withContext('SkillService'), 'warn').mockImplementation(() => undefined)

      try {
        await skillService.reconcileSkills()

        // heal: DB skill with files is mirrored
        await expect(fs.promises.access(path.join(mirrorRoot, 'skill-one', 'SKILL.md'))).resolves.toBeUndefined()
        // warn: DB skill whose source files are missing
        expect(warnSpy).toHaveBeenCalledWith(
          'Skill source files missing; skipping mirror',
          expect.objectContaining({ folderName: 'gone' })
        )
        // adopt: DB row (source 'local') + Data/Skills copy + managed mirror
        const adopted = await dbh.db
          .select()
          .from(agentGlobalSkillTable)
          .where(eq(agentGlobalSkillTable.folderName, 'dropped'))
        expect(adopted).toHaveLength(1)
        expect(adopted[0]?.source).toBe('local')
        await expect(fs.promises.access(path.join(dataSkillsRoot, 'dropped', 'SKILL.md'))).resolves.toBeUndefined()
        await expect(fs.promises.access(path.join(mirrorRoot, 'dropped', 'SKILL.md'))).resolves.toBeUndefined()
        // ignore: non-skill entry left untouched, no DB row
        const notRow = await dbh.db
          .select()
          .from(agentGlobalSkillTable)
          .where(eq(agentGlobalSkillTable.folderName, 'notaskill'))
        expect(notRow).toHaveLength(0)
        await expect(fs.promises.access(path.join(mirrorRoot, 'notaskill'))).resolves.toBeUndefined()
        // prune: managed-orphan mirror entry removed
        await expect(fs.promises.access(path.join(mirrorRoot, 'orphan'))).rejects.toThrow()
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
