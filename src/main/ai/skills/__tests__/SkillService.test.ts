import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { findAllSkillDirectories, findSkillMdPath, parseSkillMetadata } from '@main/utils/markdownParser'
import { SKILL_LIST_MEMBERSHIP_DIMENSIONS } from '@shared/data/api/schemas/skills'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { setupTestDatabase } from '@test-helpers/db'
import AdmZip from 'adm-zip'
import { eq } from 'drizzle-orm'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notifyDataApiDataChangeMock = vi.hoisted(() => vi.fn())

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

vi.mock('@main/utils/markdownParser', () => ({
  parseSkillMetadata: vi.fn(),
  findAllSkillDirectories: vi.fn().mockResolvedValue([]),
  findSkillMdPath: vi.fn()
}))

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn().mockResolvedValue({})
}))

const executeCommandMock = vi.hoisted(() => vi.fn())
vi.mock('@main/utils/processRunner', () => ({
  executeCommand: executeCommandMock
}))

// Spy wrappers over the real implementations: install tests stub a single step (temp dir, ZIP
// extraction, directory resolution) while the rest of the path still runs for real.
vi.mock('../skillPaths', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof skillPaths
  return {
    ...actual,
    createTempDir: vi.fn(actual.createTempDir),
    safeRemoveDirectory: vi.fn(actual.safeRemoveDirectory)
  }
})
vi.mock('../skillArchive', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof skillArchive
  return {
    ...actual,
    extractZip: vi.fn(actual.extractZip),
    resolveSkillDirectory: vi.fn(actual.resolveSkillDirectory)
  }
})

// Namespaced so the local `createTempDir` test helper cannot shadow the module export.
import * as skillArchive from '../skillArchive'
import * as skillPaths from '../skillPaths'
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
    vi.unstubAllEnvs()
    // A marketplace install fires `reportInstall` telemetry through `net.fetch`; without this, that
    // call lands in the next test's request assertions.
    vi.mocked(net.fetch).mockReset()
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })))
  })

  // These are spies over the real implementations; drop any per-test stub and call history so one
  // install test cannot hand its stub to the next.
  beforeEach(() => {
    vi.mocked(skillPaths.createTempDir).mockReset()
    vi.mocked(skillPaths.safeRemoveDirectory).mockReset()
    vi.mocked(skillArchive.extractZip).mockReset()
    vi.mocked(skillArchive.resolveSkillDirectory).mockReset()
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
        version: '1.2.3',
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

    it('keeps the global state separate and lets it override an agent enablement without erasing it', async () => {
      const skillService = new SkillService()
      await seedAgent()
      await seedSkills()
      await dbh.db.insert(agentSkillTable).values({
        agentId: AGENT_ID,
        skillId: SKILL_ID_1,
        isEnabled: true
      })
      const disabledSkill = agentGlobalSkillService.updateGlobalEnabled(SKILL_ID_1, false)

      const globallyListed = await skillService.list()
      const agentListed = await skillService.list({ agentId: AGENT_ID })
      const storedPreference = dbh.db
        .select()
        .from(agentSkillTable)
        .where(eq(agentSkillTable.skillId, SKILL_ID_1))
        .get()

      expect(disabledSkill?.isGlobalEnabled).toBe(false)
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/skills', kind: 'projection', entityIds: [SKILL_ID_1] },
        { endpoint: '/skills', kind: 'membership', dimension: 'agentId', entityIds: [SKILL_ID_1] },
        { endpoint: '/skills/:skillId', entityIds: [SKILL_ID_1] }
      ])
      const emittedEffects = notifyDataApiDataChangeMock.mock.calls[0]?.[0] as DataApiDataChangeEffect[]
      const membershipEffect = emittedEffects.find((effect) => effect.kind === 'membership')
      expect(Object.values(SKILL_LIST_MEMBERSHIP_DIMENSIONS)).toContain(membershipEffect?.dimension)
      expect(globallyListed.find((skill) => skill.id === SKILL_ID_1)?.isGlobalEnabled).toBe(false)
      expect(agentListed.find((skill) => skill.id === SKILL_ID_1)).toBeUndefined()
      expect(storedPreference?.isEnabled).toBe(true)
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
        source: 'marketplace',
        version: '1.2.3'
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
      expect(parseSkillMetadata).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'skills', {
        calculateSize: false
      })
    })

    it('discovers .agents skills and keeps .claude precedence for duplicate folder names', async () => {
      const skillService = new SkillService()
      const workdir = await createTempDir('skill-local-workdir-')
      const claudeSkill = path.join(workdir, '.claude', 'skills', 'shared-skill')
      const agentSharedSkill = path.join(workdir, '.agents', 'skills', 'shared-skill')
      const agentOnlySkill = path.join(workdir, '.agents', 'skills', 'agent-only')
      await Promise.all([
        fs.promises.mkdir(claudeSkill, { recursive: true }),
        fs.promises.mkdir(agentSharedSkill, { recursive: true }),
        fs.promises.mkdir(agentOnlySkill, { recursive: true })
      ])
      await Promise.all([
        fs.promises.writeFile(path.join(claudeSkill, 'SKILL.md'), '# Claude skill'),
        fs.promises.writeFile(path.join(agentSharedSkill, 'SKILL.md'), '# Agent shared skill'),
        fs.promises.writeFile(path.join(agentOnlySkill, 'SKILL.md'), '# Agent-only skill')
      ])

      const result = await skillService.listLocal(workdir)

      expect(result.map((skill) => skill.filename).sort()).toEqual(['agent-only', 'shared-skill'])
      expect(parseSkillMetadata).toHaveBeenCalledWith(claudeSkill, 'shared-skill', 'skills', {
        calculateSize: false
      })
      expect(parseSkillMetadata).not.toHaveBeenCalledWith(
        agentSharedSkill,
        expect.anything(),
        expect.anything(),
        expect.anything()
      )
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

  describe('listLocalFolderNames', () => {
    it('returns valid local skill folder names without parsing metadata', async () => {
      vi.mocked(parseSkillMetadata).mockClear()
      const skillService = new SkillService()
      const workdir = await createTempDir('skill-local-names-workdir-')
      const skillsDir = path.join(workdir, '.claude', 'skills')
      await Promise.all([
        fs.promises.mkdir(path.join(skillsDir, 'valid-skill'), { recursive: true }),
        fs.promises.mkdir(path.join(skillsDir, 'missing-skill-md'), { recursive: true })
      ])
      vi.mocked(findSkillMdPath).mockImplementation(async (skillPath) =>
        skillPath.endsWith('valid-skill') ? path.join(skillPath, 'SKILL.md') : null
      )

      const result = await skillService.listLocalFolderNames(workdir)

      expect(result).toEqual(['valid-skill'])
      expect(parseSkillMetadata).not.toHaveBeenCalled()
    })
  })

  describe('listLocalSkillPaths', () => {
    it('returns valid skill directories from both workspace roots', async () => {
      const skillService = new SkillService()
      const workdir = await createTempDir('skill-local-paths-workdir-')
      const claudeSkill = path.join(workdir, '.claude', 'skills', 'claude-skill')
      const agentSkill = path.join(workdir, '.agents', 'skills', 'agent-skill')
      await Promise.all([
        fs.promises.mkdir(claudeSkill, { recursive: true }),
        fs.promises.mkdir(agentSkill, { recursive: true })
      ])
      vi.mocked(findSkillMdPath).mockImplementation(async (skillPath) => path.join(skillPath, 'SKILL.md'))

      await expect(skillService.listLocalSkillPaths(workdir)).resolves.toEqual([claudeSkill, agentSkill])
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
      vi.mocked(findAllSkillDirectories).mockImplementation(async (directoryPath) =>
        directoryPath === path.join(home, '.codex', 'skills')
          ? [{ folderPath: sourceSkillDir, sourcePath: 'large-skill' }]
          : []
      )
      vi.mocked(findSkillMdPath).mockImplementation(async (directoryPath) => path.join(directoryPath, 'SKILL.md'))
    })

    afterEach(() => {
      restoreGetPath()
      vi.mocked(parseSkillMetadata).mockReset()
      vi.mocked(findAllSkillDirectories).mockReset()
      vi.mocked(findAllSkillDirectories).mockResolvedValue([])
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

    it('discovers skills recursively under known system roots', async () => {
      const agentsSkillsRoot = path.join(home, '.agents', 'skills')
      const nestedSkillDir = path.join(agentsSkillsRoot, 'github', 'github-pr-workflow')
      await fs.promises.mkdir(nestedSkillDir, { recursive: true })
      await fs.promises.writeFile(path.join(nestedSkillDir, 'SKILL.md'), '# GitHub PR workflow')
      vi.mocked(findAllSkillDirectories).mockImplementation(async (directoryPath) =>
        directoryPath === agentsSkillsRoot
          ? [{ folderPath: nestedSkillDir, sourcePath: path.join('github', 'github-pr-workflow') }]
          : []
      )
      vi.mocked(parseSkillMetadata).mockResolvedValue({
        sourcePath: path.join('github', 'github-pr-workflow'),
        filename: 'github-pr-workflow',
        name: 'GitHub PR Workflow',
        description: 'Nested system skill',
        category: 'skills',
        type: 'skill',
        version: '1.0.0',
        size: 0,
        contentHash: 'nested-system-hash'
      })

      const result = await skillService.discoverSystem()

      expect(result).toEqual([
        expect.objectContaining({
          name: 'GitHub PR Workflow',
          filename: 'github-pr-workflow',
          directoryPath: await fs.promises.realpath(nestedSkillDir),
          status: 'available',
          placements: [expect.objectContaining({ sourceId: 'agents', sourceName: 'Agent Skills' })]
        })
      ])
      expect(parseSkillMetadata).toHaveBeenCalledWith(
        await fs.promises.realpath(nestedSkillDir),
        path.join('github', 'github-pr-workflow'),
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
        version: '1.0.0',
        isEnabled: false
      })
      await expect(fs.promises.readFile(path.join(dataSkillsRoot, 'large-skill', 'SKILL.md'), 'utf-8')).resolves.toBe(
        '# Large skill'
      )
      expect((await fs.promises.lstat(path.join(dataSkillsRoot, 'large-skill'))).isSymbolicLink()).toBe(false)
      const mirrored = path.join(mirrorRoot, 'large-skill')
      const managed = path.join(dataSkillsRoot, 'large-skill')
      expect((await fs.promises.lstat(mirrored)).isSymbolicLink()).toBe(!isWin)
      if (isWin) {
        await expect(fs.promises.readFile(path.join(mirrored, 'SKILL.md'), 'utf-8')).resolves.toBe('# Large skill')
      } else {
        expect(path.normalize(await fs.promises.realpath(mirrored))).toBe(
          path.normalize(await fs.promises.realpath(managed))
        )
      }
      expect(path.normalize(skillService.getInstalledSkillDirectory(result))).toBe(path.normalize(managed))
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

    it('rejects ambiguous claude-plugins identifiers without a directory path', async () => {
      const skillService = new SkillService()
      const createTempDirSpy = vi.mocked(skillPaths.createTempDir)

      await expect(skillService.install({ installSource: 'claude-plugins:owner/repo/' })).rejects.toThrow(
        'Invalid claude-plugins identifier: owner/repo/'
      )
      expect(createTempDirSpy).not.toHaveBeenCalled()
    })

    it('rejects claude-plugins identifiers with path traversal before cloning', async () => {
      const skillService = new SkillService()
      const createTempDirSpy = vi.mocked(skillPaths.createTempDir)

      await expect(
        skillService.install({ installSource: 'claude-plugins:owner/repo/skills/../outside' })
      ).rejects.toThrow('Invalid claude-plugins identifier')
      expect(createTempDirSpy).not.toHaveBeenCalled()
    })

    /**
     * Drives the real git plumbing through a fake `executeCommand`: `ls-remote` reports the given
     * refs, `ls-tree` the given tree, and `checkout` materializes the tree on disk.
     */
    async function setupGithubInstall(options: {
      refs?: Array<{ name: string; oid: string; namespace?: 'heads' | 'tags' }>
      tree?: Array<string | { path: string; size: number }>
      realInstall?: boolean
    }) {
      const skillService = new SkillService()
      const workDir = await createTempDir('github-install-')
      vi.mocked(skillPaths.createTempDir).mockResolvedValue(workDir as never)
      vi.mocked(skillPaths.safeRemoveDirectory).mockResolvedValue(undefined as never)
      const tree = (options.tree ?? ['skills/demo/SKILL.md']).map((entry) =>
        typeof entry === 'string' ? { path: entry, size: 8 } : entry
      )
      const gitCalls: string[][] = []

      executeCommandMock.mockImplementation(async (_command: string, args: string[]) => {
        gitCalls.push(args)
        if (args.includes('ls-remote')) {
          return (options.refs ?? [])
            .map((ref) => `${ref.oid}\trefs/${ref.namespace ?? 'heads'}/${ref.name}`)
            .join('\n')
        }
        if (args.includes('ls-tree')) {
          const separator = args.lastIndexOf('--')
          const pathspec = separator === -1 ? null : args[separator + 1]
          const selectedPath = pathspec?.replace(/^:\(top,literal\)/, '')
          const selectedTree = tree.filter(
            (entry) => !selectedPath || entry.path === selectedPath || entry.path.startsWith(`${selectedPath}/`)
          )
          return selectedTree.map((entry) => `100644 blob ${'d'.repeat(40)} ${entry.size}\t${entry.path}\0`).join('')
        }
        if (args.includes('checkout')) {
          const separator = args.lastIndexOf('--')
          const pathspec = args[separator + 1]
          const selectedPath = pathspec === '.' ? null : pathspec.replace(/^:\(top,literal\)/, '')
          for (const entry of tree.filter(
            (entry) => !selectedPath || entry.path === selectedPath || entry.path.startsWith(`${selectedPath}/`)
          )) {
            const contentPath = path.join(workDir, 'content', entry.path)
            await fs.promises.mkdir(path.dirname(contentPath), { recursive: true })
            await fs.promises.writeFile(contentPath, '# skill')
          }
        }
        return ''
      })

      const installSkillDir = skillService['installSkillDir'].bind(skillService)
      const installSpy = vi.spyOn(skillService as never, 'installSkillDir')
      if (options.realInstall) {
        installSpy.mockImplementation(installSkillDir as never)
      } else {
        installSpy.mockResolvedValue({} as never)
      }
      vi.mocked(findSkillMdPath).mockImplementation(async (dir: string) => path.join(dir, 'SKILL.md'))
      return { skillService, installSpy, gitCalls, workDir }
    }

    const gitFetchArgs = (calls: string[][]) => calls.find((args) => args.includes('fetch'))

    it('fetches the commit the ref pointed at and installs only the directory the URL selects', async () => {
      const oid = 'a'.repeat(40)
      const { skillService, installSpy, gitCalls } = await setupGithubInstall({
        refs: [{ name: 'dev', oid }],
        tree: ['README.md', 'skills/recruit-init/SKILL.md']
      })

      await skillService.install({
        installSource: 'github:https://github.com/owner/repo/blob/dev/skills/recruit-init/SKILL.md'
      })

      // Fetching the observed commit rather than the ref name is what closes the TOCTOU: a branch
      // that moves between ls-remote and fetch must not change what gets installed.
      expect(gitFetchArgs(gitCalls)).toEqual(expect.arrayContaining([oid]))
      expect(installSpy).toHaveBeenCalledWith(
        expect.stringContaining(path.join('skills', 'recruit-init')),
        'marketplace',
        'https://raw.githubusercontent.com/owner/repo/refs/heads/dev/skills/recruit-init/SKILL.md'
      )
    })

    it('updates the same skill when switching between blob and explicit raw branch URLs', async () => {
      const root = await createTempDir('github-reinstall-')
      const dataSkillsRoot = path.join(root, 'Data', 'Skills')
      const mirrorRoot = path.join(root, '.claude', 'skills')
      const getPathSpy = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
        const base = key === 'feature.agents.skills' ? dataSkillsRoot : mirrorRoot
        return filename ? path.join(base, filename) : base
      })
      vi.mocked(parseSkillMetadata).mockResolvedValue({
        sourcePath: 'demo',
        filename: 'demo',
        name: 'Demo',
        description: 'Demo skill',
        category: 'skills',
        type: 'skill',
        version: '1.0.0',
        size: 0,
        contentHash: 'demo-hash'
      })
      const { skillService } = await setupGithubInstall({
        refs: [{ name: 'main', oid: 'a'.repeat(40) }],
        realInstall: true
      })

      try {
        const installed = await skillService.install({
          installSource: 'github:https://github.com/owner/repo/blob/main/skills/demo/SKILL.md'
        })
        const updatedFromRaw = await skillService.install({
          installSource: 'github:https://raw.githubusercontent.com/owner/repo/refs/heads/main/skills/demo/SKILL.md'
        })
        const updatedFromBlob = await skillService.install({
          installSource: 'github:https://github.com/owner/repo/blob/main/skills/demo/SKILL.md'
        })

        expect(updatedFromRaw).toMatchObject({ id: installed.id, sourceUrl: installed.sourceUrl })
        expect(updatedFromBlob).toMatchObject({ id: installed.id, sourceUrl: installed.sourceUrl })
      } finally {
        getPathSpy.mockRestore()
        vi.mocked(parseSkillMetadata).mockReset()
      }
    })

    it('resolves a slash-bearing branch against the remote instead of splitting at the first segment', async () => {
      const wanted = 'b'.repeat(40)
      const { skillService, gitCalls } = await setupGithubInstall({
        refs: [
          { name: 'feature', oid: 'a'.repeat(40) },
          { name: 'feature/foo', oid: wanted }
        ]
      })

      await skillService.install({
        installSource: 'github:https://github.com/owner/repo/blob/feature/foo/skills/demo/SKILL.md'
      })

      expect(gitFetchArgs(gitCalls)).toEqual(expect.arrayContaining([wanted]))
    })

    it('installs a repository-root SKILL.md without exposing Git metadata as skill content', async () => {
      const oid = 'a'.repeat(40)
      const { skillService, installSpy } = await setupGithubInstall({
        refs: [{ name: 'main', oid }],
        tree: ['SKILL.md', 'scripts/run.ts']
      })

      await skillService.install({
        installSource: 'github:https://github.com/owner/repo/blob/main/SKILL.md'
      })

      const installedDirectory = installSpy.mock.calls[0][0] as string
      await expect(fs.promises.access(path.join(installedDirectory, 'SKILL.md'))).resolves.toBeUndefined()
      await expect(fs.promises.access(path.join(installedDirectory, '.git'))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('uses the longest slash-bearing ref for a repository-root SKILL.md', async () => {
      const { skillService, gitCalls } = await setupGithubInstall({
        refs: [
          { name: 'feature', oid: 'a'.repeat(40) },
          { name: 'feature/foo', oid: 'b'.repeat(40) }
        ],
        tree: ['SKILL.md']
      })

      await skillService.install({ installSource: 'github:https://github.com/owner/repo/blob/feature/foo/SKILL.md' })

      expect(gitFetchArgs(gitCalls)).toEqual(expect.arrayContaining(['b'.repeat(40)]))
    })

    it('installs a repository-root Skill from a full commit permalink', async () => {
      const oid = 'c'.repeat(40)
      const { skillService, installSpy, gitCalls } = await setupGithubInstall({ tree: ['SKILL.md'] })

      await skillService.install({ installSource: `github:https://github.com/owner/repo/blob/${oid}/SKILL.md` })

      expect(gitFetchArgs(gitCalls)).toEqual(expect.arrayContaining([oid]))
      expect(installSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${path.sep}content`),
        'marketplace',
        `https://github.com/owner/repo/blob/${oid}/SKILL.md`
      )
    })

    it('uses an explicit tag namespace when a branch has the same name', async () => {
      const tagOid = 'b'.repeat(40)
      const { skillService, installSpy, gitCalls } = await setupGithubInstall({
        refs: [
          { name: 'v1', oid: 'a'.repeat(40) },
          { name: 'v1', oid: tagOid, namespace: 'tags' }
        ]
      })

      await skillService.install({
        installSource: 'github:https://github.com/owner/repo/raw/refs/tags/v1/skills/demo/SKILL.md'
      })

      expect(gitFetchArgs(gitCalls)).toEqual(expect.arrayContaining([tagOid]))
      expect(installSpy).toHaveBeenCalledWith(
        expect.any(String),
        'marketplace',
        'https://raw.githubusercontent.com/owner/repo/refs/tags/v1/skills/demo/SKILL.md'
      )
    })

    it('installs the exact lowercase descriptor selected by the URL', async () => {
      const { skillService, installSpy } = await setupGithubInstall({
        refs: [{ name: 'main', oid: 'a'.repeat(40) }],
        tree: ['skills/demo/skill.md']
      })

      await skillService.install({
        installSource: 'github:https://raw.githubusercontent.com/owner/repo/main/skills/demo/skill.md'
      })

      const installedDirectory = installSpy.mock.calls[0][0] as string
      await expect(fs.promises.access(path.join(installedDirectory, 'skill.md'))).resolves.toBeUndefined()
    })

    it('rejects a missing exact descriptor before checkout', async () => {
      const { skillService, gitCalls } = await setupGithubInstall({
        refs: [{ name: 'main', oid: 'a'.repeat(40) }],
        tree: ['skills/demo/skill.md']
      })

      await expect(
        skillService.install({
          installSource: 'github:https://github.com/owner/repo/blob/main/skills/demo/SKILL.md'
        })
      ).rejects.toThrow('No SKILL.md found')
      expect(gitCalls.some((args) => args.includes('checkout'))).toBe(false)
    })

    it('rejects an oversized selected target before checkout', async () => {
      const { skillService, gitCalls } = await setupGithubInstall({
        refs: [{ name: 'main', oid: 'a'.repeat(40) }],
        tree: ['skills/demo/SKILL.md', { path: 'skills/demo/model.bin', size: 100 * 1024 * 1024 }]
      })

      await expect(
        skillService.install({
          installSource: 'github:https://github.com/owner/repo/blob/main/skills/demo/SKILL.md'
        })
      ).rejects.toThrow('too large')
      expect(gitCalls.some((args) => args.includes('checkout'))).toBe(false)
    })

    it('refuses a ref name carried by both a branch and a tag', async () => {
      const { skillService } = await setupGithubInstall({
        refs: [
          { name: 'v1', oid: 'a'.repeat(40) },
          { name: 'v1', oid: 'b'.repeat(40), namespace: 'tags' }
        ]
      })

      await expect(
        skillService.install({ installSource: 'github:https://github.com/owner/repo/blob/v1/skills/demo/SKILL.md' })
      ).rejects.toThrow('both a branch and a tag')
    })

    it('installs a commit permalink even though it matches no ref', async () => {
      const oid = 'c'.repeat(40)
      const { skillService, gitCalls } = await setupGithubInstall({ refs: [{ name: 'main', oid: 'a'.repeat(40) }] })

      await skillService.install({
        installSource: `github:https://github.com/owner/repo/blob/${oid}/skills/demo/SKILL.md`
      })

      expect(gitFetchArgs(gitCalls)).toEqual(expect.arrayContaining([oid]))
    })

    it.each(['heads', 'tags'] as const)('does not treat a missing explicit %s ref as a commit', async (namespace) => {
      const oid = 'c'.repeat(40)
      const { skillService, gitCalls } = await setupGithubInstall({
        refs: [{ name: 'main', oid: 'a'.repeat(40) }]
      })

      await expect(
        skillService.install({
          installSource: `github:https://raw.githubusercontent.com/owner/repo/refs/${namespace}/${oid}/skills/demo/SKILL.md`
        })
      ).rejects.toThrow('No branch or tag')
      expect(gitFetchArgs(gitCalls)).toBeUndefined()
    })

    it('fails a github URL whose ref matches no branch, tag or commit', async () => {
      const { skillService, gitCalls } = await setupGithubInstall({ refs: [{ name: 'main', oid: 'a'.repeat(40) }] })

      await expect(
        skillService.install({ installSource: 'github:https://github.com/owner/repo/blob/nope/skills/demo/SKILL.md' })
      ).rejects.toThrow('No branch or tag')
      expect(gitFetchArgs(gitCalls)).toBeUndefined()
    })

    it('does not inspect a case-variant sibling outside the selected directory', async () => {
      const { skillService } = await setupGithubInstall({
        refs: [{ name: 'main', oid: 'a'.repeat(40) }],
        tree: ['skills/demo/SKILL.md', 'skills/Demo/SKILL.md']
      })

      await expect(
        skillService.install({ installSource: 'github:https://github.com/owner/repo/blob/main/skills/demo/SKILL.md' })
      ).resolves.toBeDefined()
    })

    it('refuses case-folded directory collisions inside the selected skill', async () => {
      const { skillService } = await setupGithubInstall({
        refs: [{ name: 'main', oid: 'a'.repeat(40) }],
        tree: ['skills/demo/SKILL.md', 'skills/demo/Docs/a.md', 'skills/demo/docs/b.md']
      })

      await expect(
        skillService.install({ installSource: 'github:https://github.com/owner/repo/blob/main/skills/demo/SKILL.md' })
      ).rejects.toThrow('collide')
    })

    it('materializes only the selected directory instead of the whole repository', async () => {
      const { skillService, gitCalls } = await setupGithubInstall({ refs: [{ name: 'main', oid: 'a'.repeat(40) }] })

      await skillService.install({
        installSource: 'github:https://github.com/owner/repo/blob/main/skills/demo/SKILL.md'
      })

      expect(gitFetchArgs(gitCalls)).toEqual(expect.arrayContaining(['--filter=blob:none']))
      expect(gitCalls.find((args) => args.includes('checkout'))).toEqual(
        expect.arrayContaining(['--', ':(top,literal)skills/demo'])
      )
      expect(gitCalls.filter((args) => args.includes('ls-tree'))).toEqual([
        expect.arrayContaining(['--', ':(top,literal)skills/demo'])
      ])
      const treeCall = executeCommandMock.mock.calls.find(([, args]) => args.includes('ls-tree'))
      expect(treeCall?.[2]).toMatchObject({ maxOutputBytes: expect.any(Number) })
    })

    it('never lets an untrusted repository prompt for credentials or pull LFS payloads', async () => {
      const { skillService } = await setupGithubInstall({ refs: [{ name: 'main', oid: 'a'.repeat(40) }] })

      await skillService.install({
        installSource: 'github:https://github.com/owner/repo/blob/main/skills/demo/SKILL.md'
      })

      for (const [, , options] of executeCommandMock.mock.calls) {
        expect(options.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' })
        expect(options.timeout).toBeGreaterThan(0)
      }
    })

    it('rejects a github URL that does not point at a SKILL.md file before cloning', async () => {
      const skillService = new SkillService()
      const createTempDirSpy = vi.mocked(skillPaths.createTempDir)

      for (const url of [
        'https://github.com/owner/repo',
        'https://github.com/owner/repo/tree/main/skills/recruit-init',
        'https://example.com/owner/repo/blob/main/skills/x/SKILL.md'
      ]) {
        await expect(skillService.install({ installSource: `github:${url}` })).rejects.toThrow(
          'Invalid GitHub skill URL'
        )
      }
      expect(createTempDirSpy).not.toHaveBeenCalled()
    })

    /**
     * Drives the clone-based install (claude-plugins / skills.sh) through a fake `executeCommand`
     * whose `clone` materializes the selected skill directory on disk.
     */
    async function setupClonedInstall() {
      const skillService = new SkillService()
      const workDir = await createTempDir('clone-install-')
      vi.mocked(skillPaths.createTempDir).mockResolvedValue(workDir)
      const gitCalls: Array<{ args: string[]; options?: { env?: Record<string, string>; timeout?: number } }> = []

      executeCommandMock.mockImplementation(async (_command: string, args: string[], options?: object) => {
        gitCalls.push({ args, options })
        if (args.includes('clone')) {
          await fs.promises.mkdir(path.join(workDir, 'skills', 'demo'), { recursive: true })
          await fs.promises.writeFile(path.join(workDir, 'skills', 'demo', 'SKILL.md'), '# skill')
        }
        return ''
      })

      const installSpy = vi.spyOn(skillService as never, 'installSkillDir').mockResolvedValue({} as never)
      vi.mocked(findSkillMdPath).mockImplementation(async (dir: string) => path.join(dir, 'SKILL.md'))
      return { skillService, gitCalls, installSpy, workDir }
    }

    const installFromClone = (skillService: SkillService) =>
      skillService.install({ installSource: 'claude-plugins:owner/repo/skills/demo' })

    it('persists the exact skills.sh Skill path instead of the cloned repository root', async () => {
      const { skillService, installSpy, workDir } = await setupClonedInstall()
      vi.mocked(findAllSkillDirectories).mockResolvedValueOnce([
        { folderPath: path.join(workDir, 'skills', 'demo'), sourcePath: 'skills/demo' }
      ])
      vi.mocked(parseSkillMetadata).mockResolvedValueOnce({ name: 'demo' } as never)

      await skillService.install({ installSource: 'skills.sh:owner/repo/demo' })

      expect(installSpy).toHaveBeenCalledWith(
        expect.stringContaining(path.join('skills', 'demo')),
        'marketplace',
        'https://skills.sh/owner/repo/demo'
      )
    })

    it('bounds a clone and blocks its credential prompts, the way the fetch path already is', async () => {
      const { skillService, gitCalls } = await setupClonedInstall()

      await installFromClone(skillService)

      expect(gitCalls).not.toHaveLength(0)
      for (const { options } of gitCalls) {
        expect(options?.timeout).toBeGreaterThan(0)
        expect(options?.env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' })
      }
    })

    it('hands git the proxy Cherry is configured with, which the captured login shell env never carries', async () => {
      vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890')
      const { skillService, gitCalls } = await setupClonedInstall()

      await installFromClone(skillService)

      expect(gitCalls).not.toHaveLength(0)
      for (const { options } of gitCalls) {
        expect(options?.env).toMatchObject({ HTTPS_PROXY: 'http://127.0.0.1:7890' })
      }
    })

    it('surfaces a failed clone instead of spending another timeout on the same unreachable remote', async () => {
      const { skillService, gitCalls } = await setupClonedInstall()
      executeCommandMock.mockImplementation(async (_command: string, args: string[], options?: object) => {
        gitCalls.push({ args, options })
        throw new Error('Command timed out after 120000ms')
      })

      await expect(installFromClone(skillService)).rejects.toThrow('Command timed out')
      expect(gitCalls).toHaveLength(1)
    })

    it('rejects a clawhub source without its publisher identity', async () => {
      const skillService = new SkillService()

      await expect(skillService.install({ installSource: 'clawhub:my-skill' })).rejects.toThrow(
        'Invalid clawhub identifier: my-skill'
      )
    })

    it('rejects clawhub metadata that does not match the reviewed publisher', async () => {
      const skillService = new SkillService()
      vi.mocked(net.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            skill: { slug: 'code', displayName: 'Code', summary: 'Coding workflow' },
            owner: { handle: 'another-owner', displayName: 'Another Owner', image: null },
            moderation: null
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200
          }
        )
      )

      try {
        await expect(skillService.install({ installSource: 'clawhub:ivangdavila/code' })).rejects.toThrow(
          'clawhub detail did not match the requested skill: ivangdavila/code'
        )
        expect(net.fetch).toHaveBeenCalledTimes(1)
      } finally {
        vi.mocked(net.fetch).mockReset()
      }
    })

    it('binds clawhub detail and download requests to the reviewed owner and root skill', async () => {
      const skillService = new SkillService()
      const tempDir = await createTempDir('skill-clawhub-install-')
      const extractDir = path.join(tempDir, 'code')
      await fs.promises.mkdir(extractDir, { recursive: true })
      const canonicalExtractDir = await fs.promises.realpath(extractDir)
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
          new Response(
            JSON.stringify({
              skill: { slug: 'code', displayName: 'Code', summary: 'Coding workflow' },
              owner: { handle: 'ivangdavila', displayName: 'Ivan', image: null },
              moderation: null
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 200
            }
          )
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      const createTempDirSpy = vi.mocked(skillPaths.createTempDir).mockResolvedValue(tempDir as never)
      const extractZipSpy = vi.mocked(skillArchive.extractZip).mockImplementation(async () => {
        await fs.promises.writeFile(path.join(extractDir, 'SKILL.md'), '---\nname: code\n---\n')
        await fs.promises.mkdir(path.join(extractDir, 'nested'), { recursive: true })
        await fs.promises.writeFile(path.join(extractDir, 'nested', 'SKILL.md'), '---\nname: nested\n---\n')
      })
      vi.mocked(findSkillMdPath).mockImplementation(async (directory) => path.join(directory, 'SKILL.md'))
      vi.mocked(parseSkillMetadata).mockResolvedValueOnce({ name: 'Code', slug: 'code' } as never)
      const installSkillDirSpy = vi
        .spyOn(skillService as never, 'installSkillDir')
        .mockResolvedValue(installedSkill as never)

      try {
        const result = await skillService.install({ installSource: 'clawhub:ivangdavila/code' })

        expect(result).toBe(installedSkill)
        expect(net.fetch).toHaveBeenNthCalledWith(1, 'https://clawhub.ai/api/v1/skills/code?ownerHandle=ivangdavila', {
          headers: { 'User-Agent': 'CherryStudio' }
        })
        expect(net.fetch).toHaveBeenNthCalledWith(
          2,
          'https://clawhub.ai/api/v1/download?slug=code&ownerHandle=ivangdavila',
          {
            headers: { 'User-Agent': 'CherryStudio' }
          }
        )
        expect(createTempDirSpy).toHaveBeenCalledWith('clawhub')
        expect(extractZipSpy).toHaveBeenCalledWith(path.join(tempDir, 'skill.zip'), extractDir)
        expect(parseSkillMetadata).toHaveBeenCalledWith(canonicalExtractDir, 'code', 'skills', {
          calculateSize: false
        })
        expect(installSkillDirSpy).toHaveBeenCalledWith(
          canonicalExtractDir,
          'marketplace',
          'https://clawhub.ai/ivangdavila/skills/code'
        )
      } finally {
        createTempDirSpy.mockRestore()
        extractZipSpy.mockRestore()
        installSkillDirSpy.mockRestore()
        vi.mocked(net.fetch).mockReset()
      }
    })

    it('uses the canonical ZIP path for extraction and provenance', async () => {
      const skillService = new SkillService()
      const root = await createTempDir('skill-zip-install-')
      const realZipPath = path.join(root, 'source.zip')
      const linkedZipPath = path.join(root, 'linked.zip')
      const extractDir = path.join(root, 'extract')
      const locatedSkillDir = path.join(extractDir, 'skill')
      await fs.promises.writeFile(realZipPath, new Uint8Array([1, 2, 3]))
      await fs.promises.symlink(realZipPath, linkedZipPath)
      await fs.promises.mkdir(extractDir, { recursive: true })
      const canonicalZipPath = await fs.promises.realpath(realZipPath)

      vi.mocked(skillPaths.createTempDir).mockResolvedValue(extractDir as never)
      const extractZipSpy = vi.mocked(skillArchive.extractZip).mockResolvedValue(undefined as never)
      vi.mocked(skillArchive.resolveSkillDirectory).mockResolvedValue(locatedSkillDir as never)
      const installSkillDirSpy = vi.spyOn(skillService as never, 'installSkillDir').mockResolvedValue({} as never)

      await skillService.installFromZip({ zipFilePath: linkedZipPath })

      expect(extractZipSpy).toHaveBeenCalledWith(canonicalZipPath, extractDir)
      expect(installSkillDirSpy).toHaveBeenCalledWith(locatedSkillDir, 'zip', pathToFileURL(canonicalZipPath).href)
    })

    it('accepts ZIP archives containing 2,000 entries', async () => {
      const root = await createTempDir('skill-zip-limit-')
      const zipPath = path.join(root, 'limit.zip')
      const extractDir = path.join(root, 'extract')
      const zip = new AdmZip()
      for (let index = 0; index < 2_000; index++) zip.addFile(`${index}.txt`, Buffer.alloc(0))
      zip.writeZip(zipPath)
      await fs.promises.mkdir(extractDir)

      await expect(skillArchive.extractZip(zipPath, extractDir)).resolves.toBeUndefined()
    })

    it('rejects ZIP archives containing more than 2,000 entries', async () => {
      const root = await createTempDir('skill-zip-limit-')
      const zipPath = path.join(root, 'over-limit.zip')
      const extractDir = path.join(root, 'extract')
      const zip = new AdmZip()
      for (let index = 0; index < 2_001; index++) zip.addFile(`${index}.txt`, Buffer.alloc(0))
      zip.writeZip(zipPath)

      await expect(skillArchive.extractZip(zipPath, extractDir)).rejects.toThrow(
        'ZIP has too many files: 2001 exceeds 2000'
      )
    })

    it.each([
      ['outside the clone', async () => createTempDir('skill-external-')],
      [
        'at another directory in the same clone',
        async (repoDir: string) => {
          const other = path.join(repoDir, 'other-skill')
          await fs.promises.mkdir(other, { recursive: true })
          return other
        }
      ]
    ])('rejects a selected skill directory that is a symlink pointing %s', async (_case, createTarget) => {
      // Containment alone cannot catch the in-repo case: the target stays inside the clone, so the
      // user would silently install a different skill than the URL named.
      const repoDir = await createTempDir('skill-repo-')
      const targetDir = await createTarget(repoDir)
      await fs.promises.writeFile(path.join(targetDir, 'SKILL.md'), '# target')
      await fs.promises.symlink(targetDir, path.join(repoDir, 'linked'), 'dir')
      vi.mocked(findSkillMdPath).mockResolvedValue(path.join(targetDir, 'SKILL.md'))

      await expect(skillArchive.resolveSkillDirectory(repoDir, null, 'linked')).rejects.toThrow(
        'passes through a symlink'
      )
    })

    it('accepts an in-repository directory whose name starts with two dots', async () => {
      const repoDir = await createTempDir('skill-repo-')
      const skillDir = path.join(repoDir, '..archive')
      await fs.promises.mkdir(skillDir, { recursive: true })
      await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), '# archive')
      vi.mocked(findSkillMdPath).mockResolvedValue(path.join(skillDir, 'SKILL.md'))

      await expect(skillArchive.resolveSkillDirectory(repoDir, null, '..archive')).resolves.toBe(
        await fs.promises.realpath(skillDir)
      )
    })

    it('fails closed when an explicit skills.sh target is not present', async () => {
      const repoDir = await createTempDir('skill-repo-')
      const otherSkill = path.join(repoDir, 'other-skill')
      await fs.promises.mkdir(otherSkill, { recursive: true })
      await fs.promises.writeFile(path.join(otherSkill, 'SKILL.md'), '# other')
      vi.mocked(findAllSkillDirectories).mockResolvedValue([{ folderPath: otherSkill, sourcePath: 'other-skill' }])
      vi.mocked(parseSkillMetadata).mockResolvedValue({ name: 'other-skill' } as never)

      await expect(skillArchive.resolveSkillDirectory(repoDir, 'requested-skill', null)).rejects.toThrow(
        'No SKILL.md found for the specified skill: requested-skill'
      )
    })

    it('selects the unique skills.sh candidate whose metadata name matches the reviewed skill id', async () => {
      const repoDir = await createTempDir('skill-repo-')
      const first = path.join(repoDir, 'first', 'shared-name')
      const second = path.join(repoDir, 'second', 'shared-name')
      await Promise.all([fs.promises.mkdir(first, { recursive: true }), fs.promises.mkdir(second, { recursive: true })])
      await Promise.all([
        fs.promises.writeFile(path.join(first, 'SKILL.md'), '# first'),
        fs.promises.writeFile(path.join(second, 'SKILL.md'), '# second')
      ])
      vi.mocked(findAllSkillDirectories).mockResolvedValue([
        { folderPath: first, sourcePath: 'first/shared-name' },
        { folderPath: second, sourcePath: 'second/shared-name' }
      ])
      vi.mocked(parseSkillMetadata).mockImplementation(async (skillPath) => {
        return { name: skillPath === second ? 'reviewed-skill' : 'another-skill' } as never
      })
      vi.mocked(findSkillMdPath).mockImplementation(async (directory) => path.join(directory, 'SKILL.md'))

      await expect(skillArchive.resolveSkillDirectory(repoDir, 'reviewed-skill', null)).resolves.toBe(
        await fs.promises.realpath(second)
      )
    })

    it('rejects skills.sh candidates only when multiple descriptors claim the reviewed skill id', async () => {
      const repoDir = await createTempDir('skill-repo-')
      const first = path.join(repoDir, 'first', 'shared-name')
      const second = path.join(repoDir, 'second', 'shared-name')
      vi.mocked(findAllSkillDirectories).mockResolvedValue([
        { folderPath: first, sourcePath: 'first/shared-name' },
        { folderPath: second, sourcePath: 'second/shared-name' }
      ])
      vi.mocked(parseSkillMetadata).mockResolvedValue({ name: 'reviewed-skill' } as never)

      await expect(skillArchive.resolveSkillDirectory(repoDir, 'reviewed-skill', null)).rejects.toThrow(
        'Multiple SKILL.md files declare the specified skill: reviewed-skill'
      )
    })
  })

  describe('syncBuiltinSkill', () => {
    const FOLDER_NAME = 'my-builtin'
    const APP_VERSION = '2.0.0'
    let sourcePath: string
    let destPath: string
    let restoreGetPath = () => {}

    beforeEach(async () => {
      vi.mocked(parseSkillMetadata).mockClear()
      const root = await createTempDir('builtin-skill-')
      const sourceRoot = path.join(root, 'resources')
      const storageRoot = path.join(root, 'Data', 'Skills')
      const mirrorRoot = path.join(root, '.claude', 'skills')
      sourcePath = path.join(sourceRoot, FOLDER_NAME)
      destPath = path.join(storageRoot, FOLDER_NAME)
      await fs.promises.mkdir(sourcePath, { recursive: true })
      await fs.promises.mkdir(mirrorRoot, { recursive: true })
      await fs.promises.writeFile(path.join(sourcePath, 'SKILL.md'), '# Builtin')
      vi.mocked(findSkillMdPath).mockImplementation(async (directory) => path.join(directory, 'SKILL.md'))
      const spy = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
        if (key === 'feature.agents.skills') return filename ? path.join(storageRoot, filename) : storageRoot
        if (key === 'feature.agents.claude.skills') return filename ? path.join(mirrorRoot, filename) : mirrorRoot
        return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
      })
      restoreGetPath = () => spy.mockRestore()
      vi.mocked(parseSkillMetadata).mockResolvedValue({
        name: 'My Builtin',
        description: 'A builtin skill',
        author: 'cherry',
        tags: ['ai'],
        command: '',
        version: '1.0.0'
      } as never)
    })

    afterEach(() => {
      vi.mocked(findSkillMdPath).mockReset()
      restoreGetPath()
    })

    it('does not re-copy or re-parse metadata when the builtin version and full content hash match', async () => {
      const skillService = new SkillService()
      await fs.promises.mkdir(destPath, { recursive: true })
      await fs.promises.writeFile(path.join(destPath, 'SKILL.md'), '# Builtin')
      await fs.promises.writeFile(path.join(destPath, '.version'), APP_VERSION)
      const contentHash = await skillService['computeBuiltinDirectoryHash'](sourcePath)
      await seedAgent()
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'My Builtin',
        folderName: FOLDER_NAME,
        source: 'builtin',
        contentHash,
        isEnabled: false
      })
      const installSpy = vi.spyOn(skillService['installer'], 'install')

      await skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION)

      expect(installSpy).not.toHaveBeenCalled()
      expect(parseSkillMetadata).not.toHaveBeenCalled()
    })

    it('never writes agent_skill rows, leaving per-agent enablement to the read-time builtin default', async () => {
      const skillService = new SkillService()
      await fs.promises.mkdir(destPath, { recursive: true })
      await fs.promises.writeFile(path.join(destPath, 'SKILL.md'), '# Builtin')
      await fs.promises.writeFile(path.join(destPath, '.version'), APP_VERSION)
      const contentHash = await skillService['computeBuiltinDirectoryHash'](sourcePath)
      await seedAgent()
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'My Builtin',
        folderName: FOLDER_NAME,
        source: 'builtin',
        contentHash,
        isEnabled: false
      })
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_BUILTIN, isEnabled: false })

      await skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION)

      const rows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_BUILTIN))
      expect(rows).toEqual([expect.objectContaining({ agentId: AGENT_ID, isEnabled: false })])
    })

    it('updates metadata when skill exists and files were updated', async () => {
      const skillService = new SkillService()
      const contentHash = await skillService['computeBuiltinDirectoryHash'](sourcePath)
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'Old Name',
        folderName: FOLDER_NAME,
        source: 'builtin',
        contentHash: 'hash1',
        isEnabled: false
      })

      await skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION)

      const [row] = await dbh.db
        .select()
        .from(agentGlobalSkillTable)
        .where(eq(agentGlobalSkillTable.id, SKILL_ID_BUILTIN))
      expect(row?.name).toBe('My Builtin')
      expect(row?.version).toBe('1.0.0')
      expect(row?.contentHash).toBe(contentHash)
    })

    it('inserts a new builtin skill on first install, already enabled for existing agents without any agent_skill row', async () => {
      const skillService = new SkillService()
      const contentHash = await skillService['computeBuiltinDirectoryHash'](sourcePath)
      await seedAgent()

      await skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION)

      const rows = await dbh.db
        .select()
        .from(agentGlobalSkillTable)
        .where(eq(agentGlobalSkillTable.folderName, FOLDER_NAME))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.source).toBe('builtin')
      expect(rows[0]?.version).toBe('1.0.0')
      expect(rows[0]?.contentHash).toBe(contentHash)

      const joinRows = await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.agentId, AGENT_ID))
      expect(joinRows).toHaveLength(0)
      const [installed] = await skillService.list({ agentId: AGENT_ID })
      expect(installed?.isEnabled).toBe(true)
    })

    it('records conditional builtin ownership and preserves it across updates', async () => {
      const skillService = new SkillService()

      await skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION, 'code-cli:test')
      const initial = await skillService.getByFolderName(FOLDER_NAME)
      await fs.promises.writeFile(path.join(sourcePath, 'SKILL.md'), '# Updated Builtin')
      await skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION, 'code-cli:test')
      const updated = await skillService.getByFolderName(FOLDER_NAME)

      expect(updated).toMatchObject({ id: initial?.id, namespace: 'code-cli:test', source: 'builtin' })
    })

    it('refuses to replace a builtin owned by another namespace', async () => {
      const skillService = new SkillService()
      await skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION, 'code-cli:first')

      await expect(
        skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION, 'code-cli:second')
      ).rejects.toThrow(/belongs to builtin namespace/)
    })

    it('only uninstalls a conditional builtin for its owning namespace', async () => {
      const skillService = new SkillService()
      await skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION, 'code-cli:test')

      await expect(skillService.uninstallBuiltinSkill(FOLDER_NAME, 'code-cli:other')).rejects.toThrow(
        /not owned by builtin namespace/
      )
      await expect(skillService.getByFolderName(FOLDER_NAME)).resolves.not.toBeNull()

      await expect(skillService.uninstallBuiltinSkill(FOLDER_NAME, 'code-cli:test')).resolves.toBe(true)
      await expect(skillService.getByFolderName(FOLDER_NAME)).resolves.toBeNull()
    })

    it('rejects a cross-source builtin collision before overwriting user content', async () => {
      const skillService = new SkillService()
      await fs.promises.mkdir(destPath, { recursive: true })
      await fs.promises.writeFile(path.join(destPath, 'SKILL.md'), '# User Authored')
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_1,
        name: 'User Authored',
        folderName: FOLDER_NAME,
        source: 'local',
        contentHash: 'user-hash',
        isEnabled: false
      })
      const installSpy = vi.spyOn(skillService['installer'], 'install')

      await expect(skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION)).rejects.toThrow(
        /refusing to overwrite/
      )

      expect(installSpy).not.toHaveBeenCalled()
      await expect(fs.promises.readFile(path.join(destPath, 'SKILL.md'), 'utf-8')).resolves.toBe('# User Authored')
      const [row] = await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID_1))
      expect(row?.source).toBe('local')
    })

    it('restores modified builtin files even when the app version is unchanged', async () => {
      const skillService = new SkillService()
      await fs.promises.mkdir(path.join(sourcePath, 'scripts'), { recursive: true })
      await fs.promises.writeFile(path.join(sourcePath, 'scripts', 'run.sh'), 'trusted')
      await fs.promises.cp(sourcePath, destPath, { recursive: true })
      await fs.promises.writeFile(path.join(destPath, '.version'), APP_VERSION)
      const contentHash = await skillService['computeBuiltinDirectoryHash'](sourcePath)
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'My Builtin',
        folderName: FOLDER_NAME,
        source: 'builtin',
        contentHash,
        isEnabled: false
      })
      await fs.promises.writeFile(path.join(destPath, 'scripts', 'run.sh'), 'modified')

      await expect(skillService.syncBuiltinSkill(FOLDER_NAME, sourcePath, APP_VERSION)).resolves.toBe(true)

      await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('trusted')
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
      vi.mocked(findSkillMdPath).mockImplementation(async (directory) => {
        for (const filename of ['SKILL.md', 'skill.md']) {
          const candidate = path.join(directory, filename)
          try {
            await fs.promises.access(candidate)
            return candidate
          } catch {
            // Try the other supported casing.
          }
        }
        return null
      })
      const spy = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
        if (key === 'feature.agents.skills') return filename ? path.join(dataSkillsRoot, filename) : dataSkillsRoot
        if (key === 'feature.agents.claude.skills') return filename ? path.join(mirrorRoot, filename) : mirrorRoot
        return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
      })
      restoreGetPath = () => spy.mockRestore()
    })

    afterEach(() => {
      vi.mocked(findSkillMdPath).mockReset()
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
      expect((await fs.promises.lstat(path.join(mirrorRoot, 'pdf'))).isSymbolicLink()).toBe(!isWin)

      await skillService.unlinkMirror('pdf')
      await expect(fs.promises.access(path.join(mirrorRoot, 'pdf'))).rejects.toThrow()
    })

    it('linkMirror replaces a broken mirror symlink', async () => {
      await writeLibrarySkill('pdf')
      if (isWin) {
        await fs.promises.mkdir(path.join(mirrorRoot, 'pdf'), { recursive: true })
      } else {
        await fs.promises.symlink(path.join(dataSkillsRoot, 'missing'), path.join(mirrorRoot, 'pdf'), 'dir')
      }

      await skillService.linkMirror('pdf')

      await expect(fs.promises.access(path.join(mirrorRoot, 'pdf', 'SKILL.md'))).resolves.toBeUndefined()
      const mirrored = path.join(mirrorRoot, 'pdf')
      const managed = path.join(dataSkillsRoot, 'pdf')
      expect((await fs.promises.lstat(mirrored)).isSymbolicLink()).toBe(!isWin)
      if (isWin) {
        await expect(fs.promises.readFile(path.join(mirrored, 'SKILL.md'), 'utf-8')).resolves.toBe(
          await fs.promises.readFile(path.join(managed, 'SKILL.md'), 'utf-8')
        )
      } else {
        expect(path.normalize(await fs.promises.realpath(mirrored))).toBe(
          path.normalize(await fs.promises.realpath(managed))
        )
      }
    })

    it('linkMirror removes a stale mirror when the library descriptor is missing', async () => {
      await fs.promises.mkdir(path.join(mirrorRoot, 'ghost'), { recursive: true })
      await fs.promises.writeFile(path.join(mirrorRoot, 'ghost', 'SKILL.md'), '# stale')
      const warnSpy = vi.spyOn(loggerService.withContext('SkillService'), 'warn').mockImplementation(() => undefined)
      try {
        await skillService.linkMirror('ghost')
        expect(warnSpy).toHaveBeenCalledWith(
          'Skill source descriptor unavailable; removed mirror',
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

    it('persists and updates the SKILL.md version when reinstalling the same origin', async () => {
      const sourceDir = await createTempDir('versioned-skill-')
      const sourceUrl = pathToFileURL(sourceDir).href
      await fs.promises.writeFile(path.join(sourceDir, 'SKILL.md'), '# Version 1')
      vi.mocked(parseSkillMetadata).mockResolvedValue(skillMeta('versioned-skill', { version: '1.0.0' }))

      const installed = await skillService['installSkillDir'](sourceDir, 'local', sourceUrl)

      expect(installed.version).toBe('1.0.0')

      await fs.promises.writeFile(path.join(sourceDir, 'SKILL.md'), '# Version 2')
      vi.mocked(parseSkillMetadata).mockResolvedValue(skillMeta('versioned-skill', { version: '2.0.0' }))

      const updated = await skillService['installSkillDir'](sourceDir, 'local', sourceUrl)

      expect(updated).toMatchObject({ id: installed.id, version: '2.0.0' })
    })

    function skillMeta(folderName: string, overrides: Record<string, unknown> = {}) {
      return {
        sourcePath: folderName,
        filename: folderName,
        name: folderName,
        description: undefined,
        tools: undefined,
        category: 'skills',
        type: 'skill',
        tags: [],
        version: undefined,
        author: undefined,
        size: 0,
        contentHash: 'x',
        ...overrides
      } as unknown as Awaited<ReturnType<typeof parseSkillMetadata>>
    }

    it('reconcileSkills heals mirrors, prunes non-builtin skills whose files are gone, keeps builtins', async () => {
      vi.mocked(parseSkillMetadata).mockReset()
      // skill-one: files present → mirrored, kept. gone: no files, marketplace → pruned.
      // builtin-gone: no files but builtin → kept (installBuiltinSkills owns builtins).
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
        { id: SKILL_ID_2, name: 'gone', folderName: 'gone', source: 'marketplace', contentHash: 'b', isEnabled: false },
        {
          id: SKILL_ID_BUILTIN,
          name: 'builtin-gone',
          folderName: 'builtin-gone',
          source: 'builtin',
          contentHash: 'c',
          isEnabled: false
        }
      ])

      await skillService.reconcileSkills()

      // plugin bridge manifest written
      await expect(
        fs.promises.readFile(path.join(path.dirname(mirrorRoot), '.claude-plugin', 'plugin.json'), 'utf-8')
      ).resolves.toBe('{\n  "name": "cherry-studio-skills"\n}\n')
      // heal: skill-one mirrored
      await expect(fs.promises.access(path.join(mirrorRoot, 'skill-one', 'SKILL.md'))).resolves.toBeUndefined()
      // prune: non-builtin 'gone' removed
      expect(
        await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.folderName, 'gone'))
      ).toHaveLength(0)
      // builtin kept despite missing files
      expect(
        await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.folderName, 'builtin-gone'))
      ).toHaveLength(1)
    })

    it('reconcileSkills adopts a skill authored directly in the managed library', async () => {
      vi.mocked(parseSkillMetadata).mockResolvedValue(
        skillMeta('new-skill', { name: 'New Skill', description: 'freshly authored', version: '3.0.0' })
      )
      const authored = await writeLibrarySkill('new-skill', '# new')

      await skillService.reconcileSkills()

      const rows = await dbh.db
        .select()
        .from(agentGlobalSkillTable)
        .where(eq(agentGlobalSkillTable.folderName, 'new-skill'))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.source).toBe('local')
      expect(rows[0]?.name).toBe('New Skill')
      expect(rows[0]?.version).toBe('3.0.0')
      expect(rows[0]?.isEnabled).toBe(true)
      await expect(fs.promises.access(path.join(authored, 'SKILL.md'))).resolves.toBeUndefined()
      expect((await fs.promises.lstat(path.join(mirrorRoot, 'new-skill'))).isSymbolicLink()).toBe(!isWin)
    })

    it('treats different local directories as different install origins', async () => {
      vi.mocked(parseSkillMetadata).mockResolvedValue(skillMeta('same-name'))
      vi.spyOn(skillService['installer'], 'computeContentHash').mockResolvedValue('local')
      const first = await createTempDir('local-origin-first-')
      const second = await createTempDir('local-origin-second-')
      await fs.promises.writeFile(path.join(first, 'SKILL.md'), '# first')
      await fs.promises.writeFile(path.join(second, 'SKILL.md'), '# second')

      const installed = await skillService.installFromDirectory({ directoryPath: first })
      await expect(skillService.installFromDirectory({ directoryPath: second })).rejects.toThrow(
        /refusing to overwrite/
      )

      expect(installed.sourceUrl).toMatch(/^file:/)
      await expect(fs.promises.readFile(path.join(dataSkillsRoot, 'same-name', 'SKILL.md'), 'utf-8')).resolves.toBe(
        '# first'
      )
    })

    it('reconcileSkills removes an unknown real directory from the app-owned mirror', async () => {
      vi.mocked(parseSkillMetadata).mockReset()
      // Windows mirrors are real directory copies, so unknown real directories must be removed just
      // like stale POSIX symlinks. The canonical library is the only writable source of truth.
      const dropped = path.join(mirrorRoot, 'dropped')
      await fs.promises.mkdir(dropped, { recursive: true })
      await fs.promises.writeFile(path.join(dropped, 'SKILL.md'), '# dropped')

      await skillService.reconcileSkills()

      expect(
        await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.folderName, 'dropped'))
      ).toHaveLength(0)
      await expect(fs.promises.access(path.join(mirrorRoot, 'dropped'))).rejects.toThrow()
      await expect(fs.promises.access(path.join(dataSkillsRoot, 'dropped'))).rejects.toThrow()
    })

    it('reconcileSkills does not prune the catalog when the library root is unreadable', async () => {
      vi.mocked(parseSkillMetadata).mockReset()
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_1,
        name: 'ghost',
        folderName: 'ghost',
        source: 'marketplace',
        contentHash: 'a',
        isEnabled: false
      })
      // Simulate a transient read failure of the library root.
      await fs.promises.rm(dataSkillsRoot, { recursive: true, force: true })

      const warnSpy = vi.spyOn(loggerService.withContext('SkillService'), 'warn').mockImplementation(() => undefined)
      try {
        await skillService.reconcileSkills()
        expect(
          await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.folderName, 'ghost'))
        ).toHaveLength(1)
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('reconcileSkills keeps a catalog row whose descriptor is present but unreadable', async () => {
      vi.mocked(parseSkillMetadata).mockReset()
      // SKILL.md exists but reading it throws a non-ENOENT error (here EISDIR: it is a directory),
      // standing in for EACCES / EIO / an atomic-replace window. This must NOT be treated as deletion.
      const dir = path.join(dataSkillsRoot, 'locked')
      await fs.promises.mkdir(path.join(dir, 'SKILL.md'), { recursive: true })
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_1,
        name: 'locked',
        folderName: 'locked',
        source: 'marketplace',
        contentHash: 'a',
        isEnabled: false
      })

      const warnSpy = vi.spyOn(loggerService.withContext('SkillService'), 'warn').mockImplementation(() => undefined)
      try {
        await skillService.reconcileSkills()
        expect(
          await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.folderName, 'locked'))
        ).toHaveLength(1)
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('reconcileSkills normalizes a lowercase skill.md and still mirrors + adopts it', async () => {
      vi.mocked(parseSkillMetadata).mockResolvedValue(skillMeta('lower', { name: 'Lower' }))
      // Author wrote a lowercase descriptor (only distinguishable on case-sensitive filesystems).
      const dir = path.join(dataSkillsRoot, 'lower')
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(path.join(dir, 'skill.md'), '# lower')

      await skillService.reconcileSkills()

      // resolves as SKILL.md (renamed on case-sensitive FS, same file on case-insensitive)
      await expect(fs.promises.access(path.join(dir, 'SKILL.md'))).resolves.toBeUndefined()
      // adopted into the catalog
      expect(
        await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.folderName, 'lower'))
      ).toHaveLength(1)
      // mirrored — would be skipped if the mirror only recognized uppercase SKILL.md
      await expect(fs.promises.access(path.join(mirrorRoot, 'lower', 'SKILL.md'))).resolves.toBeUndefined()
    })

    it('reconcileSkills keeps a row + agent_skill when the folder exists but its descriptor is gone (ENOENT window)', async () => {
      vi.mocked(parseSkillMetadata).mockReset()
      // The folder is present on disk but has no SKILL.md (either casing) — the atomic-save window
      // where an editor removed the old descriptor before writing the new one. Must NOT be pruned.
      await fs.promises.mkdir(path.join(dataSkillsRoot, 'saving'), { recursive: true })
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_1,
        name: 'saving',
        folderName: 'saving',
        source: 'marketplace',
        contentHash: 'a',
        isEnabled: false
      })
      await seedAgent()
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })

      await skillService.reconcileSkills()

      expect(
        await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.folderName, 'saving'))
      ).toHaveLength(1)
      // enablement survives — deleting the row would have cascade-removed this via the FK
      expect(await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_1))).toHaveLength(1)
    })

    it('reconcileLibraryToDb rechecks the canonical folder before pruning a stale snapshot', async () => {
      vi.mocked(parseSkillMetadata).mockReset()
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_1,
        name: 'racing',
        folderName: 'racing',
        source: 'marketplace',
        contentHash: 'a',
        isEnabled: false
      })
      await seedAgent()
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })

      const staleSnapshot = await fs.promises.readdir(dataSkillsRoot, { withFileTypes: true })
      await writeLibrarySkill('racing')
      const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockResolvedValueOnce(staleSnapshot as never)
      try {
        await skillService['reconcileLibraryToDb']()
      } finally {
        readdirSpy.mockRestore()
      }

      expect(
        await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID_1))
      ).toHaveLength(1)
      expect(await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_1))).toHaveLength(1)
    })

    it('reconcileSkills restores an interrupted install backup before pruning', async () => {
      vi.mocked(parseSkillMetadata).mockResolvedValue(skillMeta('saving'))
      const backup = path.join(dataSkillsRoot, '.saving.bak')
      await fs.promises.mkdir(backup, { recursive: true })
      await fs.promises.writeFile(path.join(backup, 'SKILL.md'), '# old complete copy')
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_1,
        name: 'saving',
        folderName: 'saving',
        source: 'marketplace',
        contentHash: 'a',
        isEnabled: false
      })
      await seedAgent()
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })

      await skillService.reconcileSkills()

      await expect(fs.promises.access(path.join(dataSkillsRoot, 'saving', 'SKILL.md'))).resolves.toBeUndefined()
      await expect(fs.promises.access(backup)).rejects.toThrow()
      expect(
        await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID_1))
      ).toHaveLength(1)
      expect(await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_1))).toHaveLength(1)
    })

    it('reconcileSkills rejects managed-library symlinks without touching their targets', async () => {
      vi.mocked(parseSkillMetadata).mockReset()
      const external = await createTempDir('external-skill-')
      await fs.promises.writeFile(path.join(external, 'SKILL.md'), '# external')
      await fs.promises.symlink(external, path.join(dataSkillsRoot, 'linked'), 'dir')
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_1,
        name: 'linked',
        folderName: 'linked',
        source: 'marketplace',
        contentHash: 'a',
        isEnabled: false
      })

      await skillService.reconcileSkills()

      expect(
        await dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID_1))
      ).toHaveLength(0)
      await expect(fs.promises.lstat(path.join(dataSkillsRoot, 'linked'))).rejects.toThrow()
      await expect(fs.promises.readFile(path.join(external, 'SKILL.md'), 'utf-8')).resolves.toBe('# external')
    })

    it('reconcileSkills does not adopt either of two case-colliding library directories', async () => {
      const upper = await writeLibrarySkill('Case-Skill', '# upper')
      const lower = await writeLibrarySkill('case-skill', '# lower')
      if ((await fs.promises.realpath(upper)) === (await fs.promises.realpath(lower))) return

      vi.mocked(parseSkillMetadata).mockResolvedValue(skillMeta('case-skill'))
      await skillService.reconcileSkills()

      expect(
        (await dbh.db.select().from(agentGlobalSkillTable)).filter(
          (row) => row.folderName.toLowerCase() === 'case-skill'
        )
      ).toHaveLength(0)
      await expect(fs.promises.lstat(path.join(mirrorRoot, 'Case-Skill'))).rejects.toThrow()
      await expect(fs.promises.lstat(path.join(mirrorRoot, 'case-skill'))).rejects.toThrow()
    })

    it('reconcileSkills isolates historical case-colliding catalog rows without aborting later repairs', async () => {
      await writeLibrarySkill('Foo', '# existing')
      await dbh.db.insert(agentGlobalSkillTable).values([
        {
          id: SKILL_ID_1,
          name: 'Foo',
          folderName: 'Foo',
          source: 'local',
          contentHash: 'first',
          isEnabled: false
        },
        {
          id: SKILL_ID_2,
          name: 'foo',
          folderName: 'foo',
          source: 'local',
          contentHash: 'second',
          isEnabled: false
        },
        {
          id: SKILL_ID_BUILTIN,
          name: 'gone',
          folderName: 'gone',
          source: 'local',
          contentHash: 'gone',
          isEnabled: false
        }
      ])

      await expect(skillService.reconcileSkills()).resolves.toBeUndefined()

      const rows = await dbh.db.select().from(agentGlobalSkillTable)
      expect(rows.filter((row) => row.folderName.toLowerCase() === 'foo')).toHaveLength(2)
      expect(rows.some((row) => row.folderName === 'gone')).toBe(false)
      await expect(fs.promises.access(path.join(mirrorRoot, 'Foo'))).rejects.toThrow()
      await expect(fs.promises.access(path.join(mirrorRoot, 'foo'))).rejects.toThrow()
    })

    it('copies complete builtin content and quarantines later modifications', async () => {
      vi.mocked(findSkillMdPath).mockImplementation(async (directory) => path.join(directory, 'SKILL.md'))
      const builtinDir = await writeLibrarySkill('skill-creator', '# trusted')
      await Promise.all([
        fs.promises.mkdir(path.join(builtinDir, 'agents')),
        fs.promises.mkdir(path.join(builtinDir, 'scripts'))
      ])
      await Promise.all([
        fs.promises.writeFile(path.join(builtinDir, 'agents', 'reviewer.md'), '# Reviewer'),
        fs.promises.writeFile(path.join(builtinDir, 'scripts', 'run.sh'), '#!/bin/sh')
      ])
      const trustedHash = await skillService['computeBuiltinDirectoryHash'](builtinDir)
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'skill-creator',
        folderName: 'skill-creator',
        source: 'builtin',
        contentHash: trustedHash,
        isEnabled: false
      })
      await skillService.linkMirror('skill-creator')
      expect((await fs.promises.lstat(path.join(mirrorRoot, 'skill-creator'))).isSymbolicLink()).toBe(false)
      await expect(
        fs.promises.readFile(path.join(mirrorRoot, 'skill-creator', 'agents', 'reviewer.md'), 'utf-8')
      ).resolves.toBe('# Reviewer')
      await expect(
        fs.promises.readFile(path.join(mirrorRoot, 'skill-creator', 'scripts', 'run.sh'), 'utf-8')
      ).resolves.toBe('#!/bin/sh')
      await fs.promises.writeFile(path.join(builtinDir, 'SKILL.md'), '# modified by agent')

      await skillService.reconcileSkills()

      const [row] = await dbh.db
        .select()
        .from(agentGlobalSkillTable)
        .where(eq(agentGlobalSkillTable.id, SKILL_ID_BUILTIN))
      expect(row?.contentHash).toBe(trustedHash)
      expect(row?.source).toBe('builtin')
      await expect(fs.promises.access(path.join(mirrorRoot, 'skill-creator'))).rejects.toThrow()
    })

    it('rejects a case-colliding local install instead of overwriting a builtin', async () => {
      // A builtin skill occupies folder "skill-creator" with a user enablement row.
      const builtinBody = '# builtin'
      const builtinHash = createHash('sha256').update(builtinBody).digest('hex')
      await writeLibrarySkill('skill-creator', builtinBody)
      await dbh.db.insert(agentGlobalSkillTable).values({
        id: SKILL_ID_BUILTIN,
        name: 'skill-creator',
        folderName: 'skill-creator',
        source: 'builtin',
        contentHash: builtinHash,
        isEnabled: false
      })
      await seedAgent()
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_BUILTIN, isEnabled: false })
      vi.mocked(parseSkillMetadata).mockResolvedValue(skillMeta('Skill-Creator', { name: 'Evil Creator' }))
      const incoming = await createTempDir('case-colliding-skill-')
      await fs.promises.writeFile(path.join(incoming, 'SKILL.md'), '# evil')

      await expect(skillService.installFromDirectory({ directoryPath: incoming })).rejects.toThrow(
        /refusing to overwrite/
      )

      // Original builtin row, source, content, and enablement all untouched.
      const rows = await dbh.db
        .select()
        .from(agentGlobalSkillTable)
        .where(eq(agentGlobalSkillTable.folderName, 'skill-creator'))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.source).toBe('builtin')
      expect(rows[0]?.contentHash).toBe(builtinHash)
      expect(rows[0]?.name).toBe('skill-creator')
      await expect(fs.promises.readFile(path.join(dataSkillsRoot, 'skill-creator', 'SKILL.md'), 'utf-8')).resolves.toBe(
        '# builtin'
      )
      expect(
        await dbh.db.select().from(agentSkillTable).where(eq(agentSkillTable.skillId, SKILL_ID_BUILTIN))
      ).toHaveLength(1)
    })
  })

  describe('extractZip (zip-slip guard)', () => {
    it('rejects entries that escape the destination dir before extracting', async () => {
      const zipDir = await createTempDir('skill-zipslip-')
      const destDir = await createTempDir('skill-dest-')
      const zip = new AdmZip()
      zip.addFile('SKILL.md', Buffer.from('---\nname: x\n---\n'))
      zip.addFile('../../../evil-slip-marker.sh', Buffer.from('pwn'))
      const zipPath = path.join(zipDir, 'skill.zip')
      zip.writeZip(zipPath)

      // node-stream-zip rejects malicious names itself ('Malicious entry') and the
      // explicit guard is defense-in-depth — either layer rejecting satisfies the contract.
      await expect(skillArchive.extractZip(zipPath, destDir)).rejects.toThrow(/zip-slip|Malicious entry/)

      // Nothing was written — not the safe entry, and no marker escaped beside destDir.
      expect(fs.existsSync(path.join(destDir, 'SKILL.md'))).toBe(false)
      expect(fs.existsSync(path.join(destDir, '..', 'evil-slip-marker.sh'))).toBe(false)
    })

    it('extracts a well-formed skill zip', async () => {
      const zipDir = await createTempDir('skill-zip-ok-')
      const destDir = await createTempDir('skill-dest-')
      const zip = new AdmZip()
      zip.addFile('SKILL.md', Buffer.from('---\nname: x\n---\n'))
      zip.addFile('nested/helper.md', Buffer.from('# helper'))
      const zipPath = path.join(zipDir, 'skill.zip')
      zip.writeZip(zipPath)

      await skillArchive.extractZip(zipPath, destDir)
      await expect(fs.promises.readFile(path.join(destDir, 'SKILL.md'), 'utf-8')).resolves.toContain('name: x')
    })
  })
})
