import { act, render, screen } from '@testing-library/react'
import { Activity } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TracePage } from '../TracePage'

const mocks = vi.hoisted(() => ({
  getData: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../SpanDetail', () => ({
  default: () => <div>span detail</div>
}))

vi.mock('../TraceTree', () => ({
  default: ({ node }: { node: { name: string } }) => <div>{node.name}</div>
}))

function TracePageHarness({ visible }: { visible: boolean }) {
  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <TracePage topicId="topic-1" traceId="a1b2c3" reload="turn-1" />
    </Activity>
  )
}

describe('TracePage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getData.mockReset().mockResolvedValue({
      reset: true,
      cursor: { historyVersion: null, liveRevision: 1 },
      spans: [
        {
          id: 'span-1',
          parentId: null,
          name: 'ai.turn',
          startTime: 1,
          endTime: 2
        }
      ]
    })
    ;(window as unknown as { api: unknown }).api = { trace: { getData: mocks.getData } }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls again when a naturally completed trace is shown again', async () => {
    const view = render(<TracePageHarness visible />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    const callsAfterNaturalStop = mocks.getData.mock.calls.length

    view.rerender(<TracePageHarness visible={false} />)
    view.rerender(<TracePageHarness visible />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.getData.mock.calls.length).toBeGreaterThan(callsAfterNaturalStop)
  })

  it('passes the server cursor and applies a changed span without requesting another full snapshot', async () => {
    const cursor = { historyVersion: '1:100', liveRevision: 4 }
    mocks.getData
      .mockResolvedValueOnce({
        reset: true,
        cursor,
        spans: [{ id: 'span-1', parentId: null, name: 'before', startTime: 1, endTime: null }]
      })
      .mockResolvedValue({
        reset: false,
        cursor: { ...cursor, liveRevision: 5 },
        spans: [{ id: 'span-1', parentId: null, name: 'after', startTime: 1, endTime: 2 }]
      })

    render(<TracePageHarness visible />)
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(mocks.getData).toHaveBeenNthCalledWith(1, 'topic-1', 'a1b2c3', undefined)
    expect(mocks.getData).toHaveBeenNthCalledWith(2, 'topic-1', 'a1b2c3', cursor)
    expect(screen.getByText('after')).toBeInTheDocument()
  })

  it('does not overlap polls while the previous IPC request is pending', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined
    mocks.getData.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )

    render(<TracePageHarness visible />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(mocks.getData).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRequest?.({ reset: true, cursor: { historyVersion: null, liveRevision: 0 }, spans: [] })
      await Promise.resolve()
    })
  })
})
