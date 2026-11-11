import { describe, expect, it } from 'vitest'

import { FILE_TYPE } from '@renderer/types/file'
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
  it('retains pending attachments and knowledge by request identity and discards a completed draft', () => {
    const state = new SideChatState()
    const source = { topicId: 'source', messageId: 'answer', selection: 'quote' }
    const newer = { ...source }
    const initial = () => ({ key: 'draft', text: '', tokens: [], files: [], knowledgeBaseIds: [], busy: false })
    state.initializePendingDraft(source, initial)
    state.initializePendingDraft(newer, initial)
    const blob = new Blob(['image'], { type: 'image/png' })
    const draft = {
      text: 'question',
      tokens: [],
      knowledgeBaseIds: ['knowledge'],
      files: [
        {
          fileTokenSourceId: 'image',
          blob,
          name: 'image.png',
          origin_name: 'image.png',
          ext: '.png',
          size: blob.size,
          type: FILE_TYPE.IMAGE
        }
      ]
    }
    state.setComposerDraft(source, draft)
    state.updatePendingDraft(source, { topicId: 'created', busy: true })
    state.initializePendingDraft(source, initial)
    expect(state.getComposerDraft(source)).toMatchObject({ ...draft, topicId: 'created', busy: true })
    expect(state.getComposerDraft(source)?.files[0].blob).toBe(blob)
    expect(state.getComposerDraft(newer)?.text).toBe('')
    state.clearPendingDraft(source)
    state.updatePendingDraft(source, { busy: false })
    expect(state.getComposerDraft(source)).toBeUndefined()
    expect(state.getComposerDraft(newer)).toEqual(initial())
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
