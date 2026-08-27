import {
  ConversationInboxMutationKind,
  ConversationInputTarget,
  ConversationKind,
  type ConversationRef,
  toConversationInputId
} from '@shared/ai/conversation'
import type {
  ComposerQueuedMessagePayload,
  ConversationInboxMutation,
  ConversationInboxSnapshot
} from '@shared/ai/transport'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ComposerSerializedDraft } from '../tokens'

const request = vi.fn()
let inboxRevision = 0

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCacheValue: () => ({ inboxRevision })
}))

const { useFollowupQueue } = await import('../useFollowupQueue')

const conversation = (id = 's1'): ConversationRef => ({ kind: ConversationKind.Agent, id })
const draft = (text: string): ComposerSerializedDraft => ({ text, tokens: [] })
const payload = (text: string): ComposerQueuedMessagePayload => ({
  text,
  userMessageParts: [{ type: 'text', text }]
})
const snapshot = (texts: string[], paused = false): ConversationInboxSnapshot => ({
  revision: inboxRevision,
  paused,
  items: texts.map((text, index) => ({
    id: toConversationInputId(`input-${index}`),
    presentation: { draft: draft(text), payload: payload(text) }
  }))
})

describe('useFollowupQueue', () => {
  beforeEach(() => {
    request.mockReset()
    inboxRevision = 0
    request.mockResolvedValue(snapshot([]))
  })

  it('loads the Actor-owned queue and reloads it when Main publishes a new revision', async () => {
    request.mockResolvedValueOnce(snapshot(['a'])).mockResolvedValueOnce(snapshot(['a', 'b']))
    const { result, rerender } = renderHook(() =>
      useFollowupQueue({ conversation: conversation(), onEnqueue: vi.fn() })
    )

    await waitFor(() => expect(result.current.items.map(({ draft }) => draft.text)).toEqual(['a']))
    inboxRevision = 1
    rerender()
    await waitFor(() => expect(result.current.items.map(({ draft }) => draft.text)).toEqual(['a', 'b']))
  })

  it('submits a canonical input before showing the refreshed Actor snapshot', async () => {
    const onEnqueue = vi.fn().mockResolvedValue(true)
    request.mockResolvedValue(snapshot(['queued']))
    const { result } = renderHook(() => useFollowupQueue({ conversation: conversation(), onEnqueue }))
    await waitFor(() => expect(request).toHaveBeenCalled())

    await act(async () => {
      await expect(result.current.enqueue(draft('queued'), payload('queued'))).resolves.toBe(true)
    })

    expect(onEnqueue).toHaveBeenCalledWith(draft('queued'), payload('queued'))
    expect(result.current.items.map(({ draft }) => draft.text)).toEqual(['queued'])
  })

  it('routes remove, retarget, reorder, and pause mutations to the Conversation owner', async () => {
    request.mockImplementation(async (route: string, input?: { mutation: ConversationInboxMutation }) => {
      if (route === 'ai.conversation.inbox.get') return snapshot(['a', 'b'])
      if (input?.mutation.kind === ConversationInboxMutationKind.SetPaused) return snapshot(['b', 'a'], true)
      return snapshot(['b', 'a'])
    })
    const { result } = renderHook(() => useFollowupQueue({ conversation: conversation(), onEnqueue: vi.fn() }))
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    const [first, second] = result.current.items

    act(() => result.current.reorder([second, first]))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('ai.conversation.inbox.mutate', {
        conversation: conversation(),
        mutation: {
          kind: ConversationInboxMutationKind.Reorder,
          inputIds: [second.id, first.id]
        }
      })
    )

    act(() => result.current.removeId(first.id))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('ai.conversation.inbox.mutate', {
        conversation: conversation(),
        mutation: { kind: ConversationInboxMutationKind.Remove, inputId: first.id }
      })
    )

    await act(async () => result.current.retarget(second.id))
    expect(request).toHaveBeenCalledWith('ai.conversation.inbox.mutate', {
      conversation: conversation(),
      mutation: {
        kind: ConversationInboxMutationKind.Retarget,
        inputId: second.id,
        target: ConversationInputTarget.NextStep
      }
    })

    act(() => result.current.setPaused(true))
    await waitFor(() => expect(result.current.paused).toBe(true))
  })

  it('ignores an old Conversation snapshot after the composer switches scope', async () => {
    let resolveOld!: (value: ConversationInboxSnapshot) => void
    request
      .mockReturnValueOnce(new Promise<ConversationInboxSnapshot>((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce(snapshot(['new']))
    const { result, rerender } = renderHook(({ ref }) => useFollowupQueue({ conversation: ref, onEnqueue: vi.fn() }), {
      initialProps: { ref: conversation('old') }
    })

    rerender({ ref: conversation('new') })
    await waitFor(() => expect(result.current.items.map(({ draft }) => draft.text)).toEqual(['new']))
    await act(async () => resolveOld(snapshot(['old'])))
    expect(result.current.items.map(({ draft }) => draft.text)).toEqual(['new'])
  })
})
