import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      model: 'claude-3-5-sonnet',
      sortOrder: 0
    })
  }

  async function seedSkills() {
    await dbh.db.insert(agentGlobalSkillTable).values([
      {
        id: SKILL_ID_1,
        name: 'skill-one',
        folderName: 'skill-one',
        source: 'marketplace',
        contentHash: 'abc123',
        isEnabled: true
      },
      {
        id: SKILL_ID_2,
        name: 'skill-two',
        folderName: 'skill-two',
        source: 'marketplace',
        contentHash: 'def456',
        isEnabled: true
      },
      {
        id: SKILL_ID_BUILTIN,
        name: 'builtin-skill',
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

      const result = await skillService.list(AGENT_ID)

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

      const result = await skillService.list(AGENT_ID)

      expect(result.every((s) => s.isEnabled === false)).toBe(true)
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
})
