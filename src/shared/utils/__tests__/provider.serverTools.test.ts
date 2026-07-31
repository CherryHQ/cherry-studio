import { type Model, MODEL_CAPABILITY, SERVER_TOOL } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isBuiltinWebSearchAvailable, isServerToolModelEligible } from '@shared/utils/provider'
import { describe, expect, it } from 'vitest'

const model = (apiModelId: string, overrides: Partial<Model> = {}): Model => ({
  id: `provider::${apiModelId}`,
  providerId: 'provider',
  apiModelId,
  name: apiModelId,
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  ...overrides
})

const provider = (modelScope: 'all-chat-models' | 'model-dependent'): Provider =>
  ({ serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope }] }) as Provider

describe('server-tool model eligibility', () => {
  it('uses generated registry eligibility without a generic model capability', () => {
    const claude = model('claude-sonnet-4-6')

    expect(claude.capabilities).not.toContain('web-search')
    expect(isServerToolModelEligible(claude, SERVER_TOOL.WEB_SEARCH)).toBe(true)
    expect(isBuiltinWebSearchAvailable(claude, provider('model-dependent'))).toBe(true)
  })

  it('keeps unknown custom models ineligible for model-dependent tools', () => {
    const custom = model('private-model')

    expect(isBuiltinWebSearchAvailable(custom, provider('model-dependent'))).toBe(false)
    expect(isBuiltinWebSearchAvailable(custom, { serverTools: [] } as unknown as Provider)).toBe(false)
  })

  it('rejects non-chat models even when their ids are otherwise eligible', () => {
    const embedding = model('claude-sonnet-4-6', {
      capabilities: [MODEL_CAPABILITY.EMBEDDING]
    })

    expect(isServerToolModelEligible(embedding, SERVER_TOOL.WEB_SEARCH)).toBe(false)
  })

  it('keeps provider-wide tools independent from model-dependent eligibility', () => {
    expect(isBuiltinWebSearchAvailable(model('private-model'), provider('all-chat-models'))).toBe(true)
  })
})
