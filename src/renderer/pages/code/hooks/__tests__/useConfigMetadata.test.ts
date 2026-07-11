import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_ID, CodeCli } from '@shared/types/codeCli'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useConfigMetadata } from '../useConfigMetadata'

// The hook only needs these for `resolveProviderMeta`; `filterProviders` is pure over the args.
vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [] })
}))
vi.mock('@renderer/hooks/useProvider', () => ({
  getProviderDisplayName: (p: Provider) => p.name
}))
vi.mock('@renderer/pages/code/cliConfig', () => ({
  hasClaudeDetailedModels: (config: Record<string, unknown>) =>
    Boolean((config.env as Record<string, string> | undefined)?.ANTHROPIC_DEFAULT_FABLE_MODEL),
  getClaudeContextModelId: (providerId: string, config: Record<string, unknown>) => {
    const model = (config.env as Record<string, string> | undefined)?.ANTHROPIC_DEFAULT_FABLE_MODEL
    return model ? `${providerId}::${model}` : undefined
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

describe('useConfigMetadata.filterProviders', () => {
  it('drops login-based (OAuth/external-cli) providers while keeping api-key providers', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE))

    const filtered = result.current.filterProviders([oauthProvider, apiKeyProvider])

    expect(filtered).toEqual([apiKeyProvider])
  })
})

describe('useConfigMetadata.makeModelFilter (gateway)', () => {
  const model = (providerId: string, modelId: string, capabilities: string[] = []): Model =>
    ({ id: `${providerId}::${modelId}`, providerId, capabilities }) as unknown as Model

  it('keeps a chat model of ANY enabled provider regardless of the CLI tool (cross-protocol routing)', () => {
    // Claude Code tool, but a non-Anthropic (OpenAI-style) model must still pass:
    // the gateway does dialect conversion, so the per-tool/provider scope is dropped.
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE))
    const filter = result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)

    expect(filter(model('deepseek', 'deepseek-chat'))).toBe(true)
    expect(filter(model('openai', 'gpt-4o'))).toBe(true)
  })

  it('excludes embedding / rerank / image-generation models (the gateway cannot chat-route them)', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE))
    const filter = result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)

    expect(filter(model('openai', 'text-embedding-3', [MODEL_CAPABILITY.EMBEDDING]))).toBe(false)
    expect(filter(model('jina', 'reranker', [MODEL_CAPABILITY.RERANK]))).toBe(false)
    expect(filter(model('openai', 'dall-e-3', [MODEL_CAPABILITY.IMAGE_GENERATION]))).toBe(false)
  })

  it('excludes the CherryAI managed default model (not routable through the gateway)', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE))
    const filter = result.current.makeModelFilter(CLI_API_GATEWAY_PROVIDER_ID)

    expect(filter(model(CHERRYAI_PROVIDER_ID, CHERRYAI_DEFAULT_MODEL_ID))).toBe(false)
    // A non-default CherryAI model is still routable.
    expect(filter(model(CHERRYAI_PROVIDER_ID, 'some-other-model'))).toBe(true)
  })
})

describe('useConfigMetadata.resolveProviderMeta', () => {
  it('surfaces the primary detailed Claude model as the model name', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE))

    const meta = result.current.resolveProviderMeta(apiKeyProvider, {
      modelId: null,
      config: { env: { ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5' } }
    })

    expect(meta.modelName).toBe('claude-fable-5')
  })

  it('resolves the plain configured model for non-detailed configs', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE))

    const meta = result.current.resolveProviderMeta(apiKeyProvider, { modelId: 'anthropic::claude-old' })

    expect(meta.modelName).toBe('claude-old')
  })
})
