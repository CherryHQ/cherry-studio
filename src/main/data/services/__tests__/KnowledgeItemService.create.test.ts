import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/db/DbService', () => ({
  dbService: {
    getDb: vi.fn()
  }
}))

vi.mock('../KnowledgeBaseService', () => ({
  knowledgeBaseService: {
    getById: vi.fn()
  }
}))

import { dbService } from '@data/db/DbService'

import { knowledgeBaseService } from '../KnowledgeBaseService'
import { KnowledgeItemService } from '../KnowledgeItemService'

const fileMetadata = {
  id: 'file-1',
  name: 'report.pdf',
  origin_name: 'report.pdf',
  path: '/tmp/report.pdf',
  size: 128,
  ext: '.pdf',
  type: 'document' as const,
  created_at: '2025-01-01T00:00:00.000Z',
  count: 1
}

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  baseId: 'kb-1',
  parentId: null,
  type: 'note' as const,
  data: {
    content: 'hello'
  },
  status: 'idle' as const,
  error: null,
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
  ...overrides
})

describe('KnowledgeItemService.create', () => {
  const getDbMock = vi.mocked(dbService.getDb)
  const getKnowledgeBaseByIdMock = vi.mocked(knowledgeBaseService.getById)
  const service = KnowledgeItemService.getInstance()

  beforeEach(() => {
    vi.clearAllMocks()
    getKnowledgeBaseByIdMock.mockResolvedValue({ id: 'kb-1' } as never)
  })

  it('creates root-level items and persists parentId as null', async () => {
    const returningMock = vi.fn().mockResolvedValue([buildRow()])
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock })
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock })

    getDbMock.mockReturnValue({
      insert: insertMock
    } as never)

    const result = await service.create('kb-1', {
      items: [
        {
          type: 'note',
          data: { content: 'hello' }
        }
      ]
    })

    expect(valuesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        baseId: 'kb-1',
        parentId: null,
        type: 'note',
        data: { content: 'hello' },
        status: 'idle',
        error: null
      })
    ])
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'item-1',
        baseId: 'kb-1',
        parentId: null,
        type: 'note',
        data: { content: 'hello' }
      })
    ])
  })

  it('creates internal directory entry children under the directory parent', async () => {
    const limitMock = vi.fn().mockResolvedValue([
      buildRow({
        id: 'dir-1',
        type: 'directory',
        data: {
          kind: 'container',
          path: '/tmp/docs',
          recursive: true
        }
      })
    ])
    const whereSelectMock = vi.fn().mockReturnValue({ limit: limitMock })
    const fromMock = vi.fn().mockReturnValue({ where: whereSelectMock })
    const selectMock = vi.fn().mockReturnValue({ from: fromMock })

    const returningMock = vi.fn().mockResolvedValue([
      buildRow({
        id: 'entry-1',
        parentId: 'dir-1',
        type: 'directory',
        data: {
          kind: 'entry',
          groupId: 'group-1',
          groupName: 'Docs',
          file: fileMetadata
        }
      })
    ])
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock })
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock })

    getDbMock.mockReturnValue({
      select: selectMock,
      insert: insertMock
    } as never)

    const result = await service.createDirectoryEntries('dir-1', [
      {
        groupId: 'group-1',
        groupName: 'Docs',
        file: fileMetadata
      }
    ])

    expect(valuesMock).toHaveBeenCalledWith([
      expect.objectContaining({
        baseId: 'kb-1',
        parentId: 'dir-1',
        type: 'directory',
        data: {
          kind: 'entry',
          groupId: 'group-1',
          groupName: 'Docs',
          file: fileMetadata
        },
        status: 'idle',
        error: null
      })
    ])
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'entry-1',
        baseId: 'kb-1',
        parentId: 'dir-1',
        type: 'directory',
        data: {
          kind: 'entry',
          groupId: 'group-1',
          groupName: 'Docs',
          file: fileMetadata
        }
      })
    ])
  })
})
