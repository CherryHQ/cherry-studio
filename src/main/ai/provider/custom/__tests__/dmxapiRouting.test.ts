import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { resolveDmxapiChatFamily, resolveDmxapiChatRoute } from '../dmxapi/dmxapiRouting'

describe('resolveDmxapiChatFamily', () => {
  it.each([
    ['claude-opus-4-6', 'anthropic'],
    ['gemini-2.5-pro', 'gemini'],
    ['gemini-2.5-flash-image-preview', 'openai-compat'],
    ['gpt-5', 'openai'],
    ['o3', 'openai'],
    ['qwen3.5-plus', 'openai-compat']
  ] as const)('routes %s → %s', (modelId, family) => {
    expect(resolveDmxapiChatFamily(modelId)).toBe(family)
  })
})

describe('resolveDmxapiChatRoute', () => {
  it.each([
    ['claude-opus-4-6', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic'],
    ['gemini-2.5-pro', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'google'],
    // Both use chat-completions, but the concrete SDK models read different option namespaces.
    ['gpt-5', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai'],
    ['qwen3.5-plus', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'dmxapi']
  ] as const)('maps %s → %s / %s', (modelId, endpointType, providerOptionsKey) => {
    expect(resolveDmxapiChatRoute(modelId)).toEqual({ endpointType, providerOptionsKey })
  })
})
