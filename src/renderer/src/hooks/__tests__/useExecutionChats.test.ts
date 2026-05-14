// `topicId` change is not exercised here — the hook does not evict stale
// entries; the caller (ChatContent / AgentChat) re-mounts the entire
// subtree via `key={topic.id}`, so this hook starts fresh on topic switch.

import { Chat } from '@ai-sdk/react'
import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { MockTransport } from '@test-mocks/renderer/IpcChatTransport'
import { render, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Per-test transport registry — owned by this file, not the shared mock,
// so concurrent tests in other files can't observe each other's transports.
const { transports } = vi.hoisted(() => ({ transports: new Map<string, MockTransport>() }))

vi.mock('@renderer/transport/IpcChatTransport', async () => {
  const { createMockExecutionTransport } = await import('@test-mocks/renderer/IpcChatTransport')
  return { ExecutionTransport: createMockExecutionTransport(transports) }
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() })
  }
}))

import ExecutionStreamCollector from '@renderer/components/chat/messages/stream/ExecutionStreamCollector'

import { type ExecutionFinishEvent, pickSeed, useExecutionChats } from '../useExecutionChats'

const TOPIC_ID = 'topic-1'
const EXEC_A = 'openai::gpt-4o' as UniqueModelId
const EXEC_B = 'anthropic::claude-3-5-sonnet' as UniqueModelId
const ANCHOR_A = 'msg-a1'
const ANCHOR_B = 'msg-b1'

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
    metadata: { modelId, status: 'pending' } as CherryUIMessage['metadata']
  } as CherryUIMessage
}

const exec = (executionId: UniqueModelId, anchorMessageId?: string): ActiveExecution => ({
  executionId,
  anchorMessageId
})

beforeEach(() => {
  transports.clear()
})

afterEach(() => {
  transports.clear()
})

// ─────────────────────────────────────────────────────────────────────
// A. pickSeed (pure function — id-based lookup)
// ─────────────────────────────────────────────────────────────────────

describe('pickSeed', () => {
  it('A1 — returns the message matching anchorMessageId', () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder(ANCHOR_A, EXEC_A)
    expect(pickSeed([user, a], ANCHOR_A)).toEqual([a])
  })

  it('A2 — multi-sibling: each anchor id picks its own placeholder', () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder(ANCHOR_A, EXEC_A)
    const b = makeAssistantPlaceholder(ANCHOR_B, EXEC_B)
    const messages = [user, a, b]
    expect(pickSeed(messages, ANCHOR_A)).toEqual([a])
    expect(pickSeed(messages, ANCHOR_B)).toEqual([b])
  })

  it('A3 — anchor not in messages returns undefined (race-safe)', () => {
    // Cache_Sync arrived with anchorMessageId before SWR refreshed uiMessages.
    // pickSeed returns undefined → AI SDK creates a fresh assistant from the
    // start chunk's messageId; mergedPartsMap reconciles by id once SWR catches up.
    const user = makeUserMessage('u1')
    expect(pickSeed([user], ANCHOR_A)).toBeUndefined()
  })

  it('A4 — empty / undefined messages or anchor returns undefined', () => {
    expect(pickSeed(undefined, ANCHOR_A)).toBeUndefined()
    expect(pickSeed([], ANCHOR_A)).toBeUndefined()
    expect(pickSeed([makeAssistantPlaceholder(ANCHOR_A, EXEC_A)], undefined)).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────
// B. useExecutionChats hook lifecycle
// ─────────────────────────────────────────────────────────────────────

describe('useExecutionChats', () => {
  it('B1 — creates one Chat per active execution', async () => {
    const { result } = renderHook(() => useExecutionChats(TOPIC_ID, [exec(EXEC_A), exec(EXEC_B)]))
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat)
    expect(result.current.get(EXEC_B)).toBeInstanceOf(Chat)
  })

  it('B2 — same execution across rerender returns the same Chat reference', async () => {
    const { result, rerender } = renderHook(({ execs }) => useExecutionChats(TOPIC_ID, execs), {
      initialProps: { execs: [exec(EXEC_A)] as readonly ActiveExecution[] }
    })
    await waitFor(() => expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat))
    const before = result.current.get(EXEC_A)!
    rerender({ execs: [exec(EXEC_A)] })
    await waitFor(() => expect(result.current.get(EXEC_A)).toBe(before))
  })

  it('B3 — adding a new execution does not recreate existing Chats', async () => {
    const { result, rerender } = renderHook(({ execs }) => useExecutionChats(TOPIC_ID, execs), {
      initialProps: { execs: [exec(EXEC_A)] as readonly ActiveExecution[] }
    })
    await waitFor(() => expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat))
    const aBefore = result.current.get(EXEC_A)!
    rerender({ execs: [exec(EXEC_A), exec(EXEC_B)] })
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get(EXEC_A)).toBe(aBefore)
    expect(result.current.get(EXEC_B)).toBeInstanceOf(Chat)
    expect(result.current.get(EXEC_B)).not.toBe(aBefore)
  })

  it('B4 — multi-model isolation: each chat seeded with its own anchor', async () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder(ANCHOR_A, EXEC_A)
    const b = makeAssistantPlaceholder(ANCHOR_B, EXEC_B)
    const { result } = renderHook(() =>
      useExecutionChats(TOPIC_ID, [exec(EXEC_A, ANCHOR_A), exec(EXEC_B, ANCHOR_B)], {
        initialMessages: [user, a, b]
      })
    )
    await waitFor(() => expect(result.current.size).toBe(2))
    expect(result.current.get(EXEC_A)!.messages.at(-1)?.id).toBe(ANCHOR_A)
    expect(result.current.get(EXEC_B)!.messages.at(-1)?.id).toBe(ANCHOR_B)
  })

  it('B6 — initialMessages is a one-shot seed; rerender does not rebuild existing Chats', async () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder(ANCHOR_A, EXEC_A)
    const { result, rerender } = renderHook(
      ({ msgs }) => useExecutionChats(TOPIC_ID, [exec(EXEC_A, ANCHOR_A)], { initialMessages: msgs }),
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

  it('B7 — race: anchor not yet in uiMessages → chat seeded empty, AI SDK creates from start chunk', async () => {
    // Cache_Sync arrives with anchorMessageId='msg-future' before SWR
    // refreshes uiMessages to include it. Hook must NOT pick a stale
    // assistant by some heuristic — it must seed empty and let the chat
    // create the assistant from the incoming start chunk.
    const user = makeUserMessage('u1')
    const oldAssistant = {
      id: 'old-msg',
      role: 'assistant',
      parts: [{ type: 'text', text: 'old answer' }],
      metadata: { modelId: EXEC_A, status: 'success' }
    } as unknown as CherryUIMessage
    const { result } = renderHook(() =>
      useExecutionChats(TOPIC_ID, [exec(EXEC_A, 'msg-future')], { initialMessages: [user, oldAssistant] })
    )
    await waitFor(() => expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat))
    // Chat is seeded empty (pickSeed returned undefined).
    expect(result.current.get(EXEC_A)!.messages).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────
// B5. onFinish ref pattern (end-to-end via collector mount)
// ─────────────────────────────────────────────────────────────────────

describe('useExecutionChats onFinish ref pattern', () => {
  it('B5 — rerender swaps onFinish without recreating chat; latest callback fires on stream finish', async () => {
    const user = makeUserMessage('u1')
    const a = makeAssistantPlaceholder(ANCHOR_A, EXEC_A)
    const spy1 = vi.fn()
    const spy2 = vi.fn()

    const { result, rerender } = renderHook(
      ({ onFinish }) => useExecutionChats(TOPIC_ID, [exec(EXEC_A, ANCHOR_A)], { initialMessages: [user, a], onFinish }),
      { initialProps: { onFinish: spy1 as (id: string, e: ExecutionFinishEvent) => void } }
    )

    await waitFor(() => expect(result.current.get(EXEC_A)).toBeInstanceOf(Chat))
    const chatBefore = result.current.get(EXEC_A)!

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
    transport.__pushChunk({ type: 'start', messageId: ANCHOR_A } as CherryUIMessageChunk)
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
    const a = makeAssistantPlaceholder(ANCHOR_A, EXEC_A)
    const b = makeAssistantPlaceholder(ANCHOR_B, EXEC_B)

    const { result } = renderHook(() =>
      useExecutionChats(TOPIC_ID, [exec(EXEC_A, ANCHOR_A), exec(EXEC_B, ANCHOR_B)], {
        initialMessages: [user, a, b]
      })
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

    tA.__pushChunk({ type: 'start', messageId: ANCHOR_A } as CherryUIMessageChunk)
    tA.__pushChunk({ type: 'text-start', id: 'tA' } as CherryUIMessageChunk)
    tA.__pushChunk({ type: 'text-delta', id: 'tA', delta: 'helloA' } as CherryUIMessageChunk)
    tA.__pushChunk({ type: 'text-end', id: 'tA' } as CherryUIMessageChunk)
    tA.__pushChunk({ type: 'finish' } as CherryUIMessageChunk)
    tA.__close()

    tB.__pushChunk({ type: 'start', messageId: ANCHOR_B } as CherryUIMessageChunk)
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

    expect(tailA.id).toBe(ANCHOR_A)
    expect(textA).toBe('helloA')
    expect(textA).not.toContain('helloB')

    expect(tailB.id).toBe(ANCHOR_B)
    expect(textB).toBe('helloB')
    expect(textB).not.toContain('helloA')

    // Ownership — each chat's history must NOT contain the OTHER model's
    // anchor. Without anchor-scoped seeding the chats would share the full
    // [user, a, b] tail, so this assertion catches that regression.
    expect(chatA.messages.find((m) => m.id === ANCHOR_B)).toBeUndefined()
    expect(chatB.messages.find((m) => m.id === ANCHOR_A)).toBeUndefined()

    collectorA.unmount()
    collectorB.unmount()
  })
})
