import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExternalKnowledgeRuntimeError } from '@main/features/knowledge/external/ExternalKnowledgeRuntime'
import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { knowledgeErrorCodes } from '@shared/ipc/errors/knowledge'
import { knowledgeRequestSchemas } from '@shared/ipc/schemas/knowledge'

import { IpcRouter } from '../../IpcRouter'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))
vi.mock('@application', () => ({ application: { get: appGetMock } }))

import { knowledgeHandlers } from '../knowledge'

const knowledgeService = {
  beginFeishuAppRegistration: vi.fn(),
  cancelFeishuAppRegistration: vi.fn(),
  beginFeishuUserAuthorization: vi.fn(),
  completeFeishuUserAuthorization: vi.fn(),
  cancelFeishuUserAuthorization: vi.fn(),
  reconnectFeishuConnection: vi.fn(),
  validateFeishuConnection: vi.fn(),
  removeExternalKnowledgeConnection: vi.fn(),
  createBase: vi.fn(),
  restoreBase: vi.fn(),
  deleteBase: vi.fn(),
  addItems: vi.fn(),
  deleteItems: vi.fn(),
  reindexItems: vi.fn(),
  enableEmbeddingModel: vi.fn(),
  search: vi.fn(),
  getFilePath: vi.fn(),
  listItemChunks: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'KnowledgeService') return knowledgeService
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// Knowledge handlers ignore IpcContext (they act on shared business data, not the
// caller's window), so the senderId value is irrelevant — pass a stable stub.
const ctx = { senderId: 'w1' }

type In<R extends keyof typeof knowledgeHandlers> = Parameters<(typeof knowledgeHandlers)[R]>[0]

describe('knowledgeHandlers', () => {
  it('routes both Feishu application credential entries through the same user authorization command', async () => {
    const started = { authorizationSessionId: 'session-1' }
    knowledgeService.beginFeishuUserAuthorization.mockResolvedValue(started)
    const manual = { kind: 'custom-app' as const, appId: 'cli_manual', appSecret: 'private-secret' }

    const result = await knowledgeHandlers['knowledge.feishu.authorization.begin'](manual, ctx)

    expect(knowledgeService.beginFeishuUserAuthorization).toHaveBeenCalledWith(manual)
    expect(result).toBe(started)
    expect(JSON.stringify(result)).not.toContain('private-secret')
  })

  it('forwards replacement application credentials only into the reconnect command', async () => {
    const started = { authorizationSessionId: 'session-1' }
    knowledgeService.reconnectFeishuConnection.mockResolvedValue(started)
    const input = {
      connectionId: '01960000-0000-7000-8000-000000000001',
      credentials: { kind: 'custom-app' as const, appId: 'cli_manual', appSecret: 'replacement-secret' }
    }

    const result = await knowledgeHandlers['knowledge.feishu.connection.reconnect'](input, ctx)

    expect(knowledgeService.reconnectFeishuConnection).toHaveBeenCalledWith(input.connectionId, input.credentials)
    expect(result).toBe(started)
    expect(JSON.stringify(result)).not.toContain('replacement-secret')
  })

  it('rejects invalid Feishu command parameters before invoking KnowledgeService', async () => {
    const router = new IpcRouter(knowledgeRequestSchemas, knowledgeHandlers)

    await expect(
      router.dispatch(
        'knowledge.feishu.authorization.begin',
        { kind: 'custom-app', appId: 'cli_manual', appSecret: 'secret', refreshToken: 'not-allowed' },
        ctx
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(knowledgeService.beginFeishuUserAuthorization).not.toHaveBeenCalled()
  })

  it('maps External Knowledge failures to stable errors without leaking credentials', async () => {
    const secret = 'private-secret-value'
    knowledgeService.beginFeishuUserAuthorization.mockRejectedValue(new Error(`provider rejected ${secret}`))

    const error = await knowledgeHandlers['knowledge.feishu.authorization.begin'](
      { kind: 'custom-app', appId: 'cli_manual', appSecret: secret },
      ctx
    ).catch((cause) => cause)

    expect(error).toMatchObject({
      code: knowledgeErrorCodes.FEISHU_AUTHORIZATION_FAILED,
      message: 'Feishu authorization failed'
    })
    expect(JSON.stringify(error)).not.toContain(secret)
  })

  it.each([
    {
      runtimeCode: 'scope-missing' as const,
      ipcCode: 'KNOWLEDGE_FEISHU_SCOPE_MISSING',
      message: 'Required Feishu permissions were not granted'
    },
    {
      runtimeCode: 'automatic-scope-mismatch' as const,
      ipcCode: 'KNOWLEDGE_FEISHU_AUTOMATIC_SCOPE_MISMATCH',
      message: 'The automatically registered Feishu application granted unexpected permissions'
    },
    {
      runtimeCode: 'identity-conflict' as const,
      ipcCode: 'KNOWLEDGE_FEISHU_IDENTITY_CONFLICT',
      message: 'The Feishu account does not match this connection'
    },
    {
      runtimeCode: 'identity-unverifiable' as const,
      ipcCode: 'KNOWLEDGE_FEISHU_IDENTITY_UNVERIFIABLE',
      message: 'The Feishu account identity could not be verified'
    },
    {
      runtimeCode: 'reauthorization-required' as const,
      ipcCode: 'KNOWLEDGE_EXTERNAL_REAUTHORIZATION_REQUIRED',
      message: 'The Feishu connection requires authorization'
    }
  ])('maps $runtimeCode to its distinct fixed IPC error', async ({ runtimeCode, ipcCode, message }) => {
    knowledgeService.validateFeishuConnection.mockRejectedValue(new ExternalKnowledgeRuntimeError(runtimeCode))

    const error = await knowledgeHandlers['knowledge.feishu.connection.validate'](
      { connectionId: '01960000-0000-7000-8000-000000000001' },
      ctx
    ).catch((cause) => cause)

    expect(error).toMatchObject({ code: ipcCode, message })
    for (const privateValue of ['provider-payload', 'cli_private', 'user_private', 'feishu:credential-private']) {
      expect(JSON.stringify(error)).not.toContain(privateValue)
    }
  })

  it('delegates registration cancellation and connection removal as void commands', async () => {
    knowledgeService.cancelFeishuAppRegistration.mockResolvedValue(undefined)
    knowledgeService.removeExternalKnowledgeConnection.mockResolvedValue(undefined)

    await knowledgeHandlers['knowledge.feishu.registration.cancel'](
      { registrationSessionId: '01960000-0000-7000-8000-000000000002' },
      ctx
    )
    await knowledgeHandlers['knowledge.feishu.connection.remove'](
      { connectionId: '01960000-0000-7000-8000-000000000001' },
      ctx
    )

    expect(knowledgeService.cancelFeishuAppRegistration).toHaveBeenCalledWith('01960000-0000-7000-8000-000000000002')
    expect(knowledgeService.removeExternalKnowledgeConnection).toHaveBeenCalledWith(
      '01960000-0000-7000-8000-000000000001'
    )
  })

  it('create_base unwraps { base } and returns KnowledgeService.createBase result', async () => {
    const base = { name: 'KB', dimensions: 1536, embeddingModelId: 'm' }
    const created = { id: 'base-1' }
    knowledgeService.createBase.mockResolvedValue(created)

    const result = await knowledgeHandlers['knowledge.create_base']({ base }, ctx)

    expect(knowledgeService.createBase).toHaveBeenCalledWith(base)
    expect(result).toBe(created)
  })

  it('restore_base forwards the dto and returns the restored base', async () => {
    const dto = {
      sourceBaseId: 'src',
      name: 'KB',
      dimensions: 1536,
      embeddingModelId: 'm'
    } as In<'knowledge.restore_base'>
    const restored = { base: { id: 'restored' }, skippedMissingSourceCount: 0 }
    knowledgeService.restoreBase.mockResolvedValue(restored)

    const result = await knowledgeHandlers['knowledge.restore_base'](dto, ctx)

    expect(knowledgeService.restoreBase).toHaveBeenCalledWith(dto)
    expect(result).toBe(restored)
  })

  it('delete_base forwards baseId and resolves void', async () => {
    knowledgeService.deleteBase.mockResolvedValue(undefined)

    const result = await knowledgeHandlers['knowledge.delete_base']({ baseId: 'base-1' }, ctx)

    expect(knowledgeService.deleteBase).toHaveBeenCalledWith('base-1')
    expect(result).toBeUndefined()
  })

  it('add_items forwards baseId, items, and conflictStrategy and returns the result', async () => {
    const items = [{ type: 'note' as const, data: { source: 'manual', content: 'hello' } }]
    const addResult = { status: 'conflicts' as const, conflicts: [{ type: 'note' as const, title: 'hello' }] }
    knowledgeService.addItems.mockResolvedValue(addResult)

    const result = await knowledgeHandlers['knowledge.add_items'](
      { baseId: 'base-1', items, conflictStrategy: 'detect' },
      ctx
    )

    expect(knowledgeService.addItems).toHaveBeenCalledWith('base-1', items, 'detect')
    expect(result).toBe(addResult)
  })

  it('delete_items forwards baseId and itemIds', async () => {
    await knowledgeHandlers['knowledge.delete_items']({ baseId: 'base-1', itemIds: ['i1', 'i2'] }, ctx)

    expect(knowledgeService.deleteItems).toHaveBeenCalledWith('base-1', ['i1', 'i2'])
  })

  it('reindex_items forwards baseId and itemIds', async () => {
    await knowledgeHandlers['knowledge.reindex_items']({ baseId: 'base-1', itemIds: ['i1'] }, ctx)

    expect(knowledgeService.reindexItems).toHaveBeenCalledWith('base-1', ['i1'])
  })

  it('enable_embedding_model forwards baseId and patch and returns the updated base', async () => {
    const patch = { embeddingModelId: 'provider::embed', dimensions: 768 }
    const updated = { id: 'base-1', embeddingModelId: 'provider::embed' }
    knowledgeService.enableEmbeddingModel.mockResolvedValue(updated)

    const result = await knowledgeHandlers['knowledge.enable_embedding_model']({ baseId: 'base-1', patch }, ctx)

    expect(knowledgeService.enableEmbeddingModel).toHaveBeenCalledWith('base-1', patch)
    expect(result).toBe(updated)
  })

  it('search forwards baseId and query and returns the matches', async () => {
    const matches = [{ chunkId: 'c1' }]
    knowledgeService.search.mockResolvedValue(matches)

    const result = await knowledgeHandlers['knowledge.search']({ baseId: 'base-1', query: 'hello' }, ctx)

    expect(knowledgeService.search).toHaveBeenCalledWith('base-1', 'hello')
    expect(result).toBe(matches)
  })

  it('get_file_path forwards itemId and returns the managed file path', async () => {
    knowledgeService.getFilePath.mockReturnValue('/knowledge/base-1/raw/report.pdf')

    const result = await knowledgeHandlers['knowledge.get_file_path']({ itemId: 'i1' }, ctx)

    expect(knowledgeService.getFilePath).toHaveBeenCalledWith('i1')
    expect(result).toBe('/knowledge/base-1/raw/report.pdf')
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

  it('list_item_chunks forwards baseId and itemId and returns the chunks', async () => {
    const chunks = [{ id: 'chunk-1' }]
    knowledgeService.listItemChunks.mockResolvedValue(chunks)

    const result = await knowledgeHandlers['knowledge.list_item_chunks']({ baseId: 'base-1', itemId: 'i1' }, ctx)

    expect(knowledgeService.listItemChunks).toHaveBeenCalledWith('base-1', 'i1')
    expect(result).toBe(chunks)
  })
})
