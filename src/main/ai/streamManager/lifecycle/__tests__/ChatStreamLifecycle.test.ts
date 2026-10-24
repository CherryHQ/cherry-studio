import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cache } = vi.hoisted(() => ({
  cache: { setShared: vi.fn(), getShared: vi.fn((): unknown => undefined) }
}))

vi.mock('@application', () => ({ application: { get: vi.fn(() => cache) }, serviceList: [] }))

const { createChatStreamLifecycle } = await import('../ChatStreamLifecycle')

type Stream = Parameters<ReturnType<typeof createChatStreamLifecycle>['onCreated']>[0]

const stream = (overrides: Record<string, unknown> = {}): Stream =>
  ({
    topicId: 'topic-1',
    turnId: 'turn-1',
    status: 'streaming',
    executions: new Map(),
    isPersistentConversation: true,
    ...overrides
  }) as unknown as Stream

/** The last value written under the topic's status key. */
const lastSnapshot = (): Record<string, unknown> =>
  cache.setShared.mock.calls.filter(([key]) => key === 'topic.stream.statuses.topic-1').at(-1)?.[1] as Record<
    string,
    unknown
  >

describe('chat stream lifecycle topic snapshot', () => {
  beforeEach(() => {
    cache.setShared.mockClear()
    cache.getShared.mockReturnValue(undefined)
  })

  // Detached background work keeps the stream alive past its turn so the receive-only wake can
  // carry the renderer listeners. The renderer must still learn the FOREGROUND turn is over, or a
  // follow-up stays queued until the background task itself finishes.
  it('carries the foreground settle while the stream stays live for background work', () => {
    const lifecycle = createChatStreamLifecycle(30_000, vi.fn())
    const active = stream()
    lifecycle.onCreated(active)

    lifecycle.onTurnSettled(active)

    expect(lastSnapshot()).toMatchObject({ status: 'streaming', turnSettledAt: expect.any(Number) })
  })

  it('keeps the marker on the snapshots a held stream broadcasts later', () => {
    const lifecycle = createChatStreamLifecycle(30_000, vi.fn())
    const active = stream()
    lifecycle.onCreated(active)
    lifecycle.onTurnSettled(active)
    const settledAt = lastSnapshot().turnSettledAt

    lifecycle.onActiveExecutionsChanged(active)

    expect(lastSnapshot()).toMatchObject({ turnSettledAt: settledAt })
  })

  it('drops the settled marker once the stream reaches a terminal status', () => {
    const lifecycle = createChatStreamLifecycle(30_000, vi.fn())
    const active = stream()
    lifecycle.onCreated(active)
    lifecycle.onTurnSettled(active)

    ;(active as unknown as { status: string }).status = 'done'
    lifecycle.onTerminal(active)

    expect(lastSnapshot()).toMatchObject({ status: 'done' })
    expect(lastSnapshot().turnSettledAt).toBeUndefined()
  })
})
