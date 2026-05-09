import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { parseSkillMetadata } from '@main/utils/markdownParser'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  async function seedAgent() {
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Test Agent',
      instructions: 'You are a helpful assistant.',
      model: 'claude-3-5-sonnet',
      sortOrder: 0
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

  describe('toggle', () => {
    let skillService: SkillService

    beforeEach(() => {
      skillService = new SkillService()
      vi.spyOn(skillService, 'linkSkill').mockResolvedValue(undefined)
      vi.spyOn(skillService, 'unlinkSkill').mockResolvedValue(undefined)
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

    it('rolls back DB and throws AggregateError when symlink + rollback both fail', async () => {
      await seedAgent()
      await seedSkills()
      // Patch getAgentWorkspace to return a fake workspace so linkSkill is attempted
      vi.spyOn(skillService as never, 'getAgentWorkspace').mockResolvedValue('/fake/workspace')
      vi.spyOn(skillService, 'linkSkill').mockRejectedValue(new Error('symlink failed'))
      // First call (enable) succeeds; second call (rollback) fails → AggregateError
      vi.spyOn(skillService as never, 'upsertAgentSkill')
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('rollback failed'))

      await expect(
        skillService.toggle({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })
      ).rejects.toBeInstanceOf(AggregateError)
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

    it('removes symlinks for enabled agents before deleting', async () => {
      const skillService = new SkillService()
      await seedAgent()
      await seedSkills()
      await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID_1, isEnabled: true })
      vi.spyOn(skillService['installer'], 'uninstall').mockResolvedValue(undefined)
      vi.spyOn(skillService as never, 'getAgentWorkspace').mockResolvedValue('/fake/workspace')
      const unlinkSpy = vi.spyOn(skillService, 'unlinkSkill').mockResolvedValue(undefined)

      await skillService.uninstall(SKILL_ID_1)

      expect(unlinkSpy).toHaveBeenCalledWith('skill-one', '/fake/workspace')
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
})
