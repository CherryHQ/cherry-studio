import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type StreamingControllerLogger,
  StreamingMessageController,
  type StreamingTransport
} from '../StreamingMessageController'

const log: StreamingControllerLogger = { warn: vi.fn() }

interface RecordedTransport extends StreamingTransport<string> {
  posts: string[]
  edits: Array<{ id: string; content: string }>
}

function makeTransport(
  opts: { failPostAfter?: number; transformContent?: (text: string) => string } = {}
): RecordedTransport {
  const posts: string[] = []
  const edits: Array<{ id: string; content: string }> = []
  let postCount = 0
  return {
    posts,
    edits,
    async post(content) {
      postCount += 1
      if (opts.failPostAfter !== undefined && postCount > opts.failPostAfter) return null
      posts.push(content)
      return `msg-${postCount}`
    },
    async edit(id, content) {
      edits.push({ id, content })
    },
    transformContent: opts.transformContent
  }
}

describe('StreamingMessageController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lazily creates the first message on onText', async () => {
    const transport = makeTransport()
    const controller = new StreamingMessageController(transport, { maxLength: 100, throttleMs: 50 }, log)

    await controller.onText('hi')

    expect(transport.posts).toHaveLength(1)
    expect(transport.posts[0]).toBe('hi')
  })

  it('edits the existing message on subsequent updates within max length', async () => {
    const transport = makeTransport()
    const controller = new StreamingMessageController(transport, { maxLength: 100, throttleMs: 50 }, log)

    await controller.onText('hello')
    await vi.advanceTimersByTimeAsync(60)
    await controller.onText('hello world')
    await vi.advanceTimersByTimeAsync(2000)

    expect(transport.posts).toHaveLength(1)
    expect(transport.edits.length).toBeGreaterThanOrEqual(1)
    expect(transport.edits[transport.edits.length - 1].content).toBe('hello world')
  })

  it('rolls over to a new message when content exceeds maxLength', async () => {
    const transport = makeTransport()
    const controller = new StreamingMessageController(transport, { maxLength: 50, throttleMs: 10 }, log)

    const para = 'A'.repeat(45)
    const longText = `${para}\n\n${para}\n\n${para}` // 3 paragraphs, each just under 50 chars
    expect(longText.length).toBeGreaterThan(100)

    await controller.onText(longText)
    const result = await controller.complete(longText)

    expect(result).toBe(true)
    // Should have created at least 2 messages (3 chunks → multiple posts).
    expect(transport.posts.length).toBeGreaterThanOrEqual(2)
    for (const content of transport.posts) expect(content.length).toBeLessThanOrEqual(50)
    for (const { content } of transport.edits) expect(content.length).toBeLessThanOrEqual(50)
  })

  it('seals the previously-latest message when a new chunk arrives', async () => {
    const transport = makeTransport()
    const controller = new StreamingMessageController(transport, { maxLength: 30, throttleMs: 10 }, log)

    // First flush — under limit.
    await controller.onText('first short message')
    expect(transport.posts.length).toBe(1)

    // Now overflow into a second chunk on complete.
    const overflow = 'first short message\n\nsecond paragraph that pushes past the limit'
    await controller.complete(overflow)

    expect(transport.posts.length).toBeGreaterThanOrEqual(2)
    // The original message must have been edited (sealed) before the rollover post.
    expect(transport.edits.length).toBeGreaterThanOrEqual(1)
  })

  it('applies transformContent before splitting', async () => {
    const transport = makeTransport({ transformContent: (text) => text.toUpperCase() })
    const controller = new StreamingMessageController(transport, { maxLength: 100, throttleMs: 50 }, log)

    await controller.onText('hello')

    expect(transport.posts[0]).toBe('HELLO')
  })

  it('appends an error appendix and may roll into a new message', async () => {
    const transport = makeTransport()
    const controller = new StreamingMessageController(transport, { maxLength: 50, throttleMs: 10 }, log)

    await controller.onText('partial output')
    await controller.error('boom')

    const allWritten = [...transport.posts, ...transport.edits.map((e) => e.content)].join('\n')
    expect(allWritten).toContain('Error')
    expect(allWritten).toContain('boom')
  })

  it('complete() returns false when no message has been created yet', async () => {
    const transport = makeTransport()
    const controller = new StreamingMessageController(transport, { maxLength: 100, throttleMs: 50 }, log)

    const result = await controller.complete('final')
    expect(result).toBe(false)
  })

  it('bails out of rollover loop when post fails', async () => {
    const transport = makeTransport({ failPostAfter: 1 })
    const controller = new StreamingMessageController(transport, { maxLength: 30, throttleMs: 10 }, log)

    const longText = `${'A'.repeat(28)}\n\n${'B'.repeat(28)}\n\n${'C'.repeat(28)}`
    await controller.onText(longText)
    await controller.complete(longText)

    // Only one POST succeeded; should not infinite-loop.
    expect(transport.posts.length).toBe(1)
  })
})
