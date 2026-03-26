import type { CreateSkillDto, UpdateSkillDto } from '@shared/data/api/schemas/skills'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete
}

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    DbService: { getDb: () => mockDb }
  })
})

const { skillService } = await import('../SkillService')

const NOW = Date.now()

function createMockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-001',
    name: 'Test Skill',
    slug: 'test-skill',
    description: 'A test skill',
    author: 'tester',
    version: '1.0.0',
    tags: ['test'],
    tools: ['Read', 'Write'],
    source: 'local',
    sourcePath: '/path/to/skill',
    packageName: null,
    packageVersion: null,
    marketplaceId: null,
    contentHash: 'abc123',
    size: 1024,
    isEnabled: true,
    versionDirPath: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function mockSelectChain(rows: unknown[]) {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows)
      })
    })
  })
}

function mockSelectListChain(rows: unknown[]) {
  mockSelect.mockReturnValue({
    from: vi.fn().mockResolvedValue(rows)
  })
}

function mockInsertChain(rows: unknown[]) {
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows)
    })
  })
}

function mockUpdateChain(rows: unknown[]) {
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows)
      })
    })
  })
}

describe('SkillService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('list', () => {
    it('should return all skills', async () => {
      const rows = [createMockRow(), createMockRow({ id: 'skill-002', slug: 'other-skill' })]
      mockSelectListChain(rows)

      const result = await skillService.list()
      expect(result).toHaveLength(2)
      expect(result[0].slug).toBe('test-skill')
      expect(result[1].slug).toBe('other-skill')
    })

    it('should return empty array when no skills', async () => {
      mockSelectListChain([])

      const result = await skillService.list()
      expect(result).toHaveLength(0)
    })
  })

  describe('getById', () => {
    it('should return a skill by ID', async () => {
      mockSelectChain([createMockRow()])

      const result = await skillService.getById('skill-001')
      expect(result.id).toBe('skill-001')
      expect(result.name).toBe('Test Skill')
      expect(result.source).toBe('local')
    })

    it('should throw NotFound for non-existent ID', async () => {
      mockSelectChain([])

      await expect(skillService.getById('nonexistent')).rejects.toThrow()
    })
  })

  describe('create', () => {
    it('should register a new skill', async () => {
      const row = createMockRow()
      mockInsertChain([row])

      const dto: CreateSkillDto = {
        name: 'Test Skill',
        slug: 'test-skill',
        source: 'local',
        sourcePath: '/path/to/skill',
        version: '1.0.0',
        tags: ['test'],
        tools: ['Read', 'Write']
      }

      const result = await skillService.create(dto)
      expect(result.slug).toBe('test-skill')
      expect(result.source).toBe('local')
    })
  })

  describe('update', () => {
    it('should update skill fields', async () => {
      const row = createMockRow()
      mockSelectChain([row])
      mockUpdateChain([{ ...row, name: 'Updated Skill' }])

      const dto: UpdateSkillDto = { name: 'Updated Skill' }
      const result = await skillService.update('skill-001', dto)
      expect(result.name).toBe('Updated Skill')
    })

    it('should throw NotFound for non-existent ID', async () => {
      mockSelectChain([])

      await expect(skillService.update('nonexistent', { name: 'x' })).rejects.toThrow()
    })
  })

  describe('delete', () => {
    it('should unregister a skill', async () => {
      mockSelectChain([createMockRow()])
      mockDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })

      await expect(skillService.delete('skill-001')).resolves.toBeUndefined()
    })

    it('should throw NotFound for non-existent ID', async () => {
      mockSelectChain([])

      await expect(skillService.delete('nonexistent')).rejects.toThrow()
    })
  })

  describe('enable/disable', () => {
    it('should enable a skill', async () => {
      const row = createMockRow({ isEnabled: false })
      mockSelectChain([row])
      mockUpdateChain([{ ...row, isEnabled: true }])

      const result = await skillService.enable('skill-001')
      expect(result.isEnabled).toBe(true)
    })

    it('should disable a skill', async () => {
      const row = createMockRow({ isEnabled: true })
      mockSelectChain([row])
      mockUpdateChain([{ ...row, isEnabled: false }])

      const result = await skillService.disable('skill-001')
      expect(result.isEnabled).toBe(false)
    })
  })

  describe('listVersions', () => {
    it('should return version history for a skill', async () => {
      const skillRow = createMockRow()
      mockSelectChain([skillRow])

      const versionRows = [
        {
          id: 'ver-001',
          skillId: 'skill-001',
          version: '1.0.0',
          contentHash: 'hash1',
          diffPath: '/path/to/diff.patch',
          message: 'initial',
          createdAt: NOW,
          updatedAt: NOW
        }
      ]

      // Second select call for versions
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([skillRow])
          })
        })
      })
      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(versionRows)
          })
        })
      })

      const result = await skillService.listVersions('skill-001')
      expect(result).toHaveLength(1)
      expect(result[0].version).toBe('1.0.0')
      expect(result[0].diffPath).toBe('/path/to/diff.patch')
    })
  })
})
