import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, type ButtonHTMLAttributes, type HTMLAttributes, type PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TracePage } from '../TracePage'

const mocks = vi.hoisted(() => ({
  getData: vi.fn(),
  t: (key: string) => key
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

vi.mock('@cherrystudio/ui', () => {
  const Div = ({ children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
    <div {...props}>{children}</div>
  )

  return {
    Button: ({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Field: Div,
    FieldContent: Div,
    FieldDescription: Div,
    FieldGroup: Div,
    FieldTitle: Div,
    Tabs: Div,
    TabsContent: Div,
    TabsList: Div,
    TabsTrigger: ({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
  }
})

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre data-testid="code-viewer">{value}</pre>
}))

vi.mock('../TraceTree', () => ({
  default: ({ handleClick, node }: { handleClick: (nodeId: string) => void; node: { id: string; name: string } }) => (
    <button type="button" onClick={() => handleClick(node.id)}>
      {node.name}
    </button>
  )
}))

function TracePageHarness({ visible }: { visible: boolean }) {
  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <TracePage topicId="topic-1" traceId="a1b2c3" />
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

  it('keeps checking a completed container trace for later turns', async () => {
    render(<TracePageHarness visible />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    const callsAfterIdlePeriod = mocks.getData.mock.calls.length

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(mocks.getData.mock.calls.length).toBeGreaterThan(callsAfterIdlePeriod)
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

  it('updates the selected span detail after receiving a delta', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const cursor = { historyVersion: '1:100', liveRevision: 4 }
    mocks.getData
      .mockResolvedValueOnce({
        reset: true,
        cursor,
        spans: [
          {
            id: 'span-1',
            parentId: null,
            name: 'tool.call',
            startTime: 1,
            endTime: null,
            attributes: { inputs: 'before' }
          }
        ]
      })
      .mockResolvedValue({
        reset: false,
        cursor: { ...cursor, liveRevision: 5 },
        spans: [
          {
            id: 'span-1',
            parentId: null,
            name: 'tool.call',
            startTime: 1,
            endTime: 2,
            attributes: { inputs: 'after' }
          }
        ]
      })

    render(<TracePageHarness visible />)
    await act(async () => {
      await Promise.resolve()
    })
    await user.click(screen.getByRole('button', { name: 'tool.call' }))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('before')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId('code-viewer')).toHaveTextContent('after')
  })

  // A mid-stream reset (trace evicted, or local trace data cleared) empties the id map that resolves
  // clicks and the selection. Leaving the rendered rows behind would strand them: visible, but
  // unresolvable by every handler.
  it('clears the rendered spans when a reset arrives mid-stream with nothing left', async () => {
    mocks.getData
      .mockResolvedValueOnce({
        reset: true,
        cursor: { historyVersion: '1:100', liveRevision: 4 },
        spans: [{ id: 'span-1', parentId: null, name: 'ai.turn', startTime: 1, endTime: null }]
      })
      .mockResolvedValue({
        reset: true,
        cursor: { historyVersion: null, liveRevision: 0 },
        spans: []
      })

    render(<TracePageHarness visible />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('ai.turn')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.queryByText('ai.turn')).not.toBeInTheDocument()
    expect(screen.getByText('trace.noTraceList')).toBeInTheDocument()
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
