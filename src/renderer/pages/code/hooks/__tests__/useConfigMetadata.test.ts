import type { Provider } from '@shared/data/types/provider'
import { CodeCli } from '@shared/types/codeCli'
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

describe('useConfigMetadata.resolveProviderMeta', () => {
  it('surfaces the primary detailed Claude model as the model name', () => {
    const { result } = renderHook(() => useConfigMetadata(CodeCli.CLAUDE_CODE))

    const meta = result.current.resolveProviderMeta(apiKeyProvider, {
      modelId: '',
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
