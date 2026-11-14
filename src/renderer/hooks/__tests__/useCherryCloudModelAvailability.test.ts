import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { CherryCloudAccountReceipt, CherryCloudModelSyncResult } from '@shared/ipc/schemas/cherryCloud'

import { useCherryCloudModelAvailability } from '../useCherryCloudModelAvailability'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  receipt: undefined as CherryCloudAccountReceipt | undefined,
  revision: 0,
  scope: 0,
  statusChanged: undefined as (() => void) | undefined
}))

vi.mock('@renderer/ipc', async () => {
  const { useEffect } = await import('react')
  const listeners = new Set<(receipt: CherryCloudAccountReceipt) => void>()
  function empty() {
    return {
      status: {
        phase: 'signed-in' as const,
        accountId: 'a',
        displayName: null,
        scopeId: String(mocks.scope),
        revision: ++mocks.revision
      },
      reason: 'models' as const,
      account: { freshness: 'unknown' as const, error: null },
      models: { freshness: 'unknown' as const, error: null },
      plans: { freshness: 'unknown' as const, error: null }
    }
  }
  return {
    ipcApi: {
      request: async (route: string) => {
        if (route === 'cherry_cloud.account.get') return (mocks.receipt ??= empty())
        const scope = mocks.scope
        try {
          const value = await mocks.ipcRequest(route)
          if (scope !== mocks.scope) throw new DOMException('superseded', 'AbortError')
          const next = { ...empty(), models: { freshness: 'fresh' as const, value, observedRevision: mocks.revision } }
          mocks.receipt = next
          listeners.forEach((listener) => listener(next))
          return value
        } catch (error) {
          if (scope === mocks.scope) {
            const previous = mocks.receipt?.models
            const next = {
              ...empty(),
              models:
                previous && previous.freshness !== 'unknown'
                  ? {
                      ...previous,
                      freshness: 'stale' as const,
                      error: error instanceof Error ? error.message : String(error)
                    }
                  : { freshness: 'unknown' as const, error: error instanceof Error ? error.message : String(error) }
            }
            mocks.receipt = next
            listeners.forEach((listener) => listener(next))
          }
          throw error
        }
      }
    },
    useIpcOn: (_event: string, listener: (receipt: CherryCloudAccountReceipt) => void) => {
      useEffect(() => {
        listeners.add(listener)
        mocks.statusChanged = () => {
          mocks.scope += 1
          const next = empty()
          mocks.receipt = next
          listeners.forEach((callback) => callback(next))
        }
        return () => {
          listeners.delete(listener)
        }
      }, [listener])
    }
  }
})

// Stable t identity: real i18next t does not change between renders, and an
// unstable t would recompute the hook memo every render, masking missing
// dependency bugs (e.g. availabilityError transitions).
const stableT = (key: string) => key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT })
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
    mocks.receipt = undefined
    mocks.scope += 1
    mocks.revision = 0
  })

  it('reports availability as not ready while the first snapshot is pending', () => {
    mocks.ipcRequest.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    expect(result.current.isAvailabilityReady).toBe(false)
    expect(result.current.availabilityError).toBeUndefined()
  })

  it('reports availability as ready once the first snapshot arrives', async () => {
    mocks.ipcRequest.mockResolvedValue(snapshot())
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isAvailabilityReady).toBe(true))
    expect(result.current.availabilityError).toBeUndefined()
  })

  it('keeps availability not ready and surfaces the error when the sync fails', async () => {
    const failure = new Error('sync failed')
    mocks.ipcRequest.mockRejectedValue(failure)
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.availabilityError).toEqual(failure))
    expect(result.current.isAvailabilityReady).toBe(false)
    expect(result.current.isModelHidden(cloud('deepseek-go'), true)).toBe(true)
  })

  it('hides Cloud models until the first snapshot arrives', () => {
    mocks.ipcRequest.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    expect(result.current.isModelHidden(cloud('deepseek-go'), true)).toBe(true)
    expect(result.current.isModelHidden(cloud('deepseek-go'), false)).toBe(true)
    expect(result.current.isModelHidden(regular, false)).toBe(false)
  })

  it('reports first-snapshot hydration and settles without changing main visibility rules', async () => {
    let resolve!: (value: CherryCloudModelSyncResult) => void
    mocks.ipcRequest.mockReturnValue(
      new Promise<CherryCloudModelSyncResult>((done) => {
        resolve = done
      })
    )
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isAvailabilityReady).toBe(false))
    expect(result.current.isModelHidden(cloud('work-only'), true)).toBe(true)
    await act(async () => resolve(snapshot({ availableModelIds: { agent: [cloud('work-only').id], general: [] } })))
    await waitFor(() => expect(result.current.isAvailabilityReady).toBe(true))
    expect(result.current.isModelHidden(cloud('work-only'), true)).toBe(false)
    expect(result.current.isModelHidden(cloud('work-only'), false)).toBe(true)
  })

  it('keeps receipt availability unready on failure while unknown Cloud models stay hidden', async () => {
    mocks.ipcRequest.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.availabilityError?.message).toBe('offline'))
    expect(result.current.isAvailabilityReady).toBe(false)
    expect(result.current.isModelHidden(cloud('unknown'), true)).toBe(true)
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

  it('locks a Cloud model only once a snapshot says this module cannot use it', async () => {
    const workOnly = cloud('work-only')
    const pending = Promise.withResolvers<CherryCloudModelSyncResult>()
    mocks.ipcRequest.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    expect(result.current.isModelLocked(workOnly, true)).toBe(false)
    pending.resolve(
      snapshot({ entitledModelIds: [workOnly.id], availableModelIds: { agent: [workOnly.id], general: [] } })
    )

    await waitFor(() => expect(result.current.isModelLocked(workOnly, false)).toBe(true))
    expect(result.current.isModelLocked(workOnly, true)).toBe(false)
    expect(result.current.isModelLocked(regular, false)).toBe(false)
  })

  it('does not lock a model while a sign-in still waits for its snapshot', async () => {
    const shared = cloud('shared')
    mocks.ipcRequest.mockResolvedValueOnce(snapshot())
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isModelLocked(shared, true)).toBe(true))

    const signedIn = Promise.withResolvers<CherryCloudModelSyncResult>()
    mocks.ipcRequest.mockReturnValueOnce(signedIn.promise)
    act(() => mocks.statusChanged?.())

    await waitFor(() => expect(result.current.isModelLocked(shared, true)).toBe(false))
    signedIn.resolve(
      snapshot({ entitledModelIds: [shared.id], availableModelIds: { agent: [shared.id], general: [shared.id] } })
    )
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))
    expect(result.current.isModelLocked(shared, true)).toBe(false)
  })

  it('does not synchronize while disabled', async () => {
    renderHook(() => useCherryCloudModelAvailability(false), { wrapper: wrapper() })

    await act(async () => Promise.resolve())
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('keeps reset availability unknown until a real response, including failure and recovery', async () => {
    const shared = cloud('shared')
    const signedIn = snapshot({
      entitledModelIds: [shared.id],
      availableModelIds: { agent: [shared.id], general: [shared.id] }
    })
    mocks.ipcRequest.mockResolvedValueOnce(signedIn)
    const cachedWrapper = wrapper()
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: cachedWrapper })
    await waitFor(() => expect(result.current.isAvailabilityReady).toBe(true))

    const pending = Promise.withResolvers<CherryCloudModelSyncResult>()
    mocks.ipcRequest.mockImplementationOnce(() => pending.promise)
    act(() => mocks.statusChanged?.())
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))
    expect(result.current.isAvailabilityReady).toBe(false)
    expect(result.current.isModelHidden(shared, false)).toBe(true)

    // A second consumer of the shared SWR cache must not mistake the reset
    // placeholder for a completed empty server snapshot either.
    const second = renderHook(() => useCherryCloudModelAvailability(), { wrapper: cachedWrapper })
    expect(second.result.current.isAvailabilityReady).toBe(false)

    const failure = new Error('reset sync failed')
    await act(async () => pending.reject(failure))
    await waitFor(() => expect(result.current.availabilityError).toEqual(failure))
    expect(result.current.isAvailabilityReady).toBe(false)
    expect(second.result.current.isAvailabilityReady).toBe(false)

    // A genuine empty response is ready: a signed-out account may have no models.
    mocks.ipcRequest.mockResolvedValueOnce(snapshot())
    act(() => mocks.statusChanged?.())
    await waitFor(() => expect(result.current.isAvailabilityReady).toBe(true))
    expect(result.current.availabilityError).toBeUndefined()
    expect(second.result.current.isAvailabilityReady).toBe(true)
    expect(result.current.isModelHidden(shared, false)).toBe(true)
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
