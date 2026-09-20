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
  resolveFeishuScope: vi.fn(),
  previewFeishuScope: vi.fn(),
  createExternalKnowledgeSource: vi.fn(),
  requestExternalKnowledgeSourceSync: vi.fn(),
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
  const externalSource = {
    id: '01960000-0000-7000-8000-000000000010',
    baseId: '11111111-1111-4111-8111-111111111111',
    connectionId: '01960000-0000-7000-8000-000000000001',
    provider: 'feishu' as const,
    tenantId: 'tenant-1',
    spaceId: 'space-1',
    scope: { kind: 'space' as const },
    name: 'Engineering Wiki',
    state: 'active' as const,
    scheduleId: null,
    revision: 0,
    activeJobId: '01960000-0000-7000-8000-000000000011',
    lastTrigger: 'initial' as const,
    lastStartedAt: '2026-09-20T00:00:00.000Z',
    lastFinishedAt: null,
    lastOutcome: null,
    lastScannedCount: null,
    lastIndexedCount: null,
    lastUnchangedCount: null,
    lastSkippedCount: null,
    lastWarningCount: null,
    lastErrorSummary: null,
    lastSuccessfulSyncAt: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z'
  }

  it('strictly parses source creation and manual sync commands and returns safe source DTOs', async () => {
    knowledgeService.createExternalKnowledgeSource.mockResolvedValue(externalSource)
    knowledgeService.requestExternalKnowledgeSourceSync.mockResolvedValue({
      ...externalSource,
      lastTrigger: 'manual'
    })
    const router = new IpcRouter(knowledgeRequestSchemas, knowledgeHandlers)
    const createInput = {
      baseId: externalSource.baseId,
      connectionId: externalSource.connectionId,
      url: 'https://acme.feishu.cn/wiki/root',
      name: 'Engineering Wiki'
    }

    await expect(router.dispatch('knowledge.external_source.create', createInput, ctx)).resolves.toEqual(externalSource)
    await expect(
      router.dispatch('knowledge.external_source.sync', { sourceId: externalSource.id }, ctx)
    ).resolves.toMatchObject({ id: externalSource.id, lastTrigger: 'manual' })
    expect(knowledgeService.createExternalKnowledgeSource).toHaveBeenCalledWith(createInput)
    expect(knowledgeService.requestExternalKnowledgeSourceSync).toHaveBeenCalledWith({ sourceId: externalSource.id })
  })

  it('rejects renderer credentials, preview data, and provider payloads from source commands', async () => {
    const router = new IpcRouter(knowledgeRequestSchemas, knowledgeHandlers)
    const createInput = {
      baseId: externalSource.baseId,
      connectionId: externalSource.connectionId,
      url: 'https://acme.feishu.cn/wiki/root',
      name: 'Engineering Wiki'
    }

    await expect(
      router.dispatch(
        'knowledge.external_source.create',
        { ...createInput, credentials: { accessToken: 'secret' }, providerData: { token: 'secret' }, preview: {} },
        ctx
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(
      router.dispatch(
        'knowledge.external_source.sync',
        { sourceId: externalSource.id, accessToken: 'secret', providerData: {} },
        ctx
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(knowledgeService.createExternalKnowledgeSource).not.toHaveBeenCalled()
    expect(knowledgeService.requestExternalKnowledgeSourceSync).not.toHaveBeenCalled()
  })

  it('maps create-time provider failures but preserves data admission conflicts', async () => {
    knowledgeService.createExternalKnowledgeSource.mockRejectedValueOnce(
      new ExternalKnowledgeRuntimeError('resource-permission-denied')
    )

    await expect(
      knowledgeHandlers['knowledge.external_source.create'](
        {
          baseId: externalSource.baseId,
          connectionId: externalSource.connectionId,
          url: 'https://acme.feishu.cn/wiki/root',
          name: 'Engineering Wiki'
        },
        ctx
      )
    ).rejects.toMatchObject({ code: knowledgeErrorCodes.FEISHU_RESOURCE_PERMISSION_DENIED })

    const conflict = DataApiErrorFactory.conflict('Source already exists', 'ExternalKnowledgeSource')
    knowledgeService.createExternalKnowledgeSource.mockRejectedValueOnce(conflict)
    const error = await knowledgeHandlers['knowledge.external_source.create'](
      {
        baseId: externalSource.baseId,
        connectionId: externalSource.connectionId,
        url: 'https://acme.feishu.cn/wiki/root',
        name: 'Engineering Wiki'
      },
      ctx
    ).catch((cause) => cause)
    expect(error).toBe(conflict)
  })
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

  it('returns validated scope metadata without exposing connection credentials or provider payloads', async () => {
    const connectionId = '01960000-0000-7000-8000-000000000001'
    const input = { connectionId, url: 'https://acme.feishu.cn/wiki/root' }
    const resolution = {
      provider: 'feishu',
      connectionId,
      account: { userId: 'user-1', displayName: 'Ada' },
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      scope: { kind: 'space' },
      selected: {
        remoteObjectId: 'doc-1',
        nodeId: 'root',
        parentNodeId: null,
        relativeBreadcrumb: ['Root'],
        title: 'Root',
        originalUrl: 'https://acme.feishu.cn/wiki/root',
        remoteRevision: '42',
        documentKind: 'document',
        supportState: 'supported'
      }
    }
    knowledgeService.resolveFeishuScope.mockResolvedValue(resolution)
    knowledgeService.previewFeishuScope.mockResolvedValue({
      resolution,
      visibleNodeCount: 1,
      supportedDocxCount: 1,
      unsupportedOrSkippedCount: 0,
      embeddingCostExact: false,
      warnings: []
    })
    const router = new IpcRouter(knowledgeRequestSchemas, knowledgeHandlers)

    const resolved = await router.dispatch('knowledge.feishu.scope.resolve', input, ctx)
    const preview = await router.dispatch('knowledge.feishu.scope.preview', input, ctx)

    expect(resolved).toEqual(resolution)
    expect(preview).toMatchObject({ visibleNodeCount: 1, embeddingCostExact: false })
    for (const privateValue of [
      'access-token',
      'refresh-token',
      'app-secret',
      'credentialReference',
      'providerPayload'
    ]) {
      expect(JSON.stringify([resolved, preview])).not.toContain(privateValue)
    }
  })

  it('rejects renderer-supplied provider origins and credentials before scope resolution', async () => {
    const router = new IpcRouter(knowledgeRequestSchemas, knowledgeHandlers)
    const input = {
      connectionId: '01960000-0000-7000-8000-000000000001',
      url: 'https://acme.feishu.cn/wiki/root'
    }

    await expect(
      router.dispatch(
        'knowledge.feishu.scope.resolve',
        { ...input, apiOrigin: 'https://attacker.invalid', accessToken: 'secret' },
        ctx
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(knowledgeService.resolveFeishuScope).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid-scope-url', 'KNOWLEDGE_FEISHU_INVALID_SCOPE_URL'],
    ['resource-permission-denied', 'KNOWLEDGE_FEISHU_RESOURCE_PERMISSION_DENIED'],
    ['scope-not-found', 'KNOWLEDGE_FEISHU_SCOPE_NOT_FOUND'],
    ['unsupported-resource', 'KNOWLEDGE_FEISHU_UNSUPPORTED_RESOURCE'],
    ['transient', 'KNOWLEDGE_FEISHU_PROVIDER_UNAVAILABLE'],
    ['invalid-provider-response', 'KNOWLEDGE_FEISHU_INVALID_PROVIDER_RESPONSE']
  ] as const)('maps scope read failure %s to a stable renderer error', async (runtimeCode, ipcCode) => {
    knowledgeService.previewFeishuScope.mockRejectedValue(new ExternalKnowledgeRuntimeError(runtimeCode))

    const error = await knowledgeHandlers['knowledge.feishu.scope.preview'](
      {
        connectionId: '01960000-0000-7000-8000-000000000001',
        url: 'https://acme.feishu.cn/wiki/root'
      },
      ctx
    ).catch((cause) => cause)

    expect(error).toMatchObject({ code: ipcCode })
    expect(JSON.stringify(error)).not.toContain('provider-payload')
  })

  it('maps referenced connection removal to a stable IPC error', async () => {
    knowledgeService.removeExternalKnowledgeConnection.mockRejectedValue(
      new ExternalKnowledgeRuntimeError('connection-in-use')
    )

    const error = await knowledgeHandlers['knowledge.feishu.connection.remove'](
      { connectionId: '01960000-0000-7000-8000-000000000001' },
      ctx
    ).catch((cause) => cause)

    expect(error).toMatchObject({
      code: knowledgeErrorCodes.EXTERNAL_CONNECTION_IN_USE,
      message: 'External Knowledge connection is in use'
    })
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
