import { act, render } from '@testing-library/react'
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
  default: () => <div>trace row</div>
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
    mocks.getData.mockReset().mockResolvedValue([
      {
        id: 'span-1',
        parentId: null,
        name: 'ai.turn',
        startTime: 1,
        endTime: 2
      }
    ])
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
})
