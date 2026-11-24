import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userModelTable } from '@main/data/db/schemas/userModel'
import { userProviderTable } from '@main/data/db/schemas/userProvider'
import { modelService } from '@main/data/services/ModelService'
import { createUniqueModelId, type ListedModels } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'

import { listModels } from '../../ai/provider/listModels'
import { BaseService } from '../../core/lifecycle'
import { CherryInModelSyncService } from '../CherryInModelSyncService'

vi.mock('@main/ai/provider/listModels', () => ({ listModels: vi.fn() }))

const SIX_HOURS = 6 * 60 * 60 * 1000

describe('CherryInModelSyncService', () => {
  const dbh = setupTestDatabase()
  let service: CherryInModelSyncService

  function seedProvider(providerId = 'cherryin', isEnabled = true, hasKey = true) {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId,
        name: providerId,
        isEnabled,
        orderKey: 'a0',
        apiKeys: hasKey ? [{ id: 'key-id', key: 'test-key', isEnabled: true }] : []
      })
      .run()
  }

  function seedModel(modelId = 'test-model', providerId = 'cherryin') {
    dbh.db
      .insert(userModelTable)
      .values({
        id: createUniqueModelId(providerId, modelId),
        providerId,
        modelId,
        name: 'My model name',
        capabilities: [],
        supportsStreaming: true,
        endpointTypes: ['openai-chat-completions'],
        orderKey: 'a0'
      })
      .run()
  }

  function storedModel(modelId = 'test-model') {
    return dbh.db.select().from(userModelTable).where(eq(userModelTable.modelId, modelId)).get()!
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-14T00:00:00Z'))
    BaseService.resetInstances()
    MockMainCacheServiceUtils.resetMocks()
    vi.mocked(listModels).mockReset()
    vi.mocked(listModels).mockResolvedValue({
      models: [{ apiModelId: 'test-model', endpointTypes: ['openai-responses'] }]
    })
    service = new CherryInModelSyncService()
  })

  afterEach(async () => {
    await service._doStop()
    vi.useRealTimers()
  })

  it('refreshes only existing model endpoints, preserving model identity and settings', async () => {
    seedProvider()
    seedModel()
    seedModel('not-returned')
    const before = storedModel()
    vi.mocked(listModels).mockResolvedValue({
      models: [
        { apiModelId: 'test-model', endpointTypes: ['anthropic-messages', 'openai-responses'] },
        { apiModelId: 'new-model', endpointTypes: ['openai-responses'] }
      ]
    })

    await service.check()

    expect(storedModel()).toEqual({
      ...before,
      endpointTypes: ['anthropic-messages', 'openai-responses'],
      updatedAt: expect.any(Number)
    })
    expect(storedModel('not-returned').endpointTypes).toEqual(['openai-chat-completions'])
    expect(modelService.list({ providerId: 'cherryin' }).map((model) => model.apiModelId)).toEqual([
      'test-model',
      'not-returned'
    ])
    expect(modelService.getByKey('cherryin', 'test-model').endpointTypes).toEqual([
      'anthropic-messages',
      'openai-responses'
    ])
    expect(application.get('WindowManager').broadcast).toHaveBeenCalledWith(IpcChannel.DataApi_DataChanged, [
      { endpoint: '/models', kind: 'projection' },
      { endpoint: '/models/:uniqueModelId*' }
    ])
  })

  it.each(['missing-provider', 'disabled-provider', 'missing-key', 'missing-models', 'other-provider'])(
    'does not request models for %s',
    async (state) => {
      if (state !== 'missing-provider') {
        const providerId = state === 'other-provider' ? 'openai' : 'cherryin'
        seedProvider(providerId, state !== 'disabled-provider', state !== 'missing-key')
        if (state !== 'missing-models') seedModel('test-model', providerId)
      }
      await service.check()
      expect(listModels).not.toHaveBeenCalled()
      expect(application.get('CacheService').getPersist('cherryin.models.last_attempt_at')).toBeNull()
    }
  )

  it.each<ListedModels>([
    { models: [] },
    { models: [{ apiModelId: 'test-model' }] },
    { models: [{ apiModelId: 'test-model', endpointTypes: [] }] }
  ])('keeps local endpoints when the response has no usable endpoint data: %j', async (listing) => {
    seedProvider()
    seedModel()
    const before = storedModel()
    vi.mocked(listModels).mockResolvedValue(listing)
    await service.check()
    expect(storedModel()).toEqual(before)
  })

  it('keeps local data on failure and throttles retries across service restarts', async () => {
    seedProvider()
    seedModel()
    const before = storedModel()
    vi.mocked(listModels).mockRejectedValueOnce(new Error('offline'))
    await service.check()
    expect(storedModel()).toEqual(before)

    await service._doStop()
    BaseService.resetInstances()
    service = new CherryInModelSyncService()
    await service.check()
    expect(listModels).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + SIX_HOURS)
    await service.check()
    expect(storedModel().endpointTypes).toEqual(['openai-responses'])
  })

  it('does not write unchanged endpoints', async () => {
    seedProvider()
    seedModel()
    const before = storedModel()
    vi.mocked(listModels).mockResolvedValue({
      models: [{ apiModelId: 'test-model', endpointTypes: ['openai-chat-completions'] }]
    })
    await service.check()
    expect(storedModel()).toEqual(before)
  })

  it('throttles empty responses without delaying the first eligible request', async () => {
    await service.check()
    seedProvider()
    seedModel()
    vi.mocked(listModels).mockResolvedValueOnce({ models: [] })
    await service.check()
    await service.check()
    expect(listModels).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + SIX_HOURS)
    await service.check()
    expect(storedModel().endpointTypes).toEqual(['openai-responses'])
  })

  it('does not use disabled credentials', async () => {
    seedProvider()
    seedModel()
    dbh.db
      .update(userProviderTable)
      .set({ apiKeys: [{ id: 'key-id', key: 'test-key', isEnabled: false }] })
      .run()
    await service.check()
    expect(listModels).not.toHaveBeenCalled()
  })

  it('aborts a stalled request after 30 seconds without changing local data', async () => {
    seedProvider()
    seedModel()
    const before = storedModel()
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal)
    vi.mocked(listModels).mockImplementation(
      (_provider, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
        })
    )
    const pending = service.check()
    timeout.abort(new DOMException('Request timed out', 'TimeoutError'))
    await pending
    expect(storedModel()).toEqual(before)
    expect(AbortSignal.timeout).toHaveBeenCalledWith(30_000)
    vi.mocked(AbortSignal.timeout).mockRestore()
  })

  it('cleans up scheduled work on shutdown', async () => {
    seedProvider()
    seedModel()
    await service._doInit()
    await service._doStop()
    await vi.advanceTimersByTimeAsync(SIX_HOURS * 2)
    expect(listModels).not.toHaveBeenCalled()
  })

  it('starts after 30 seconds and refreshes again after six hours', async () => {
    seedProvider()
    seedModel()
    await service._doInit()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(storedModel().endpointTypes).toEqual(['openai-chat-completions'])
    await vi.advanceTimersByTimeAsync(1)
    expect(storedModel().endpointTypes).toEqual(['openai-responses'])

    vi.mocked(listModels).mockResolvedValue({
      models: [{ apiModelId: 'test-model', endpointTypes: ['anthropic-messages'] }]
    })
    await vi.advanceTimersByTimeAsync(SIX_HOURS - 30_000)
    expect(storedModel().endpointTypes).toEqual(['openai-responses'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(storedModel().endpointTypes).toEqual(['anthropic-messages'])
  })

  it.each(['disable', 'delete-model', 'stop'] as const)('discards an in-flight result after %s', async (action) => {
    seedProvider()
    seedModel()
    let complete!: (listing: ListedModels) => void
    vi.mocked(listModels).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const pending = service.check()
    await service.check()
    expect(listModels).toHaveBeenCalledTimes(1)

    if (action === 'disable')
      dbh.db
        .update(userProviderTable)
        .set({ isEnabled: false })
        .where(eq(userProviderTable.providerId, 'cherryin'))
        .run()
    if (action === 'delete-model') dbh.db.delete(userModelTable).run()
    if (action === 'stop') await service._doStop()
    complete({ models: [{ apiModelId: 'test-model', endpointTypes: ['openai-responses'] }] })
    await pending

    if (action === 'delete-model') expect(dbh.db.select().from(userModelTable).all()).toEqual([])
    else expect(storedModel().endpointTypes).toEqual(['openai-chat-completions'])
  })
})
