import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { CherryCloudModelSyncResult } from '@shared/ipc/schemas/cherryCloud'

import { useCherryCloudModelAvailability } from '../useCherryCloudModelAvailability'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  statusChanged: undefined as (() => void) | undefined
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (_event: string, listener: () => void) => {
    mocks.statusChanged = listener
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function model(providerId: string, modelId: string): Model {
  return {
    id: `${providerId}::${modelId}`,
    providerId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

const cloud = (modelId: string) => model('cherryai-subscription', modelId)
const regular = model('openai', 'gpt-4o')

function snapshot(overrides: Partial<CherryCloudModelSyncResult> = {}): CherryCloudModelSyncResult {
  return {
    entitledModelIds: [],
    freeModelIds: [],
    availableModelIds: { agent: [], general: [] },
    quotaExhaustedModelIds: [],
    ...overrides
  }
}

function wrapper() {
  const cache = new Map()
  return ({ children }: PropsWithChildren) => createElement(SWRConfig, { value: { provider: () => cache } }, children)
}

describe('useCherryCloudModelAvailability', () => {
  beforeEach(() => {
    mocks.ipcRequest.mockReset()
    mocks.statusChanged = undefined
  })

  it('hides Cloud models until the first snapshot arrives', () => {
    mocks.ipcRequest.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    expect(result.current.isModelHidden(cloud('deepseek-go'), true)).toBe(true)
    expect(result.current.isModelHidden(cloud('deepseek-go'), false)).toBe(true)
    expect(result.current.isModelHidden(regular, false)).toBe(false)
  })

  it('shows a Work-only model only in Agent pickers and a shared model everywhere', async () => {
    const workOnly = cloud('work-only')
    const shared = cloud('shared')
    mocks.ipcRequest.mockResolvedValue(
      snapshot({
        entitledModelIds: [workOnly.id, shared.id],
        availableModelIds: { agent: [workOnly.id, shared.id], general: [shared.id] }
      })
    )
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isModelHidden(shared, false)).toBe(false))
    expect(result.current.isModelHidden(workOnly, true)).toBe(false)
    expect(result.current.isModelHidden(workOnly, false)).toBe(true)
    expect(result.current.isModelHidden(shared, true)).toBe(false)
  })

  it('disables exhausted models and describes free and quota status', async () => {
    const workOnlyFree = cloud('work-only-free')
    const sharedFree = cloud('shared-free')
    const exhaustedFree = cloud('exhausted-free')
    const exhaustedPaid = cloud('exhausted-paid')
    const paid = cloud('paid')
    const all = [workOnlyFree, sharedFree, exhaustedFree, exhaustedPaid, paid].map((item) => item.id)
    mocks.ipcRequest.mockResolvedValue(
      snapshot({
        entitledModelIds: all,
        freeModelIds: [workOnlyFree.id, sharedFree.id, exhaustedFree.id],
        availableModelIds: {
          agent: all,
          general: [sharedFree.id, exhaustedFree.id, exhaustedPaid.id, paid.id]
        },
        quotaExhaustedModelIds: [exhaustedFree.id, exhaustedPaid.id]
      })
    )
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isModelUnavailable(exhaustedFree)).toBe(true))
    expect(result.current.isModelUnavailable(exhaustedPaid)).toBe(true)
    expect(result.current.isModelUnavailable(paid)).toBe(false)
    expect(result.current.getModelDescription(workOnlyFree)).toBe('models.detail.limited_time_free_agent_only')
    expect(result.current.getModelDescription(sharedFree)).toBe('models.detail.limited_time_free')
    expect(result.current.getModelDescription(exhaustedFree)).toBe('models.detail.free_quota_exhausted')
    expect(result.current.getModelDescription(exhaustedPaid)).toBe('models.detail.quota_exhausted')
    expect(result.current.getModelDescription(paid)).toBeUndefined()
    expect(result.current.getModelDescription(regular)).toBeUndefined()
  })

  it('does not synchronize while disabled', async () => {
    renderHook(() => useCherryCloudModelAvailability(false), { wrapper: wrapper() })

    await act(async () => Promise.resolve())
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('hides models again when an older sign-in refresh finishes after sign out', async () => {
    const shared = cloud('shared')
    const signedIn = snapshot({
      entitledModelIds: [shared.id],
      availableModelIds: { agent: [shared.id], general: [shared.id] }
    })
    mocks.ipcRequest.mockResolvedValue(signedIn)
    const pendingRefresh = Promise.withResolvers<CherryCloudModelSyncResult>()
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isModelHidden(shared, false)).toBe(false))

    mocks.ipcRequest.mockImplementationOnce(() => pendingRefresh.promise)
    act(() => mocks.statusChanged?.())
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))
    mocks.ipcRequest.mockResolvedValue(snapshot())
    act(() => mocks.statusChanged?.())
    pendingRefresh.resolve(signedIn)

    await waitFor(() => expect(result.current.isModelHidden(shared, false)).toBe(true))
  })
})
