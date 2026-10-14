import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { miniAppGrantTable, miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { DataApiErrorFactory } from '@shared/data/api/errors'

import { miniAppActivityLog } from '../../activityLog'
import { MINI_APP_MAX_CONCURRENT_CALLS, resetBurstForTest } from '../../capabilities/ai'
import { resetHiddenBudgets } from '../../capabilities/quota'
import { handleBridgeRequest } from '../bridge'

const APP = 'com.example.model-availability'
const PROVIDER = 'private-provider'
const MODEL = 'private-model'
const ID = `${PROVIDER}::${MODEL}`
const GUEST = 7
const { streamPrompt } = vi.hoisted(() => ({ streamPrompt: vi.fn() }))

vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('../../__tests__/applicationMock')
  return mockMiniAppApplication({
    AiStreamManager: { streamPrompt },
    MiniAppRuntimeService: {
      resolveAppIdBySender: () => APP,
      beginCapabilityCall: () => {},
      displayNameOf: () => APP,
      isGuestAlive: () => true,
      isGuestVisible: () => true,
      rememberStream: () => {},
      forgetStream: () => {}
    }
  })
})

describe('mini app model availability through the bridge', () => {
  const dbh = setupTestDatabase()
  const request = (model: 'default' | 'quick' = 'default', emit = vi.fn()) =>
    handleBridgeRequest(
      GUEST,
      {
        method: 'ai.chat',
        params: { model, messages: [{ role: 'user', content: 'hello' }] }
      },
      emit
    )

  function insertModel() {
    dbh.db
      .insert(userModelTable)
      .values({
        id: ID,
        providerId: PROVIDER,
        modelId: MODEL,
        name: 'Private model',
        capabilities: [],
        supportsStreaming: true,
        outputModalities: ['text'],
        orderKey: 'a0'
      })
      .run()
  }

  beforeEach(() => {
    resetBurstForTest()
    resetHiddenBudgets(GUEST)
    streamPrompt.mockReset()
    MockMainPreferenceServiceUtils.resetMocks()
    // Activity-file IO is orthogonal; grants, model lookup, deletion and bridge routing stay real.
    vi.spyOn(miniAppActivityLog, 'recordCall').mockImplementation(() => {})
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: PROVIDER,
        name: 'Private provider',
        isEnabled: true,
        orderKey: 'a0'
      })
      .run()
    insertModel()
    dbh.db
      .insert(miniAppTable)
      .values({
        appId: APP,
        kind: 'app',
        name: APP,
        url: `cherry-miniapp://${APP}/index.html`,
        status: 'enabled',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(miniAppInstallationTable)
      .values({
        appId: APP,
        version: '1.0.0',
        contentHash: 'sha256:test',
        source: 'file',
        manifestJson: {
          id: APP,
          name: { en: 'Model availability' },
          description: { en: 'Model availability test' },
          version: '1.0.0',
          entry: 'index.html',
          permissions: ['ai.chat'],
          optionalPermissions: [],
          network: []
        },
        aiModelId: ID,
        aiQuickModelId: ID
      })
      .run()
    dbh.db
      .insert(miniAppGrantTable)
      .values({
        appId: APP,
        permission: 'ai.chat',
        grantedVersion: '1.0.0'
      })
      .run()
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['default', 'model'],
    ['quick', 'model'],
    ['default', 'provider'],
    ['quick', 'provider']
  ] as const)('reports a deleted %s slot %s as sanitized Unavailable', async (slot, deleted) => {
    if (deleted === 'model') modelService.delete(PROVIDER, MODEL)
    else dbh.db.delete(userProviderTable).where(eq(userProviderTable.providerId, PROVIDER)).run()
    expect(dbh.db.select().from(miniAppInstallationTable).get()).toMatchObject({
      aiModelId: ID,
      aiQuickModelId: ID
    })
    const result = await request(slot)
    expect(result).toEqual({
      ok: false,
      error: { name: 'Unavailable', message: 'The configured model is unavailable' }
    })
    expect(JSON.stringify(result)).not.toMatch(/private-provider|private-model/)
    expect(streamPrompt).not.toHaveBeenCalled()
    expect(
      await handleBridgeRequest(
        GUEST,
        {
          method: 'ai.getCapabilities',
          params: { model: slot }
        },
        vi.fn()
      )
    ).toEqual({ ok: true, value: { available: false } })
  })

  it('can stream text after repairing a deleted selection without leaking admission slots', async () => {
    modelService.delete(PROVIDER, MODEL)
    for (let i = 0; i <= MINI_APP_MAX_CONCURRENT_CALLS; i++) {
      expect(await request()).toMatchObject({ ok: false, error: { name: 'Unavailable' } })
    }
    insertModel()
    const emit = vi.fn()
    const response = request('default', emit)
    const { listener } = streamPrompt.mock.calls.at(-1)![0]
    listener.onChunk({ type: 'text-delta', delta: 'hello again' })
    listener.onDone({ status: 'success' })
    expect(await response).toEqual({ ok: true, value: { ok: true } })
    expect(emit).toHaveBeenCalledWith('hello again')
  })

  it.each([
    new Error('private database connection failed'),
    DataApiErrorFactory.database(new Error('private database connection failed'))
  ])('keeps unexpected lookup failures Internal without leaking details: %s', async (error) => {
    vi.spyOn(modelService, 'getByKey').mockImplementationOnce(() => {
      throw error
    })
    expect(await request()).toEqual({ ok: false, error: { name: 'Internal', message: 'Internal error' } })
    expect(streamPrompt).not.toHaveBeenCalled()
  })

  it('keeps malformed saved IDs InvalidArgument', async () => {
    dbh.db
      .update(miniAppInstallationTable)
      .set({ aiModelId: 'invalid-id' })
      .where(eq(miniAppInstallationTable.appId, APP))
      .run()
    expect(await request()).toMatchObject({ ok: false, error: { name: 'InvalidArgument' } })
    expect(streamPrompt).not.toHaveBeenCalled()
  })
})
