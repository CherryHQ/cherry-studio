/**
 * Verifies the T-008C v2-data-source swap: chat-model-popup is now fed by
 * `useProviders` (v2 DataApi plural) + `useModels`, shimmed back to v1 shape
 * via `toV1ProviderShim` / `toV1ModelShim` so every downstream consumer
 * (Chat.tsx, MessageMenubar, assistant.model, sendMessage) sees the same
 * `{ id, provider, ... }` they did before.
 *
 * The CHERRYAI fallback path is the explicit "option A" decision from
 * T-008B: keep injecting CHERRYAI_PROVIDER until v2 catalog seeds a real
 * cherryai user_model, so fresh installs don't lose the demo Qwen.
 */
import { CHERRYAI_PROVIDER } from '@renderer/config/providers'
import type { Provider as V1Provider } from '@renderer/types'
import type { Model as V2Model } from '@shared/data/types/model'
import type { Provider as V2Provider } from '@shared/data/types/provider'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as BasePopupModule from '../base-popup'
import { PopupContainer } from '../chat-model-popup'

const mockUseV2Providers = vi.fn()
const mockUseV2Models = vi.fn()

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: unknown[]) => mockUseV2Models(...args)
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviders: (...args: unknown[]) => mockUseV2Providers(...args)
}))

const baseViewSpy = vi.fn()
vi.mock('../base-popup', async () => {
  const actual = await vi.importActual<typeof BasePopupModule>('../base-popup')
  return {
    ...actual,
    default: (props: { providers: unknown }) => {
      baseViewSpy(props)
      return null as unknown as ReactNode
    }
  }
})

function makeV2Provider(id: string, overrides: Partial<V2Provider> = {}): V2Provider {
  return {
    id,
    name: `name(${id})`,
    isEnabled: true,
    apiKeys: [],
    authType: 'apiKey',
    apiFeatures: {} as V2Provider['apiFeatures'],
    settings: {} as V2Provider['settings'],
    endpointConfigs: {},
    ...overrides
  } as V2Provider
}

function makeV2Model(id: string, providerId: string, overrides: Partial<V2Model> = {}): V2Model {
  return {
    id: `${providerId}::${id}`,
    providerId,
    apiModelId: id,
    name: id,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as V2Model
}

function wireV2(opts: { providers: V2Provider[]; models: V2Model[] }) {
  mockUseV2Providers.mockReturnValue({
    providers: opts.providers,
    isLoading: false,
    createProvider: vi.fn(),
    isCreating: false,
    createError: undefined,
    refetch: vi.fn()
  })
  mockUseV2Models.mockReturnValue({
    models: opts.models,
    isLoading: false,
    refetch: vi.fn()
  })
}

function lastProvidersProp(): V1Provider[] {
  expect(baseViewSpy).toHaveBeenCalled()
  const calls = baseViewSpy.mock.calls
  const last = calls[calls.length - 1]
  return (last[0] as { providers: V1Provider[] }).providers
}

beforeEach(() => {
  baseViewSpy.mockClear()
  mockUseV2Providers.mockReset()
  mockUseV2Models.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('chat-model-popup PopupContainer (T-008C v2 data source)', () => {
  it('renders v2 Ollama models in v1 shape via toV1ModelShim', () => {
    wireV2({
      providers: [makeV2Provider('ollama')],
      models: [makeV2Model('qwen2.5:7b-instruct', 'ollama'), makeV2Model('gemma:7b', 'ollama')]
    })

    render(<PopupContainer resolve={vi.fn()} />)

    const providers = lastProvidersProp()
    const ollama = providers.find((p) => p.id === 'ollama')
    expect(ollama).toBeDefined()
    expect(ollama!.models.map((m) => m.id)).toEqual(['qwen2.5:7b-instruct', 'gemma:7b'])
    expect(ollama!.models[0].provider).toBe('ollama')
    // v1 contract: id is raw modelId, not UniqueModelId, so downstream
    // (messageThunk -> StreamingService) keeps falling into the T-005B
    // safeModelId(null) branch — no FK regression.
    expect(ollama!.models[0].id).not.toContain('::')
  })

  it('keeps CHERRYAI_PROVIDER fallback when v2 has no cherryai models', () => {
    wireV2({
      providers: [makeV2Provider('ollama')],
      models: [makeV2Model('qwen2.5:7b-instruct', 'ollama')]
    })

    render(<PopupContainer resolve={vi.fn()} />)

    const providers = lastProvidersProp()
    expect(providers.map((p) => p.id)).toContain('cherryai')
    const cherryai = providers.find((p) => p.id === 'cherryai')!
    expect(cherryai.models.length).toBeGreaterThan(0)
    expect(cherryai.models).toEqual(CHERRYAI_PROVIDER.models)
  })

  it('drops the CHERRYAI fallback when v2 already has cherryai models', () => {
    wireV2({
      providers: [makeV2Provider('cherryai')],
      models: [makeV2Model('real-cherryai-model', 'cherryai')]
    })

    render(<PopupContainer resolve={vi.fn()} />)

    const providers = lastProvidersProp()
    const cherryai = providers.filter((p) => p.id === 'cherryai')
    expect(cherryai).toHaveLength(1)
    expect(cherryai[0].models.map((m) => m.id)).toEqual(['real-cherryai-model'])
  })

  it('skips hidden models', () => {
    wireV2({
      providers: [makeV2Provider('ollama')],
      models: [makeV2Model('shown', 'ollama'), makeV2Model('hidden-one', 'ollama', { isHidden: true })]
    })

    render(<PopupContainer resolve={vi.fn()} />)

    const ollama = lastProvidersProp().find((p) => p.id === 'ollama')!
    expect(ollama.models.map((m) => m.id)).toEqual(['shown'])
  })

  it('applies the caller filter against v1-shaped models', () => {
    wireV2({
      providers: [makeV2Provider('ollama')],
      models: [makeV2Model('qwen2.5:7b-instruct', 'ollama'), makeV2Model('text-embedding-3-small', 'ollama')]
    })

    render(<PopupContainer resolve={vi.fn()} filter={(model) => !model.id.startsWith('text-embedding-')} />)

    const ollama = lastProvidersProp().find((p) => p.id === 'ollama')!
    expect(ollama.models.map((m) => m.id)).toEqual(['qwen2.5:7b-instruct'])
  })

  it('omits providers whose models are entirely filtered out, but still emits CHERRYAI fallback if its models survive', () => {
    wireV2({
      providers: [makeV2Provider('ollama'), makeV2Provider('openai')],
      models: [makeV2Model('text-embedding-3-small', 'openai')]
    })

    render(<PopupContainer resolve={vi.fn()} filter={(model) => !model.id.startsWith('text-embedding-')} />)

    const providers = lastProvidersProp()
    expect(providers.map((p) => p.id).sort()).toEqual(['cherryai'])
  })
})
