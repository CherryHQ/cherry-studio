import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentModelDisabled, useAgentModelFilter } from '../useAgentModelFilter'

const mocks = vi.hoisted(() => ({
  availability: {
    entitledModelIds: [] as Model['id'][],
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

  it('keeps Cloud models visible so the disabled predicate owns availability', () => {
    const { result } = renderHook(() => useAgentModelFilter(undefined))

    expect(result.current(cloudModel('deepseek-go'))).toBe(true)
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
    mocks.availability = { entitledModelIds: [], quotaExhaustedModelIds: [] }
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
    const available = cloudModel('deepseek-go')
    const exhausted = cloudModel('deepseek-free')
    mocks.availability = {
      entitledModelIds: [available.id, exhausted.id],
      quotaExhaustedModelIds: [exhausted.id]
    }
    const { result } = renderHook(() => useAgentModelDisabled(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current(available)).toBe(false))
    expect(result.current(exhausted)).toBe(true)
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
      quotaExhaustedModelIds: []
    })

    await waitFor(() => expect(result.current(cloud)).toBe(true))
  })
})
