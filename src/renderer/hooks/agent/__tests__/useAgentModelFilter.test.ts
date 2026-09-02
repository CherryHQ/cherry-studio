import { CHERRY_CLOUD_MODEL_FEATURE, type CherryCloudModelFeature } from '@shared/data/presets/cherryai'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCherryCloudModelAvailability } from '../../useCherryCloudModelAvailability'
import {
  modelFilterIncludesAgentOnlyProviders,
  useAgentModelDisabled,
  useAgentModelFilter
} from '../useAgentModelFilter'

const mocks = vi.hoisted(() => ({
  cloudAvailability: {
    entitledModelIds: [] as Model['id'][],
    quotaExhaustedModelIds: [] as Model['id'][],
    featuresByModelId: {} as Record<Model['id'], CherryCloudModelFeature[]>
  },
  ipcRequest: vi.fn(),
  statusChanged: undefined as
    | ((status: { phase: 'signed-out' | 'authorizing' | 'signed-in'; displayName: string | null }) => void)
    | undefined
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (_event: string, listener: NonNullable<typeof mocks.statusChanged>) => {
    mocks.statusChanged = listener
  }
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createSWRWrapper() {
  const cache = new Map()
  return ({ children }: PropsWithChildren) => createElement(SWRConfig, { value: { provider: () => cache } }, children)
}

function emitCloudStatus(phase: 'signed-out' | 'authorizing' | 'signed-in') {
  mocks.statusChanged?.({ phase, displayName: phase === 'signed-in' ? 'Cherry User' : null })
}

function model(capabilities: Model['capabilities'] = []): Model {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    name: 'GPT-4o',
    contextWindow: 128_000,
    capabilities,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

const providers = {
  openai: { id: 'openai', defaultChatEndpoint: 'openai-chat-completions', authType: 'api-key' },
  anthropic: { id: 'anthropic', defaultChatEndpoint: 'anthropic-messages', authType: 'api-key' },
  gemini: { id: 'gemini', defaultChatEndpoint: 'google-generate-content', authType: 'api-key' },
  vertex: {
    id: 'vertex',
    defaultChatEndpoint: 'google-generate-content',
    endpointConfigs: { 'google-generate-content': { adapterFamily: 'google-vertex' } },
    authType: 'iam-gcp'
  }
} as const satisfies Record<string, Partial<Provider>>

describe('useAgentModelFilter', () => {
  beforeEach(() => {
    mocks.cloudAvailability = {
      entitledModelIds: [],
      quotaExhaustedModelIds: [],
      featuresByModelId: {}
    }
    mocks.ipcRequest.mockReset()
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route !== 'cherry_cloud.models.sync') throw new Error(`Unexpected IPC route: ${route}`)
      return mocks.cloudAvailability
    })
    mocks.statusChanged = undefined
  })

  it('allows Gemini provider models for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' })).toBe(true)
    expect(result.current({ ...model(), providerId: 'google-custom', id: 'google-custom::gemini-2.5-pro' })).toBe(true)
  })

  it('marks its predicate so selectors surface agent-only providers', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(modelFilterIncludesAgentOnlyProviders(result.current)).toBe(true)
    expect(modelFilterIncludesAgentOnlyProviders(() => true)).toBe(false)
    expect(modelFilterIncludesAgentOnlyProviders(undefined)).toBe(false)
  })

  it('continues to reject non-chat model classes for regular agents', () => {
    const { result } = renderHook(() => useAgentModelFilter(undefined))

    expect(result.current(model())).toBe(true)
    expect(result.current(model([MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
  })

  it('keeps Cloud models Agent-only until the first model snapshot arrives', () => {
    mocks.ipcRequest.mockReturnValue(new Promise(() => undefined))
    const cloudModel = {
      ...model(),
      id: 'cherryai-subscription::deepseek-go',
      providerId: 'cherryai-subscription'
    } as Model
    const { result } = renderHook(() => useCherryCloudModelAvailability(), { wrapper: createSWRWrapper() })

    expect(result.current.isModelAvailableForFeature(cloudModel, CHERRY_CLOUD_MODEL_FEATURE.AGENT)).toBe(true)
    expect(result.current.isModelAvailableForFeature(cloudModel, CHERRY_CLOUD_MODEL_FEATURE.CHAT)).toBe(false)
    expect(result.current.isModelAvailableForFeature(cloudModel, CHERRY_CLOUD_MODEL_FEATURE.TRANSLATE)).toBe(false)
  })

  it('does not synchronize Cloud model availability while disabled', async () => {
    renderHook(() => useCherryCloudModelAvailability(false), { wrapper: createSWRWrapper() })

    await act(async () => Promise.resolve())

    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('accepts only Cloud models enabled for Agent by the latest sync result', async () => {
    const cloudModel = {
      ...model(),
      id: 'cherryai-subscription::deepseek-go',
      providerId: 'cherryai-subscription'
    } as Model
    mocks.cloudAvailability = {
      entitledModelIds: [cloudModel.id],
      quotaExhaustedModelIds: [],
      featuresByModelId: { [cloudModel.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT] }
    }
    const { result } = renderHook(() => useAgentModelFilter(undefined), { wrapper: createSWRWrapper() })

    await waitFor(() => expect(result.current(cloudModel)).toBe(true))
    expect(result.current({ ...cloudModel, id: 'cherryai-subscription::chat-only' })).toBe(false)
  })

  it('disables only Cloud models whose quota is exhausted', async () => {
    const exhaustedModel = {
      ...model(),
      id: 'cherryai-subscription::deepseek-free',
      providerId: 'cherryai-subscription'
    } as Model
    const availableModel = {
      ...model(),
      id: 'cherryai-subscription::deepseek-go',
      providerId: 'cherryai-subscription'
    } as Model
    mocks.cloudAvailability = {
      entitledModelIds: [exhaustedModel.id, availableModel.id],
      quotaExhaustedModelIds: [exhaustedModel.id],
      featuresByModelId: {
        [exhaustedModel.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT],
        [availableModel.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT]
      }
    }

    const { result } = renderHook(() => useAgentModelDisabled(), { wrapper: createSWRWrapper() })

    await waitFor(() => expect(result.current(availableModel)).toBe(false))
    expect(result.current(exhaustedModel)).toBe(true)
    expect(result.current(model())).toBe(false)
  })

  it('refreshes Cloud model availability immediately after sign in', async () => {
    const cloudModel = {
      ...model(),
      id: 'cherryai-subscription::deepseek-free',
      providerId: 'cherryai-subscription'
    } as Model
    const { result } = renderHook(() => useAgentModelDisabled(), { wrapper: createSWRWrapper() })

    await waitFor(() => expect(result.current(cloudModel)).toBe(true))
    mocks.cloudAvailability = {
      entitledModelIds: [cloudModel.id],
      quotaExhaustedModelIds: [],
      featuresByModelId: { [cloudModel.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT] }
    }

    act(() => emitCloudStatus('signed-in'))

    await waitFor(() => expect(result.current(cloudModel)).toBe(false))
  })

  it('keeps Cloud models disabled when a previous sign-in refresh finishes after sign out', async () => {
    const cloudModel = {
      ...model(),
      id: 'cherryai-subscription::deepseek-free',
      providerId: 'cherryai-subscription'
    } as Model
    const pendingRefresh = createDeferred<typeof mocks.cloudAvailability>()
    const { result } = renderHook(() => useAgentModelDisabled(), { wrapper: createSWRWrapper() })

    await waitFor(() => expect(result.current(cloudModel)).toBe(true))
    mocks.ipcRequest.mockImplementationOnce(() => pendingRefresh.promise)
    act(() => emitCloudStatus('signed-in'))
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))

    act(() => emitCloudStatus('signed-out'))
    pendingRefresh.resolve({
      entitledModelIds: [cloudModel.id],
      quotaExhaustedModelIds: [],
      featuresByModelId: { [cloudModel.id]: [CHERRY_CLOUD_MODEL_FEATURE.AGENT] }
    })

    await waitFor(() => expect(result.current(cloudModel)).toBe(true))
  })

  describe('pi agents', () => {
    it('allows models on providers pi can drive', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      expect(
        result.current({ ...model(), providerId: 'openai', id: 'openai::gpt-4o' }, providers.openai as Provider)
      ).toBe(true)
      expect(
        result.current(
          { ...model(), providerId: 'anthropic', id: 'anthropic::claude-sonnet' },
          providers.anthropic as Provider
        )
      ).toBe(true)
      expect(
        result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' }, providers.gemini as Provider)
      ).toBe(true)
    })

    it('filters models whose provider has no pi API mapping', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      // Vertex is unsupported for pi (D2).
      expect(
        result.current({ ...model(), providerId: 'vertex', id: 'vertex::gemini-2.5-pro' }, providers.vertex as Provider)
      ).toBe(false)
      // Unknown provider (no entry) cannot be resolved → filtered.
      expect(result.current({ ...model(), providerId: 'ghost', id: 'ghost::model' })).toBe(false)
    })

    it('still rejects non-chat model classes for pi', () => {
      const { result } = renderHook(() => useAgentModelFilter('pi'))

      expect(result.current({ ...model([MODEL_CAPABILITY.EMBEDDING]), providerId: 'openai' })).toBe(false)
    })
  })
})
