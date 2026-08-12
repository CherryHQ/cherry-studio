import { fetchGenerate } from '@renderer/utils/aiGeneration'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type ConversationSuggestionRequestContext,
  generateConversationSuggestions,
  parseConversationSuggestions,
  useConversationSuggestions
} from '../useConversationSuggestions'

vi.mock('@renderer/utils/aiGeneration', () => ({ fetchGenerate: vi.fn() }))

const context: ConversationSuggestionRequestContext = {
  mode: 'agent',
  outputLanguage: 'zh-CN',
  systemLocale: 'en-US',
  localDateTime: 'Tuesday, August 11, 2026 at 3:15 PM',
  timeZone: 'America/Los_Angeles',
  randomSeed: 'seed-1',
  persona: { name: 'Code Reviewer', description: 'Reviews changes carefully' }
}

const fallback: [string, string, string] = ['Fallback one', 'Fallback two', 'Fallback three']

function createWrapper(cache = new Map()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(SWRConfig, { value: { provider: () => cache } }, children)
  }
}

describe('conversation suggestion generation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends only the approved local and persona context through the default-model helper', async () => {
    vi.mocked(fetchGenerate).mockResolvedValue('{"suggestions":["检查改动","制定计划","补充验证"]}')

    await expect(generateConversationSuggestions(context)).resolves.toEqual(['检查改动', '制定计划', '补充验证'])

    expect(fetchGenerate).toHaveBeenCalledWith({
      prompt: expect.stringContaining('For agent mode'),
      content: JSON.stringify(context),
      throwOnError: true
    })
    expect(fetchGenerate).not.toHaveBeenCalledWith(expect.objectContaining({ model: expect.anything() }))
    const content = vi.mocked(fetchGenerate).mock.calls[0][0].content
    expect(content).not.toContain('instructions')
    expect(content).not.toContain('workspace')
  })

  it.each([
    ['wrong count', '{"suggestions":["one","two"]}'],
    ['duplicates', '{"suggestions":["same","same","other"]}'],
    ['blank suggestion', '{"suggestions":["one","  ","three"]}'],
    ['extra field', '{"suggestions":["one","two","three"],"extra":true}'],
    ['markdown wrapper', '```json\n{"suggestions":["one","two","three"]}\n```'],
    ['overlong suggestion', JSON.stringify({ suggestions: ['one', 'two', 'x'.repeat(97)] })]
  ])('rejects %s instead of accepting an unreliable model response', (_case, response) => {
    expect(() => parseConversationSuggestions(response)).toThrow()
  })

  it('reuses suggestions for the same conversation context during the app run', async () => {
    vi.mocked(fetchGenerate).mockResolvedValue('{"suggestions":["One","Two","Three"]}')
    const wrapper = createWrapper()
    const options = {
      mode: 'chat' as const,
      conversationId: 'topic-1',
      outputLanguage: 'en-US',
      fallback
    }

    const first = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(first.result.current.suggestions).toEqual(['One', 'Two', 'Three']))
    first.unmount()

    const second = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(second.result.current.suggestions).toEqual(['One', 'Two', 'Three']))

    expect(fetchGenerate).toHaveBeenCalledTimes(1)
  })

  it('generates again when the conversation, language, or persona changes', async () => {
    vi.mocked(fetchGenerate).mockResolvedValue('{"suggestions":["One","Two","Three"]}')
    const { rerender, result } = renderHook(
      ({ conversationId, outputLanguage, persona }) =>
        useConversationSuggestions({
          mode: 'agent',
          conversationId,
          outputLanguage,
          persona,
          fallback
        }),
      {
        initialProps: {
          conversationId: 'session-1',
          outputLanguage: 'en-US',
          persona: { name: 'Agent One', description: 'First persona' }
        },
        wrapper: createWrapper()
      }
    )

    await waitFor(() => expect(result.current.suggestions).toEqual(['One', 'Two', 'Three']))
    rerender({
      conversationId: 'session-2',
      outputLanguage: 'en-US',
      persona: { name: 'Agent One', description: 'First persona' }
    })
    await waitFor(() => expect(fetchGenerate).toHaveBeenCalledTimes(2))
    rerender({
      conversationId: 'session-2',
      outputLanguage: 'zh-CN',
      persona: { name: 'Agent One', description: 'First persona' }
    })
    await waitFor(() => expect(fetchGenerate).toHaveBeenCalledTimes(3))
    rerender({
      conversationId: 'session-2',
      outputLanguage: 'zh-CN',
      persona: { name: 'Agent Two', description: 'Second persona' }
    })
    await waitFor(() => expect(fetchGenerate).toHaveBeenCalledTimes(4))
  })

  it('shows the local fallback without caching it as generated suggestions', async () => {
    vi.mocked(fetchGenerate)
      .mockRejectedValueOnce(new Error('No default model'))
      .mockResolvedValueOnce('{"suggestions":["Fresh one","Fresh two","Fresh three"]}')
    const cache = new Map()
    const wrapper = createWrapper(cache)
    const options = {
      mode: 'chat' as const,
      conversationId: 'topic-without-model',
      outputLanguage: 'en-US',
      fallback
    }
    const first = renderHook(() => useConversationSuggestions(options), { wrapper })

    await waitFor(() => expect(first.result.current.suggestions).toEqual(fallback))
    first.unmount()

    const second = renderHook(() => useConversationSuggestions(options), { wrapper })
    await waitFor(() => expect(second.result.current.suggestions).toEqual(['Fresh one', 'Fresh two', 'Fresh three']))
    expect(fetchGenerate).toHaveBeenCalledTimes(2)
  })
})
