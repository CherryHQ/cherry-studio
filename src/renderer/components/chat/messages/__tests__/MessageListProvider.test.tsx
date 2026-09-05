import type { CherryMessagePart } from '@shared/data/types/message'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { MessageListProvider, useMessagePriorCitationParts } from '../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListItem, type MessageListProviderValue } from '../types'

const item = (id: string): MessageListItem => ({
  id,
  role: 'assistant',
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success'
})

const searchPart = (toolCallId: string): CherryMessagePart =>
  ({
    type: 'tool-web_search',
    toolCallId,
    state: 'output-available',
    input: { query: 'q' },
    output: [{ id: `${toolCallId}-1`, title: 'First', url: 'https://a.com/x', content: 'alpha' }]
  }) as never

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as never

type ProviderState = Pick<MessageListProviderValue['state'], 'messages' | 'partsByMessageId' | 'streamingLayers'>

const createValue = (state: ProviderState): MessageListProviderValue => ({
  state: {
    topic: { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
    messageNavigation: 'none',
    estimateSize: 400,
    overscan: 0,
    loadOlderDelayMs: 0,
    loadingResetDelayMs: 0,
    renderConfig: defaultMessageRenderConfig,
    ...state
  },
  actions: {},
  meta: { selectionLayer: false }
})

const renderPriorParts = (messageId: string, initialState: ProviderState) => {
  let state = initialState
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MessageListProvider value={createValue(state)}>{children}</MessageListProvider>
  )
  const hook = renderHook(() => useMessagePriorCitationParts(messageId), { wrapper })
  return {
    ...hook,
    update: (nextState: ProviderState) => {
      state = nextState
      hook.rerender()
    }
  }
}

describe('useMessagePriorCitationParts', () => {
  const searched = searchPart('search-1')

  it("exposes earlier messages' citable tool parts in list order and nothing from later ones", () => {
    const messages = [item('m1'), item('m2'), item('m3')]
    const partsByMessageId = {
      m1: [searched, textPart('answer')],
      m2: [textPart('follow-up')],
      m3: [searchPart('search-3')]
    }

    expect(renderPriorParts('m1', { messages, partsByMessageId }).result.current).toEqual([])
    expect(renderPriorParts('m2', { messages, partsByMessageId }).result.current).toEqual([searched])
  })

  it('keeps the same array across streaming chunks that only change text', () => {
    const messages = [item('m1'), item('m2')]
    const hook = renderPriorParts('m2', {
      messages,
      partsByMessageId: { m1: [searched], m2: [textPart('fol')] }
    })
    const first = hook.result.current

    // A chunk hands the provider fresh containers but the same settled tool part.
    hook.update({ messages: [...messages], partsByMessageId: { m1: [searched], m2: [textPart('follow-up')] } })

    expect(hook.result.current).toBe(first)
  })

  it('reads the history layer rather than the live overlay when streaming layers are present', () => {
    const messages = [item('m1'), item('m2')]
    const liveOnly = searchPart('live')
    const hook = renderPriorParts('m2', {
      messages,
      partsByMessageId: { m1: [searched, liveOnly], m2: [] },
      streamingLayers: { historyPartsByMessageId: { m1: [searched], m2: [] }, liveMessageIds: ['m1'] }
    })

    expect(hook.result.current).toEqual([searched])
  })

  it('returns an empty array outside a provider', () => {
    expect(renderHook(() => useMessagePriorCitationParts('m1')).result.current).toEqual([])
  })
})
