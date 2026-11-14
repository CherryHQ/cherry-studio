import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import {
  applyChatPromptCacheIdentity,
  deriveChatPromptCacheKey,
  resolveClearAwareConversationId
} from '../chatPromptCacheKey'

describe('resolveClearAwareConversationId', () => {
  it('uses the topic id before any clear-context boundary', () => {
    expect(resolveClearAwareConversationId('topic-1', null)).toBe('topic-1')
    expect(resolveClearAwareConversationId('topic-1', undefined)).toBe('topic-1')
  })

  it('rotates when the latest clear-context boundary changes', () => {
    const afterFirst = resolveClearAwareConversationId('topic-1', 'clear-1')
    const afterSecond = resolveClearAwareConversationId('topic-1', 'clear-2')
    expect(afterFirst).toBe('topic-1:clear-1')
    expect(afterSecond).toBe('topic-1:clear-2')
    expect(afterFirst).not.toBe(afterSecond)
  })
})

describe('applyChatPromptCacheIdentity', () => {
  // Catches clear-context leaving the provider matching a pre-clear cache entry:
  // the OpenAI-family identity must change when conversation.id rotates.
  it('sets a stable Responses promptCacheKey derived from conversation.id', () => {
    const provider = makeProvider({
      id: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'openai', baseUrl: 'https://api.openai.com' }
      }
    })
    const model = makeModel({
      id: 'openai::gpt-5',
      providerId: 'openai',
      apiModelId: 'gpt-5',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
    })

    const first = applyChatPromptCacheIdentity(provider, model, {}, 'topic-1:clear-1')
    const repeated = applyChatPromptCacheIdentity(provider, model, {}, 'topic-1:clear-1')
    const afterClear = applyChatPromptCacheIdentity(provider, model, {}, 'topic-1:clear-2')

    const key = first.openai?.promptCacheKey
    expect(key).toBe(deriveChatPromptCacheKey('topic-1:clear-1'))
    expect(key).toMatch(/^cherry-chat:[0-9a-f]{32}$/)
    expect(key).not.toContain('topic-1')
    expect(repeated.openai?.promptCacheKey).toBe(key)
    expect(afterClear.openai?.promptCacheKey).not.toBe(key)
  })

  it('sets openai-compatible Chat Completions user from conversation.id', () => {
    const provider = makeProvider({
      id: 'my-relay',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          adapterFamily: 'openai-compatible',
          baseUrl: 'https://relay.example/v1'
        }
      }
    })
    const model = makeModel({
      id: 'my-relay::claude-sonnet-5',
      providerId: 'my-relay',
      apiModelId: 'claude-sonnet-5',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    const beforeClear = applyChatPromptCacheIdentity(provider, model, {}, 'topic-1')
    const afterClear = applyChatPromptCacheIdentity(provider, model, {}, 'topic-1:clear-1')

    expect(beforeClear['my-relay']?.user).toBe(deriveChatPromptCacheKey('topic-1'))
    expect(afterClear['my-relay']?.user).toBe(deriveChatPromptCacheKey('topic-1:clear-1'))
    expect(afterClear['my-relay']?.user).not.toBe(beforeClear['my-relay']?.user)
  })

  it('never overrides an explicit promptCacheKey or user', () => {
    const responsesProvider = makeProvider({
      id: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'openai', baseUrl: 'https://api.openai.com' }
      }
    })
    const responsesModel = makeModel({
      id: 'openai::gpt-5',
      providerId: 'openai',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
    })
    expect(
      applyChatPromptCacheIdentity(responsesProvider, responsesModel, { openai: { promptCacheKey: 'own' } }, 'topic-1')
        .openai?.promptCacheKey
    ).toBe('own')

    const chatProvider = makeProvider({
      id: 'my-relay',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          adapterFamily: 'openai-compatible',
          baseUrl: 'https://relay.example/v1'
        }
      }
    })
    const chatModel = makeModel({
      id: 'my-relay::claude',
      providerId: 'my-relay',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
    expect(
      applyChatPromptCacheIdentity(chatProvider, chatModel, { 'my-relay': { user: 'own' } }, 'topic-1')['my-relay']
        ?.user
    ).toBe('own')
  })

  it('does not invent an identity for Anthropic Messages endpoints', () => {
    const provider = makeProvider({
      id: 'anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' }
      }
    })
    const model = makeModel({
      id: 'anthropic::claude',
      providerId: 'anthropic',
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })
    const options = { anthropic: { thinking: { type: 'disabled' } } }
    expect(applyChatPromptCacheIdentity(provider, model, options, 'topic-1:clear-1')).toBe(options)
  })
})
