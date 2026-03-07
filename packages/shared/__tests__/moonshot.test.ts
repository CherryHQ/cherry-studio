import { describe, expect, it } from 'vitest'

import {
  isMoonshotBuiltinWebSearchTool,
  isMoonshotProviderLike,
  MOONSHOT_DEFAULT_BASE_URL,
  MOONSHOT_PROVIDER_ID,
  MOONSHOT_WEB_SEARCH_TOOL_DEFINITION,
  MOONSHOT_WEB_SEARCH_TOOL_NAME,
  normalizeMoonshotBuiltinToolMessages
} from '../utils'

describe('moonshot utils', () => {
  describe('isMoonshotProviderLike', () => {
    it('matches provider by id', () => {
      expect(isMoonshotProviderLike({ id: MOONSHOT_PROVIDER_ID })).toBe(true)
    })

    it('matches provider by moonshot host', () => {
      expect(isMoonshotProviderLike({ apiHost: MOONSHOT_DEFAULT_BASE_URL })).toBe(true)
      expect(isMoonshotProviderLike({ apiHost: 'https://api.moonshot.cn/v1' })).toBe(true)
      expect(isMoonshotProviderLike({ apiHost: 'https://gateway.moonshot.cn/v1' })).toBe(true)
    })

    it('returns false for non-moonshot providers', () => {
      expect(isMoonshotProviderLike({ id: 'openai', apiHost: 'https://api.openai.com/v1' })).toBe(false)
      expect(isMoonshotProviderLike({})).toBe(false)
    })
  })

  describe('normalizeMoonshotBuiltinToolMessages', () => {
    it('returns empty result for non-array input', () => {
      const normalized = normalizeMoonshotBuiltinToolMessages(undefined)
      expect(normalized).toEqual({
        messages: [],
        hasChanges: false
      })
    })

    it('normalizes web search tool-call type and backfills tool name', () => {
      const messages = [
        { role: 'user', content: 'search' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 't-web-search-1',
              type: 'function',
              function: {
                name: MOONSHOT_WEB_SEARCH_TOOL_NAME,
                arguments: '{"search_result":{"search_id":"search_123"}}'
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 't-web-search-1',
          content: '{"search_result":{"search_id":"search_123"}}'
        }
      ]

      const normalized = normalizeMoonshotBuiltinToolMessages(messages)
      expect(normalized.hasChanges).toBe(true)

      const assistantMessage = normalized.messages.find(
        (message) =>
          typeof message === 'object' && message !== null && (message as { role?: string }).role === 'assistant'
      ) as { tool_calls?: Array<{ type?: string; function?: { name?: string } }> }
      expect(assistantMessage.tool_calls?.[0]).toMatchObject({
        type: 'builtin_function',
        function: { name: MOONSHOT_WEB_SEARCH_TOOL_NAME }
      })

      const toolMessage = normalized.messages.find(
        (message) => typeof message === 'object' && message !== null && (message as { role?: string }).role === 'tool'
      ) as { name?: string; tool_call_id?: string }
      expect(toolMessage).toMatchObject({
        tool_call_id: 't-web-search-1',
        name: MOONSHOT_WEB_SEARCH_TOOL_NAME
      })
    })

    it('does not rewrite unrelated tool-calls', () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 't-other-1',
              type: 'function',
              function: {
                name: 'other_tool',
                arguments: '{}'
              }
            }
          ]
        }
      ]

      const normalized = normalizeMoonshotBuiltinToolMessages(messages)
      expect(normalized.hasChanges).toBe(false)
      expect(normalized.messages).toEqual(messages)
    })
  })

  describe('isMoonshotBuiltinWebSearchTool', () => {
    it('returns true for builtin web search tool definition', () => {
      expect(isMoonshotBuiltinWebSearchTool(MOONSHOT_WEB_SEARCH_TOOL_DEFINITION)).toBe(true)
    })

    it('returns false for non-matching tool shape', () => {
      expect(
        isMoonshotBuiltinWebSearchTool({
          type: 'function',
          function: { name: MOONSHOT_WEB_SEARCH_TOOL_NAME }
        })
      ).toBe(false)
      expect(isMoonshotBuiltinWebSearchTool(undefined)).toBe(false)
    })
  })
})
