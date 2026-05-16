import { Chat } from '@ai-sdk/react'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { MockTransport } from '@test-mocks/renderer/IpcChatTransport'
import { render, waitFor } from '@testing-library/react'
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

import { ExecutionTransport } from '@renderer/transport/IpcChatTransport'

import ExecutionStreamCollector from '../stream/ExecutionStreamCollector'

const TOPIC_ID = 'topic-1'
const EXEC_A = 'openai::gpt-4o' as UniqueModelId

function newChat(): Chat<CherryUIMessage> {
  const transport = new ExecutionTransport(TOPIC_ID, EXEC_A)
  return new Chat<CherryUIMessage>({
    id: `${TOPIC_ID}:${EXEC_A}`,
    transport: transport as never
  })
}

beforeEach(() => {
  transports.clear()
})

afterEach(() => {
  transports.clear()
})

describe('ExecutionStreamCollector', () => {
  it('renders nothing', () => {
    const chat = newChat()
    const onMessagesChange = vi.fn()
    const { container } = render(
      <ExecutionStreamCollector executionId={EXEC_A} chat={chat} onMessagesChange={onMessagesChange} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('calls onMessagesChange after a chunk arrives', async () => {
    const chat = newChat()
    const onMessagesChange = vi.fn()
    render(<ExecutionStreamCollector executionId={EXEC_A} chat={chat} onMessagesChange={onMessagesChange} />)

    await waitFor(() => expect(transports.get(EXEC_A)?.__isReady()).toBe(true))
    const transport = transports.get(EXEC_A)!
    transport.__pushChunk({ type: 'start', messageId: 'a1' } as CherryUIMessageChunk)
    transport.__pushChunk({ type: 'text-start', id: 'tA' } as CherryUIMessageChunk)
    transport.__pushChunk({ type: 'text-delta', id: 'tA', delta: 'hi' } as CherryUIMessageChunk)
    transport.__pushChunk({ type: 'text-end', id: 'tA' } as CherryUIMessageChunk)
    transport.__pushChunk({ type: 'finish' } as CherryUIMessageChunk)
    transport.__close()

    await waitFor(() => expect(onMessagesChange).toHaveBeenCalled(), { timeout: 2000 })
    const [execId, messages] = onMessagesChange.mock.calls.at(-1)!
    expect(execId).toBe(EXEC_A)
    expect(messages.length).toBeGreaterThanOrEqual(1)
  })

  it('does not call onMessagesChange for the seed-only initial render', async () => {
    const chat = newChat()
    const onMessagesChange = vi.fn()
    render(<ExecutionStreamCollector executionId={EXEC_A} chat={chat} onMessagesChange={onMessagesChange} />)

    // Wait for transport to be ready (useChat mounted, resumeStream called).
    // Assert no onMessagesChange yet — the seedRef guard short-circuits the
    // initial render where messages === seedRef.current.
    await waitFor(() => expect(transports.get(EXEC_A)?.__isReady()).toBe(true))
    expect(onMessagesChange).not.toHaveBeenCalled()
  })

  it('D4 — calls onDispose on unmount', async () => {
    const chat = newChat()
    const onDispose = vi.fn()
    const { unmount } = render(
      <ExecutionStreamCollector executionId={EXEC_A} chat={chat} onMessagesChange={vi.fn()} onDispose={onDispose} />
    )
    unmount()
    expect(onDispose).toHaveBeenCalledTimes(1)
    expect(onDispose).toHaveBeenCalledWith(EXEC_A)
  })
})
