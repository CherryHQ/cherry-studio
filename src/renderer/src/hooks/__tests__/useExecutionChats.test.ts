// `topicId` change is not exercised here — the hook does not evict stale
// entries; the caller (V2ChatContent / AgentChat) re-mounts the entire
// subtree via `key={topic.id}`, so this hook starts fresh on topic switch.

import { Chat } from '@ai-sdk/react'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { render, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/transport/IpcChatTransport', async () => {
  const { MockExecutionTransport } = await import('@test-mocks/renderer/IpcChatTransport')
  return { ExecutionTransport: MockExecutionTransport }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })
  }
}))

import ExecutionStreamCollector from '@renderer/pages/home/Messages/ExecutionStreamCollector'
import { transports } from '@test-mocks/renderer/IpcChatTransport'

import { type ExecutionFinishEvent, pickSeed, useExecutionChats } from '../useExecutionChats'

const TOPIC_ID = 'topic-1'
const EXEC_A = 'openai::gpt-4o' as UniqueModelId
const EXEC_B = 'anthropic::claude-3-5-sonnet' as UniqueModelId

function makeUserMessage(id: string, text = 'hi'): CherryUIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', text }]
  } as CherryUIMessage
}

function makeAssistantPlaceholder(id: string, modelId: UniqueModelId): CherryUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [],
    metadata: { modelId } as CherryUIMessage['metadata']
  } as CherryUIMessage
}

beforeEach(() => {
  transports.clear()
})

afterEach(() => {
  transports.clear()
})

// ─────────────────────────────────────────────────────────────────────
// A. pickSeed (pure function)
// ─────────────────────────────────────────────────────────────────────

describe('pickSeed', () => {
  it('A1 — returns the matching assistant when present', () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder('a1', EXEC_A)
    const result = pickSeed([user, a], EXEC_A)
    expect(result).toEqual([a])
  })

  it('A2 — multi-sibling: each executionId picks its own placeholder', () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder('a1', EXEC_A)
    const b = makeAssistantPlaceholder('b1', EXEC_B)
    const messages = [user, a, b]
    expect(pickSeed(messages, EXEC_A)).toEqual([a])
    expect(pickSeed(messages, EXEC_B)).toEqual([b])
  })

  it('A3 — no matching assistant returns undefined', () => {
    const user = makeUserMessage('u1')
    expect(pickSeed([user], EXEC_A)).toBeUndefined()
  })

  it('A4 — empty / undefined input returns undefined', () => {
    expect(pickSeed(undefined, EXEC_A)).toBeUndefined()
    expect(pickSeed([], EXEC_A)).toBeUndefined()
  })

  it('A5 — findLast: with multiple assistants of same model, returns the most recent', () => {
    const user = makeUserMessage('u1')
    const a1 = makeAssistantPlaceholder('a1', EXEC_A)
    const a2 = makeAssistantPlaceholder('a2', EXEC_A)
    const result = pickSeed([user, a1, a2], EXEC_A)
    expect(result).toEqual([a2])
  })
})

// ─────────────────────────────────────────────────────────────────────
// B. useExecutionChats hook lifecycle
// ─────────────────────────────────────────────────────────────────────

describe('useExecutionChats', () => {
  it('B1 — creates one Chat per executionId', async () => {
    const { result } = renderHook(() => useExecutionChats(TOPIC_ID, [EXEC_A, EXEC_B]))
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat)
    expect(result.current.get(EXEC_B)).toBeInstanceOf(Chat)
  })

  it('B2 — same executionId across rerender returns the same Chat reference', async () => {
    const { result, rerender } = renderHook(({ ids }) => useExecutionChats(TOPIC_ID, ids), {
      initialProps: { ids: [EXEC_A] as readonly UniqueModelId[] }
    })
    await waitFor(() => expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat))
    const before = result.current.get(EXEC_A)!
    rerender({ ids: [EXEC_A] })
    await waitFor(() => expect(result.current.get(EXEC_A)).toBe(before))
  })

  it('B3 — adding a new executionId does not recreate existing Chats', async () => {
    const { result, rerender } = renderHook(({ ids }) => useExecutionChats(TOPIC_ID, ids), {
      initialProps: { ids: [EXEC_A] as readonly UniqueModelId[] }
    })
    await waitFor(() => expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat))
    const aBefore = result.current.get(EXEC_A)!
    rerender({ ids: [EXEC_A, EXEC_B] })
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get(EXEC_A)).toBe(aBefore)
    expect(result.current.get(EXEC_B)).toBeInstanceOf(Chat)
    expect(result.current.get(EXEC_B)).not.toBe(aBefore)
  })

  it('B4 — multi-model isolation: each chat seeded with own placeholder, different references', async () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder('a1', EXEC_A)
    const b = makeAssistantPlaceholder('b1', EXEC_B)
    const { result } = renderHook(() =>
      useExecutionChats(TOPIC_ID, [EXEC_A, EXEC_B], { initialMessages: [user, a, b] })
    )
    await waitFor(() => expect(result.current.size).toBe(2))
    const tailA = result.current.get(EXEC_A)!.messages.at(-1)
    const tailB = result.current.get(EXEC_B)!.messages.at(-1)
    expect(tailA?.metadata?.modelId).toBe(EXEC_A)
    expect(tailB?.metadata?.modelId).toBe(EXEC_B)
    expect(tailA).not.toBe(tailB)
  })

  it('B6 — initialMessages is a one-shot seed; rerender does not rebuild existing Chats', async () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder('a1', EXEC_A)
    const { result, rerender } = renderHook(
      ({ msgs }) => useExecutionChats(TOPIC_ID, [EXEC_A], { initialMessages: msgs }),
      { initialProps: { msgs: [user, a] as CherryUIMessage[] } }
    )
    await waitFor(() => expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat))
    const before = result.current.get(EXEC_A)!
    const messagesBefore = before.messages

    const x = makeAssistantPlaceholder('x', EXEC_B)
    rerender({ msgs: [user, a, x] })
    expect(result.current.get(EXEC_A)).toBe(before)
    expect(before.messages).toBe(messagesBefore)
  })
})

// ─────────────────────────────────────────────────────────────────────
// B5. onFinish ref pattern (end-to-end via collector mount)
// ─────────────────────────────────────────────────────────────────────

describe('useExecutionChats onFinish ref pattern', () => {
  it('B5 — rerender swaps onFinish without recreating chat; latest callback fires on stream finish', async () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder('a1', EXEC_A)
    const spy1 = vi.fn()
    const spy2 = vi.fn()

    const { result, rerender } = renderHook(
      ({ onFinish }) => useExecutionChats(TOPIC_ID, [EXEC_A], { initialMessages: [user, a], onFinish }),
      { initialProps: { onFinish: spy1 as (id: string, e: ExecutionFinishEvent) => void } }
    )

    await waitFor(() => expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat))
    const chatBefore = result.current.get(EXEC_A)!

    // Mount collector to trigger useChat({chat, resume:true}) → chat.resumeStream()
    const onMessages = vi.fn()
    const { unmount } = render(
      React.createElement(ExecutionStreamCollector, {
        executionId: EXEC_A,
        chat: chatBefore,
        onMessagesChange: onMessages
      })
    )

    await waitFor(() => {
      const t = transports.get(EXEC_A)
      expect(t).toBeDefined()
      expect(t!.__isReady()).toBe(true)
    })

    rerender({ onFinish: spy2 })

    const chatAfter = result.current.get(EXEC_A)!
    expect(chatAfter).toBe(chatBefore)

    const transport = transports.get(EXEC_A)!
    transport.__pushChunk({ type: 'start', messageId: 'a1' } as CherryUIMessageChunk)
    transport.__pushChunk({ type: 'text-start', id: 'tA' } as CherryUIMessageChunk)
    transport.__pushChunk({ type: 'text-delta', id: 'tA', delta: 'hello' } as CherryUIMessageChunk)
    transport.__pushChunk({ type: 'text-end', id: 'tA' } as CherryUIMessageChunk)
    transport.__pushChunk({ type: 'finish' } as CherryUIMessageChunk)
    transport.__close()

    await waitFor(() => expect(spy2).toHaveBeenCalled(), { timeout: 2000 })
    expect(spy1).not.toHaveBeenCalled()
    const [calledExec, event] = spy2.mock.calls[0]
    expect(calledExec).toBe(EXEC_A)
    expect(event.isAbort).toBe(false)
    expect(event.isError).toBe(false)
    expect(event.message).toBeDefined()

    unmount()
  })
})

// ─────────────────────────────────────────────────────────────────────
// C. Multi-model streaming regression
// ─────────────────────────────────────────────────────────────────────

describe('useExecutionChats multi-model streaming isolation', () => {
  it('C — chunks for each execution land only in their own assistant; no cross-contamination', async () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder('a1', EXEC_A)
    const b = makeAssistantPlaceholder('b1', EXEC_B)

    const { result } = renderHook(() =>
      useExecutionChats(TOPIC_ID, [EXEC_A, EXEC_B], { initialMessages: [user, a, b] })
    )

    await waitFor(() => expect(result.current.size).toBe(2))

    const chatA = result.current.get(EXEC_A)!
    const chatB = result.current.get(EXEC_B)!

    const onMessagesA = vi.fn()
    const onMessagesB = vi.fn()
    const collectorA = render(
      React.createElement(ExecutionStreamCollector, {
        executionId: EXEC_A,
        chat: chatA,
        onMessagesChange: onMessagesA
      })
    )
    const collectorB = render(
      React.createElement(ExecutionStreamCollector, {
        executionId: EXEC_B,
        chat: chatB,
        onMessagesChange: onMessagesB
      })
    )

    await waitFor(() => {
      expect(transports.get(EXEC_A)?.__isReady()).toBe(true)
      expect(transports.get(EXEC_B)?.__isReady()).toBe(true)
    })

    const tA = transports.get(EXEC_A)!
    const tB = transports.get(EXEC_B)!

    tA.__pushChunk({ type: 'start', messageId: 'a1' } as CherryUIMessageChunk)
    tA.__pushChunk({ type: 'text-start', id: 'tA' } as CherryUIMessageChunk)
    tA.__pushChunk({ type: 'text-delta', id: 'tA', delta: 'helloA' } as CherryUIMessageChunk)
    tA.__pushChunk({ type: 'text-end', id: 'tA' } as CherryUIMessageChunk)
    tA.__pushChunk({ type: 'finish' } as CherryUIMessageChunk)
    tA.__close()

    tB.__pushChunk({ type: 'start', messageId: 'b1' } as CherryUIMessageChunk)
    tB.__pushChunk({ type: 'text-start', id: 'tB' } as CherryUIMessageChunk)
    tB.__pushChunk({ type: 'text-delta', id: 'tB', delta: 'helloB' } as CherryUIMessageChunk)
    tB.__pushChunk({ type: 'text-end', id: 'tB' } as CherryUIMessageChunk)
    tB.__pushChunk({ type: 'finish' } as CherryUIMessageChunk)
    tB.__close()

    await waitFor(
      () => {
        const tailA = chatA.messages.at(-1)
        const tailB = chatB.messages.at(-1)
        expect(tailA?.parts?.some((p) => p.type === 'text' && p.text.length > 0)).toBe(true)
        expect(tailB?.parts?.some((p) => p.type === 'text' && p.text.length > 0)).toBe(true)
      },
      { timeout: 2000 }
    )

    const tailA = chatA.messages.at(-1)!
    const tailB = chatB.messages.at(-1)!
    const textA = tailA.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    const textB = tailB.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')

    expect(tailA.id).toBe('a1')
    expect(textA).toBe('helloA')
    expect(textA).not.toContain('helloB')

    expect(tailB.id).toBe('b1')
    expect(textB).toBe('helloB')
    expect(textB).not.toContain('helloA')

    // Ownership — without `pickSeed` each chat would inherit the foreign
    // model's placeholder via the shared `[user, a, b]` seed. With pickSeed
    // each chat only sees its own model's assistant.
    expect(chatA.messages.find((m) => m.id === 'b1')).toBeUndefined()
    expect(chatB.messages.find((m) => m.id === 'a1')).toBeUndefined()

    collectorA.unmount()
    collectorB.unmount()
  })
})
