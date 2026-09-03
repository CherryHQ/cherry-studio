import { CHERRY_CLOUD_MODEL_FEATURE, type CherryCloudModelFeature } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCherryCloudModelAvailability } from '../useCherryCloudModelAvailability'

const mocks = vi.hoisted(() => ({
  availability: {
    entitledModelIds: [] as Model['id'][],
    quotaExhaustedModelIds: [] as Model['id'][],
    featuresByModelId: {} as Record<Model['id'], CherryCloudModelFeature[]>
  },
  ipcRequest: vi.fn(),
  statusChanged: undefined as (() => void) | undefined
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (_event: string, listener: () => void) => {
    mocks.statusChanged = listener
  }
}))

const cloudModel = (id: string): Model =>
  ({
    id: `cherryai-subscription::${id}`,
    providerId: 'cherryai-subscription',
    apiModelId: id,
    name: id,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }) satisfies Model

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function wrapper() {
  const cache = new Map()
  return ({ children }: PropsWithChildren) => createElement(SWRConfig, { value: { provider: () => cache } }, children)
}

describe('useCherryCloudModelAvailability', () => {
  beforeEach(() => {
    mocks.availability = { entitledModelIds: [], quotaExhaustedModelIds: [], featuresByModelId: {} }
    mocks.ipcRequest.mockReset().mockImplementation(async () => mocks.availability)
    mocks.statusChanged = undefined
  })

  it('keeps Cloud models Agent-only and disabled until the first snapshot arrives', () => {
    mocks.ipcRequest.mockReturnValue(new Promise(() => undefined))
    const model = cloudModel('deepseek-go')
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    expect(result.current.isModelAvailableForFeature(model, CHERRY_CLOUD_MODEL_FEATURE.AGENT)).toBe(true)
    expect(result.current.isModelAvailableForFeature(model, CHERRY_CLOUD_MODEL_FEATURE.CHAT)).toBe(false)
    expect(result.current.isModelDisabled(model)).toBe(true)
  })

  it('applies feature entitlements and quota exhaustion from the synchronized snapshot', async () => {
    const available = cloudModel('deepseek-go')
    const exhausted = cloudModel('deepseek-free')
    mocks.availability = {
      entitledModelIds: [available.id, exhausted.id],
      quotaExhaustedModelIds: [exhausted.id],
      featuresByModelId: {
        [available.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT, CHERRY_CLOUD_MODEL_FEATURE.CHAT],
        [exhausted.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT]
      }
    }
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isModelDisabled(available)).toBe(false))
    expect(result.current.isModelDisabled(exhausted)).toBe(true)
    expect(result.current.isModelAvailableForFeature(available, CHERRY_CLOUD_MODEL_FEATURE.CHAT)).toBe(true)
    expect(result.current.isModelAvailableForFeature(exhausted, CHERRY_CLOUD_MODEL_FEATURE.CHAT)).toBe(false)
  })

  it('does not synchronize while disabled', async () => {
    renderHook(() => useCherryCloudModelAvailability(false), { wrapper: wrapper() })

    await act(async () => Promise.resolve())
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('keeps models disabled when an older sign-in refresh finishes after sign out', async () => {
    const model = cloudModel('deepseek-go')
    mocks.availability = {
      entitledModelIds: [model.id],
      quotaExhaustedModelIds: [],
      featuresByModelId: { [model.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT, CHERRY_CLOUD_MODEL_FEATURE.CHAT] }
    }
    const pendingRefresh = deferred<typeof mocks.availability>()
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isModelDisabled(model)).toBe(false))

    mocks.ipcRequest.mockImplementationOnce(() => pendingRefresh.promise)
    act(() => mocks.statusChanged?.())
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))
    act(() => mocks.statusChanged?.())
    pendingRefresh.resolve({
      entitledModelIds: [model.id],
      quotaExhaustedModelIds: [],
      featuresByModelId: { [model.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT] }
    })

    await waitFor(() => expect(result.current.isModelDisabled(model)).toBe(true))
    expect(result.current.isModelAvailableForFeature(model, CHERRY_CLOUD_MODEL_FEATURE.CHAT)).toBe(true)
  })
})
