import { describe, expect, it } from 'vitest'

import { resolveDmxapiChatFamily, resolveDmxapiEndpointType } from '@shared/data/presets/gatewayChatRouting'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

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

describe('resolveDmxapiEndpointType', () => {
  it.each([
    ['claude-opus-4-6', ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
    ['gemini-2.5-pro', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT],
    ['gpt-5', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
    ['qwen3.5-plus', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
  ] as const)('defaults %s to %s', (modelId, endpointType) => {
    expect(resolveDmxapiEndpointType(modelId)).toBe(endpointType)
  })
})
