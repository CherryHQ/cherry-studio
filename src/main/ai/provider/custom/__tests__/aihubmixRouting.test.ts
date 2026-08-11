import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { resolveAihubmixChatFamily, resolveAihubmixEndpointType } from '../aihubmix/aihubmixRouting'

// The family here must stay in lock-step with `createChatModel`'s dispatch in aihubmixProvider.ts —
// both derive from `resolveAihubmixChatFamily`, so this table also guards that dispatch.
describe('resolveAihubmixChatFamily', () => {
  it.each([
    ['claude-opus-4-6', 'anthropic'],
    ['claude-3-5-haiku', 'anthropic'],
    ['gemini-2.5-pro', 'gemini'],
    ['imagen-4.0-generate-001', 'gemini'],
    // gpt/o LLMs go to the Responses API…
    ['gpt-4o', 'openai-responses'],
    ['o3', 'openai-responses'],
    // …except the chat-completion-only exceptions
    ['gpt-4o-search-preview', 'openai-chat'],
    ['o1-mini', 'openai-chat'],
    ['o1-preview', 'openai-chat'],
    // everything else is the openai-compatible fallback
    ['glm-5', 'compat'],
    ['deepseek-v4', 'compat'],
    ['qwen3.5-plus', 'compat'],
    ['gpt-4o-image', 'compat'] // excluded from the OpenAI LLM path
  ] as const)('routes %s → %s', (modelId, family) => {
    expect(resolveAihubmixChatFamily(modelId)).toBe(family)
  })
})

describe('resolveAihubmixEndpointType', () => {
  it.each([
    ['claude-opus-4-6', ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
    ['gemini-2.5-pro', ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT],
    ['gpt-4o', ENDPOINT_TYPE.OPENAI_RESPONSES],
    ['o1-mini', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
    ['glm-5', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
  ] as const)('maps %s → %s', (modelId, endpointType) => {
    expect(resolveAihubmixEndpointType(modelId)).toBe(endpointType)
  })
})
