import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearAllMessageEditSessions,
  clearMessageEditSession,
  MessageEditingProvider,
  readMessageEditSession,
  useMessageEditing,
  writeMessageEditSessionDraft
} from '../MessageEditingContext'

const createMessage = (id: string, topicId: string) =>
  ({
    id,
    role: 'user',
    topicId,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'success'
  }) as any

function ContextProbe({ onValue }: { onValue: (value: ReturnType<typeof useMessageEditing>) => void }) {
  const ctx = useMessageEditing()
  onValue(ctx)
  return null
}

describe('MessageEditingContext', () => {
  beforeEach(() => {
    clearAllMessageEditSessions()
  })

  it('persists and restores active edit sessions per topic across provider remounts', () => {
    let ctx!: ReturnType<typeof useMessageEditing>

    const topic1View = render(
      <MessageEditingProvider topicId="topic-1">
        <ContextProbe onValue={(value) => (ctx = value)} />
      </MessageEditingProvider>
    )

    act(() => {
      ctx.startEditing(createMessage('msg-1', 'topic-1'), [{ type: 'text', text: 'Hello' }] as any)
    })

    const sessionId = ctx.editingMessage!.editingSessionId
    writeMessageEditSessionDraft('topic-1', sessionId, {
      draft: {
        text: 'Unsent edit draft 123',
        draftTokens: [],
        files: [],
        knowledgeBaseIds: [],
        reasoningDraft: '',
        originalFilePartsByTokenId: new Map()
      },
      savedDraftBeforeEditing: null
    })

    topic1View.unmount()

    // Switching to another topic starts clean.
    const topic2View = render(
      <MessageEditingProvider topicId="topic-2">
        <ContextProbe onValue={(value) => (ctx = value)} />
      </MessageEditingProvider>
    )
    expect(ctx.editingMessage).toBeNull()
    expect(ctx.editingMessageId).toBeNull()

    // Topic 2 can hold its own independent edit session.
    act(() => {
      ctx.startEditing(createMessage('msg-2', 'topic-2'), [{ type: 'text', text: 'Topic 2' }] as any)
    })
    expect(ctx.editingMessageId).toBe('msg-2')
    topic2View.unmount()

    // Returning to topic 1 restores its snapshot and unsent draft.
    const returnedView = render(
      <MessageEditingProvider topicId="topic-1">
        <ContextProbe onValue={(value) => (ctx = value)} />
      </MessageEditingProvider>
    )
    expect(ctx.editingMessageId).toBe('msg-1')
    expect(ctx.editingMessage?.editingSessionId).toBe(sessionId)
    expect(readMessageEditSession('topic-1')?.draft?.text).toBe('Unsent edit draft 123')

    // Explicit cancel clears only topic 1, leaving topic 2 intact.
    act(() => {
      ctx.cancelEditing()
    })
    expect(ctx.editingMessage).toBeNull()
    expect(readMessageEditSession('topic-1')).toBeUndefined()
    expect(readMessageEditSession('topic-2')?.snapshot.message.id).toBe('msg-2')

    returnedView.unmount()
  })

  it('switches active topic via syncTopic without discarding the previous topic session', async () => {
    let ctx!: ReturnType<typeof useMessageEditing>

    render(
      <MessageEditingProvider>
        <ContextProbe onValue={(value) => (ctx = value)} />
      </MessageEditingProvider>
    )

    act(() => {
      ctx.startEditing(createMessage('msg-1', 'topic-1'), [{ type: 'text', text: 'Hello' }] as any)
    })
    expect(ctx.editingMessageId).toBe('msg-1')

    act(() => {
      ctx.syncTopic('topic-2')
    })
    await waitFor(() => expect(ctx.editingMessage).toBeNull())
    expect(readMessageEditSession('topic-1')?.snapshot.message.id).toBe('msg-1')

    act(() => {
      ctx.syncTopic('topic-1')
    })
    await waitFor(() => expect(ctx.editingMessageId).toBe('msg-1'))
  })

  it('guards draft writes and clears against stale editingSessionId values', () => {
    let ctx!: ReturnType<typeof useMessageEditing>

    render(
      <MessageEditingProvider topicId="topic-1">
        <ContextProbe onValue={(value) => (ctx = value)} />
      </MessageEditingProvider>
    )

    act(() => {
      ctx.startEditing(createMessage('msg-1', 'topic-1'), [{ type: 'text', text: 'First' }] as any)
    })
    const firstSessionId = ctx.editingMessage!.editingSessionId

    act(() => {
      ctx.startEditing(createMessage('msg-2', 'topic-1'), [{ type: 'text', text: 'Second' }] as any)
    })
    const secondSessionId = ctx.editingMessage!.editingSessionId

    // Stale draft write for firstSessionId must be ignored.
    writeMessageEditSessionDraft('topic-1', firstSessionId, {
      draft: {
        text: 'stale draft',
        draftTokens: [],
        files: [],
        knowledgeBaseIds: [],
        reasoningDraft: '',
        originalFilePartsByTokenId: new Map()
      },
      savedDraftBeforeEditing: null
    })
    expect(readMessageEditSession('topic-1')?.draft).toBeUndefined()

    // Stale clear for firstSessionId must not clear secondSessionId.
    clearMessageEditSession('topic-1', firstSessionId)
    expect(readMessageEditSession('topic-1')?.snapshot.editingSessionId).toBe(secondSessionId)

    // Matching clear removes the session.
    clearMessageEditSession('topic-1', secondSessionId)
    expect(readMessageEditSession('topic-1')).toBeUndefined()
  })
})
