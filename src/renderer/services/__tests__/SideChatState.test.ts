import { describe, expect, it } from 'vitest'

import type { SideChatView } from '@shared/ipc/schemas/sideChat'

import { SideChatState } from '../SideChatState'

const view = (topicId: string, revision: number, questionCount = 0): SideChatView => ({
  topicId,
  sourceTopicId: 'source',
  revision,
  questionCount,
  mode: 'temporary',
  messages: [],
  generating: false,
  omittedContext: [],
  metadata: {
    config: { modelId: 'provider::model', prompt: 'Explain' },
    snapshot: { messageId: 'answer', selection: 'quote', answer: 'quote', question: 'why', prefix: '', suffix: '' }
  }
})
describe('window side-chat state', () => {
  it('keeps the newest count across late RPC results and never resurrects cleared content', () => {
    const state = new SideChatState()
    state.apply('a', 2, view('a', 2, 2))
    state.apply('a', 1, view('a', 1, 1))
    expect(state.getSnapshot()[0].questionCount).toBe(2)
    state.setDraft('a', 'private draft')
    state.apply('a', 3, null)
    state.apply('a', 2, view('a', 2, 2))
    expect(state.getSnapshot()).toEqual([])
    expect(state.getDraft('a')).toBe('')
  })
  it('retains each draft across pane switches and does not erase typing during submit', () => {
    const state = new SideChatState()
    state.setDraft('a', 'sent')
    state.setDraft('b', 'other')
    state.setDraft('a', 'new typing')
    state.clearSubmittedDraft('a', 'sent')
    expect(state.getDraft('a')).toBe('new typing')
    state.clearSubmittedDraft('a', 'new typing')
    expect(state.getDraft('a')).toBe('')
    expect(state.getDraft('b')).toBe('other')
  })
})
