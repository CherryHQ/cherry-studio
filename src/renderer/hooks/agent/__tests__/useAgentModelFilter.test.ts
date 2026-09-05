import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentModelAvailability, useAgentModelDisabled, useAgentModelFilter } from '../useAgentModelFilter'

const mocks = vi.hoisted(() => ({
  availability: {
    entitledModelIds: [] as Model['id'][],
    freeModelIds: [] as Model['id'][],
    availableModelIdsByFeature: {
      agent: [] as Model['id'][],
      chat: [] as Model['id'][],
      translate: [] as Model['id'][]
    },
    quotaExhaustedModelIds: [] as Model['id'][]
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

function cloudModel(id: string): Model {
  return {
    ...model(),
    id: `cherryai-subscription::${id}`,
    providerId: 'cherryai-subscription',
    apiModelId: id,
    name: id
  }
}

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
  it('allows Gemini provider models for Claude Code agents', () => {
    const { result } = renderHook(() => useAgentModelFilter('claude-code'))

    expect(result.current({ ...model(), providerId: 'gemini', id: 'gemini::gemini-2.5-pro' })).toBe(true)
    expect(result.current({ ...model(), providerId: 'google-custom', id: 'google-custom::gemini-2.5-pro' })).toBe(true)
  })

  it('continues to reject non-chat model classes for regular agents', () => {
    const { result } = renderHook(() => useAgentModelFilter(undefined))

    expect(result.current(model())).toBe(true)
    expect(result.current(model([MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
  })

  it('shows Cloud models only when the server enables them for agents', async () => {
    const agentModel = cloudModel('agent-model')
    const chatModel = cloudModel('chat-model')
    mocks.availability = {
      entitledModelIds: [agentModel.id, chatModel.id],
      freeModelIds: [],
      availableModelIdsByFeature: { agent: [agentModel.id], chat: [chatModel.id], translate: [] },
      quotaExhaustedModelIds: []
    }
    mocks.ipcRequest.mockImplementation(async () => mocks.availability)
    const { result } = renderHook(() => useAgentModelFilter(undefined), { wrapper: wrapper() })

    await waitFor(() => expect(result.current(agentModel)).toBe(true))
    expect(result.current(chatModel)).toBe(false)
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

describe('useAgentModelDisabled', () => {
  beforeEach(() => {
    mocks.availability = {
      entitledModelIds: [],
      freeModelIds: [],
      availableModelIdsByFeature: { agent: [], chat: [], translate: [] },
      quotaExhaustedModelIds: []
    }
    mocks.ipcRequest.mockReset().mockImplementation(async () => mocks.availability)
    mocks.statusChanged = undefined
  })

  it('keeps Cloud models disabled until the first snapshot arrives', () => {
    mocks.ipcRequest.mockReturnValue(new Promise(() => undefined))
    const cloud = cloudModel('deepseek-go')
    const { result } = renderHook(() => useAgentModelDisabled(), { wrapper: wrapper() })

    expect(result.current(cloud)).toBe(true)
    expect(result.current(model())).toBe(false)
  })

  it('applies entitlements and quota exhaustion from the synchronized snapshot', async () => {
    const paid = cloudModel('deepseek-go')
    const free = cloudModel('deepseek-free-available')
    const exhausted = cloudModel('deepseek-free')
    mocks.availability = {
      entitledModelIds: [paid.id, free.id, exhausted.id],
      freeModelIds: [free.id, exhausted.id],
      availableModelIdsByFeature: {
        agent: [paid.id, free.id, exhausted.id],
        chat: [paid.id],
        translate: [paid.id]
      },
      quotaExhaustedModelIds: [exhausted.id]
    }
    const { result } = renderHook(() => useAgentModelAvailability(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isModelDisabled(paid)).toBe(false))
    expect(result.current.isModelDisabled(free)).toBe(false)
    expect(result.current.isModelDisabled(exhausted)).toBe(true)
    expect(result.current.getModelFreeQuotaStatus(paid)).toBeUndefined()
    expect(result.current.getModelFreeQuotaStatus(free)).toBe('available')
    expect(result.current.getModelFreeQuotaStatus(exhausted)).toBe('exhausted')
    expect(result.current.isModelExclusiveToAgent(free)).toBe(true)
    expect(result.current.isModelExclusiveToAgent(paid)).toBe(false)
  })

  it('does not synchronize while disabled', async () => {
    renderHook(() => useAgentModelDisabled(false), { wrapper: wrapper() })

    await act(async () => Promise.resolve())
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('keeps models disabled when an older sign-in refresh finishes after sign out', async () => {
    const cloud = cloudModel('deepseek-go')
    mocks.availability = {
      entitledModelIds: [cloud.id],
      freeModelIds: [cloud.id],
      availableModelIdsByFeature: { agent: [cloud.id], chat: [], translate: [] },
      quotaExhaustedModelIds: []
    }
    const pendingRefresh = deferred<typeof mocks.availability>()
    const { result } = renderHook(() => useAgentModelDisabled(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current(cloud)).toBe(false))

    mocks.ipcRequest.mockImplementationOnce(() => pendingRefresh.promise)
    act(() => mocks.statusChanged?.())
    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))
    act(() => mocks.statusChanged?.())
    pendingRefresh.resolve({
      entitledModelIds: [cloud.id],
      freeModelIds: [cloud.id],
      availableModelIdsByFeature: { agent: [cloud.id], chat: [], translate: [] },
      quotaExhaustedModelIds: []
    })

    await waitFor(() => expect(result.current(cloud)).toBe(true))
  })
})
