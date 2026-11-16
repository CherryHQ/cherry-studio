import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import {
  KnowledgeAddItemInputSchema,
  KnowledgeRestoreUrlItemInputSchema,
  UrlItemDataSchema
} from '@shared/data/types/knowledge'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

import { knowledgeHandlers } from '../knowledge'

const knowledgeService = { addItems: vi.fn(), getFilePath: vi.fn(), createBase: vi.fn(), search: vi.fn() }
const analyticsService = { trackProductEvent: vi.fn() }
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  MockApplicationUtils.setService('KnowledgeService', knowledgeService)
  MockApplicationUtils.setService('AnalyticsService', analyticsService)
})
afterEach(() => MockApplicationUtils.resetServices())

describe('knowledgeHandlers', () => {
  it.each(['not a valid URL', 'example.com', 'file:///tmp/source.txt', 'javascript:alert(1)'])(
    'rejects the whole batch before ingestion when a URL is invalid: %s',
    async (url) => {
      await expect(
        knowledgeHandlers['knowledge.add_items'](
          {
            baseId: 'base-1',
            items: [
              { type: 'note', data: { source: 'Note', content: 'Do not partially import this note' } },
              { type: 'url', data: { source: url, url } }
            ]
          },
          ctx
        )
      ).rejects.toMatchObject({ code: 'KNOWLEDGE_INVALID_SOURCE_URL' })
      expect(knowledgeService.addItems).not.toHaveBeenCalled()
    }
  )

  it.each(['https://example.com/article?q=test#section', 'http://localhost:3000/article'])(
    'accepts an HTTP URL without fetching it during validation: %s',
    async (url) => {
      const items = [{ type: 'url' as const, data: { source: url, url } }]
      knowledgeService.addItems.mockResolvedValue({ status: 'added' })
      await expect(
        knowledgeHandlers['knowledge.add_items']({ baseId: 'base-1', items, conflictStrategy: 'detect' }, ctx)
      ).resolves.toEqual({ status: 'added' })
      expect(knowledgeService.addItems).toHaveBeenCalledWith('base-1', items, 'detect')
    }
  )

  it('keeps existing invalid URL records readable and eligible for internal restore', () => {
    const data = { source: 'not a valid URL', url: 'not a valid URL' }
    expect(UrlItemDataSchema.parse(data)).toEqual(data)
    expect(KnowledgeRestoreUrlItemInputSchema.parse({ type: 'url', data })).toEqual({ type: 'url', data })
    expect(KnowledgeAddItemInputSchema.safeParse({ type: 'url', data }).success).toBe(false)
  })

  it('get_file_path maps data-layer failures to a stable domain error without leaking the item id', async () => {
    knowledgeService.getFilePath.mockImplementationOnce(() => {
      throw DataApiErrorFactory.notFound('KnowledgeItem', 'private-item-id')
    })

    const error = await knowledgeHandlers['knowledge.get_file_path']({ itemId: 'private-item-id' }, ctx).catch(
      (cause) => cause
    )

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toMatchObject({
      code: knowledgeErrorCodes.SOURCE_PATH_UNAVAILABLE,
      data: { cause: ErrorCode.NOT_FOUND },
      message: 'Knowledge source path is unavailable'
    })
    expect(error.message).not.toContain('private-item-id')
  })

  it('get_file_path maps unavailable snapshot state to the same stable domain error', async () => {
    knowledgeService.getFilePath.mockImplementationOnce(() => {
      throw DataApiErrorFactory.invalidOperation(
        'getFilePath',
        "Knowledge URL item 'private-item-id' has no captured snapshot to preview"
      )
    })

    const error = await knowledgeHandlers['knowledge.get_file_path']({ itemId: 'private-item-id' }, ctx).catch(
      (cause) => cause
    )

    expect(error).toMatchObject({
      code: knowledgeErrorCodes.SOURCE_PATH_UNAVAILABLE,
      data: { cause: ErrorCode.INVALID_OPERATION },
      message: 'Knowledge source path is unavailable'
    })
    expect(error.message).not.toContain('private-item-id')
  })

  it('get_file_path does not relabel unexpected data-layer failures as an unavailable source', async () => {
    const databaseError = DataApiErrorFactory.database(new Error('disk I/O failed'), 'get knowledge item')
    knowledgeService.getFilePath.mockImplementationOnce(() => {
      throw databaseError
    })

    const error = await knowledgeHandlers['knowledge.get_file_path']({ itemId: 'i1' }, ctx).catch((cause) => cause)

    expect(error).toBe(databaseError)
  })

  describe('usage analytics', () => {
    const reported = () => analyticsService.trackProductEvent.mock.calls.map(([event]) => event)
    const note = { type: 'note' as const, data: { source: 'Secret title', content: 'Secret body' } }

    it('reports a created base without its name', async () => {
      knowledgeService.createBase.mockResolvedValue({ id: 'base-1' })
      await knowledgeHandlers['knowledge.create_base']({ base: { name: 'Private base' } }, ctx)
      expect(reported()).toEqual([{ event: 'feature_used', feature: 'knowledge', action: 'base_created' }])
    })

    it('counts added items only when the add commits, not when it stops at conflicts', async () => {
      knowledgeService.addItems.mockResolvedValueOnce({ status: 'conflicts', conflicts: [] })
      knowledgeService.addItems.mockResolvedValueOnce({ status: 'added' })
      await knowledgeHandlers['knowledge.add_items'](
        { baseId: 'base-1', items: [note, note], conflictStrategy: 'detect' },
        ctx
      )
      await knowledgeHandlers['knowledge.add_items'](
        { baseId: 'base-1', items: [note, note], conflictStrategy: 'rename' },
        ctx
      )
      expect(reported()).toEqual([{ event: 'feature_used', feature: 'knowledge', action: 'items_added', count: 2 }])
    })

    it('reports each search outcome without the query and still surfaces the failure', async () => {
      knowledgeService.search.mockResolvedValueOnce([])
      knowledgeService.search.mockRejectedValueOnce(new Error('embedding failed'))
      await knowledgeHandlers['knowledge.search']({ baseId: 'base-1', query: 'secret query' }, ctx)
      await expect(
        knowledgeHandlers['knowledge.search']({ baseId: 'base-1', query: 'secret query' }, ctx)
      ).rejects.toThrow('embedding failed')
      expect(reported()).toEqual([
        { event: 'feature_used', feature: 'knowledge', action: 'searched', status: 'success' },
        { event: 'feature_used', feature: 'knowledge', action: 'searched', status: 'error' }
      ])
    })
  })
})
