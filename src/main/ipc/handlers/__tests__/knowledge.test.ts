import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import { KnowledgeAddItemInputSchema, UrlItemDataSchema } from '@shared/data/types/knowledge'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'

import { knowledgeHandlers } from '../knowledge'

const knowledgeService = { addItems: vi.fn(), getFilePath: vi.fn() }
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  MockApplicationUtils.setService('KnowledgeService', knowledgeService)
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
    expect(KnowledgeAddItemInputSchema.parse({ type: 'url', data })).toEqual({ type: 'url', data })
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
})
