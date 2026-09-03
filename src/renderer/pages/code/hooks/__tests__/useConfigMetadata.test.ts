import {
  CHERRY_CLOUD_PROVIDER_ID,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_PROVIDER_ID
} from '@shared/data/presets/cherryai'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConfigMetadata } from '../useConfigMetadata'

const modelRecords = vi.hoisted(() => [] as Model[])

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: modelRecords })
}))
vi.mock('@renderer/hooks/useProvider', () => ({
  getProviderDisplayName: (p: Provider) => p.name
}))
vi.mock('@renderer/pages/code/cliConfig', () => ({
  hasClaudeDetailedModels: (config: Record<string, unknown>) =>
    Boolean((config.env as Record<string, string> | undefined)?.ANTHROPIC_DEFAULT_FABLE_MODEL),
  getClaudeContextModelId: (
    providerId: string,
    config: Record<string, unknown>,
    gatewayModels?: Map<string, Model>
  ) => {
    const model = (config.env as Record<string, string> | undefined)?.ANTHROPIC_DEFAULT_FABLE_MODEL
    if (!model) return undefined
    if (!gatewayModels) return `${providerId}::${model}`
    return [...gatewayModels.values()].find((entry) => `${entry.providerId}:${entry.apiModelId}` === model)?.id
  }
}))

const anthropicEndpoint = { endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } } }

const apiKeyProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  isEnabled: true,
  authMethods: ['api-key'],
  ...anthropicEndpoint
} as unknown as Provider

// Login-based provider that still passes the endpoint-capability filter for Claude Code.
const oauthProvider = {
  id: 'claude-code',
  name: 'Claude Code',
  isEnabled: true,
  authMethods: ['external-cli'],
  ...anthropicEndpoint
} as unknown as Provider

const disabledProvider = {
  id: 'disabled',
  name: 'Disabled',
  isEnabled: false,
  authMethods: ['api-key']
} as unknown as Provider

const makeModel = (
  providerId: string,
  modelId: string,
  capabilities: string[] = [MODEL_CAPABILITY.TEXT_GENERATION]
): Model => ({ id: `${providerId}::${modelId}`, providerId, capabilities }) as unknown as Model

const enabledProvider = (id: string) =>
  ({ id, name: id, isEnabled: true, authMethods: ['api-key'] }) as unknown as Provider

beforeEach(() => {
  modelRecords.length = 0
  MockUsePreferenceUtils.resetMocks()
})

describe('useConfigMetadata.gatewayModelsById', () => {
  it('includes only models the running gateway can resolve', () => {
    const routableModel = makeModel('anthropic', 'claude-chat')
    const nonChatModel = makeModel('anthropic', 'embed', [MODEL_CAPABILITY.EMBEDDING])
    const disabledProviderModel = makeModel('disabled', 'chat')
    const externalProviderModel = makeModel('claude-code', 'chat')
    modelRecords.push(routableModel, nonChatModel, disabledProviderModel, externalProviderModel)

    const { result } = renderHook(() =>
      useConfigMetadata(CodeCli.CLAUDE_CODE, [apiKeyProvider, disabledProvider, oauthProvider])
    )

    expect([...result.current.gatewayModelsById.keys()]).toEqual([routableModel.id])
  })

  it('uses the global default model only when the gateway can route it', () => {
    const routableModel = makeModel('anthropic', 'claude-chat')
    modelRecords.push(routableModel)
    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', routableModel.id)

    const { result, rerender } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, [apiKeyProvider]))

    expect(result.current.defaultGatewayModelId).toBe(routableModel.id)

    MockUsePreferenceUtils.setPreferenceValue('chat.default_model_id', 'disabled::chat')
    rerender()

    expect(result.current.defaultGatewayModelId).toBeUndefined()
  })
})

describe('useConfigMetadata.filterProviders', () => {
  it('drops login-based (OAuth/external-cli) providers while keeping api-key providers', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, []))

    const filtered = result.current.filterProviders([oauthProvider, apiKeyProvider])

    expect(filtered).toEqual([apiKeyProvider])
  })

  it('filters providers with the requested CLI tool instead of the active one', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, []))

    expect(result.current.filterProvidersForTool(CodeCli.CLAUDE_CODE, [apiKeyProvider])).toEqual([apiKeyProvider])
    expect(result.current.filterProvidersForTool(CodeCli.OPENAI_CODEX, [apiKeyProvider])).toEqual([])
  })
})

describe('useConfigMetadata.makeModelFilter (gateway)', () => {
  const model = (
    providerId: string,
    modelId: string,
    capabilities: string[] = [MODEL_CAPABILITY.TEXT_GENERATION]
  ): Model => ({ id: `${providerId}::${modelId}`, providerId, capabilities }) as unknown as Model

  it('keeps a chat model of ANY enabled provider regardless of the CLI tool (cross-protocol routing)', () => {
    // Claude Code tool, but a non-Anthropic (OpenAI-style) model must still pass:
    // the gateway does dialect conversion, so the per-tool/provider scope is dropped.
    const { result } = renderHook(() =>
      useConfigMetadata(CodeCli.CLAUDE_CODE, [enabledProvider('deepseek'), enabledProvider('openai')])
    )
    const filter = result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)

    expect(filter(model('deepseek', 'deepseek-chat'))).toBe(true)
    expect(filter(model('openai', 'gpt-4o'))).toBe(true)
  })

  it('excludes embedding / rerank / image-generation models (the gateway cannot chat-route them)', () => {
    const { result } = renderHook(() =>
      useConfigMetadata(CodeCli.CLAUDE_CODE, [enabledProvider('openai'), enabledProvider('jina')])
    )
    const filter = result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)

    expect(filter(model('openai', 'text-embedding-3', [MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
    expect(filter(model('jina', 'reranker', [MODEL_CAPABILITY.RERANK]))).toBe(false)
    expect(filter(model('openai', 'dall-e-3', [MODEL_CAPABILITY.IMAGE_GENERATION]))).toBe(false)
  })

  it('excludes the CherryAI managed default model (not routable through the gateway)', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, [enabledProvider(CHERRYAI_PROVIDER_ID)]))
    const filter = result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)

    expect(filter(model(CHERRYAI_PROVIDER_ID, CHERRYAI_DEFAULT_MODEL_ID))).toBe(false)
    // A non-default CherryAI model is still routable.
    expect(filter(model(CHERRYAI_PROVIDER_ID, 'some-other-model'))).toBe(true)
  })

  it('routes Cherry Cloud models only where the edition allows them outside Agents', () => {
    const cloudProvider = enabledProvider(CHERRY_CLOUD_PROVIDER_ID)
    const cloudModel = model(CHERRY_CLOUD_PROVIDER_ID, 'deepseek-free')

    vi.stubGlobal('__APP_EDITION__', 'cn')
    try {
      const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, [cloudProvider]))
      expect(result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)(cloudModel)).toBe(false)
    } finally {
      vi.stubGlobal('__APP_EDITION__', 'global')
    }

    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, [cloudProvider]))
    expect(result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)(cloudModel)).toBe(true)
  })

  // The picker shares isGatewayRoutableModel with the gateway's /v1/models listing, so every
  // non-chat class is excluded — not just embedding/rerank/text-to-image (audio/video generation
  // and transcription models would reach the chat runtime and fail).
  it('excludes non-chat audio/video generation and transcription models', () => {
    const { result } = renderHook(() =>
      useConfigMetadata(CodeCli.CLAUDE_CODE, [
        enabledProvider('elevenlabs'),
        enabledProvider('openai'),
        enabledProvider('kling')
      ])
    )
    const filter = result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)

    expect(filter(model('elevenlabs', 'eleven-tts', [MODEL_CAPABILITY.AUDIO_GENERATION]))).toBe(false)
    expect(filter(model('openai', 'whisper-1', [MODEL_CAPABILITY.AUDIO_TRANSCRIPT]))).toBe(false)
    expect(filter(model('kling', 'kling-video', [MODEL_CAPABILITY.VIDEO_GENERATION]))).toBe(false)
  })

  it('excludes models of a provider id containing ":" (cannot round-trip the gateway address)', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, [enabledProvider('corp:west')]))
    const filter = result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)

    expect(filter(model('corp:west', 'gpt-4o'))).toBe(false)
  })
})

describe('useConfigMetadata.resolveProviderMeta', () => {
  it('surfaces the primary detailed Claude model as the model name', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, []))

    const meta = result.current.resolveProviderMeta(apiKeyProvider, {
      modelId: null,
      config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5' } }
    })

    expect(meta.modelName).toBe('claude-fable-5')
  })

  it('resolves a detailed gateway address to the model name', () => {
    const model = {
      ...makeModel('anthropic', 'claude-chat'),
      apiModelId: 'claude-chat',
      name: 'Claude Chat'
    } as Model
    modelRecords.push(model)
    const gatewayProvider = { id: CLI_API_GATEWAY_PROVIDER_ID, name: 'Unified Gateway' } as Provider
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, [apiKeyProvider]))

    const meta = result.current.resolveProviderMeta(gatewayProvider, {
      modelId: null,
      config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'anthropic:claude-chat' } }
    })

    expect(meta.modelName).toBe('Claude Chat')
  })

  it('resolves the plain configured model for non-detailed configs', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE, []))

    const meta = result.current.resolveProviderMeta(apiKeyProvider, { modelId: 'anthropic::claude-old' })

    expect(meta.modelName).toBe('claude-old')
  })
})
