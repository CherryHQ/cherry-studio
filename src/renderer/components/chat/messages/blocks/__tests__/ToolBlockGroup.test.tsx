import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ToolRenderItem } from '../../tools/toolResponse'
import { ToolBlockGroupHeaderContent } from '../ToolBlockGroup'

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>
}))

vi.mock('motion/react', () => {
  const Div = ({ ref, children, ...props }: any) => (
    <div ref={ref} {...props}>
      {children}
    </div>
  )
  const proxy = new Proxy({ div: Div, create: (C: any) => C }, { get: (target, key) => (target as any)[key] ?? Div })
  return { AnimatePresence: ({ children }: any) => <>{children}</>, motion: proxy }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, number>) => {
      if (key === 'message.tools.groupHeader') return `${params?.count} tool calls`
      return key
    }
  })
}))

vi.mock('../../tools/shared/GenericTools', () => ({
  getEffectiveStatus: (status: string | undefined, isWaiting: boolean) => {
    if (status === 'pending') return isWaiting ? 'waiting' : 'invoking'
    return status ?? 'pending'
  }
}))

vi.mock('../../tools/ToolHeader', () => ({
  __esModule: true,
  default: ({ shimmer, toolResponse, status }: any) => (
    <div data-testid="mock-tool-header" data-shimmer={String(!!shimmer)}>
      {toolResponse?.tool?.name}:{status ?? toolResponse?.status}
      {toolResponse?.arguments?.file_path ? `:${toolResponse.arguments.file_path}` : ''}
    </div>
  )
}))

vi.mock('../../tools/MessageTools', () => ({
  __esModule: true,
  default: ({ toolResponse }: any) => <div data-testid="mock-message-tools">{toolResponse?.tool?.name}</div>
}))

vi.mock('../BlockErrorFallback', () => ({ __esModule: true, default: () => null }))

const items = [
  {
    id: 'tool-a',
    toolResponse: {
      id: 'tool-a',
      toolCallId: 'tool-a',
      tool: { id: 'tool-a', name: 'Read', type: 'builtin' },
      arguments: {},
      status: 'pending',
      response: undefined
    }
  },
  {
    id: 'tool-b',
    toolResponse: {
      id: 'tool-b',
      toolCallId: 'tool-b',
      tool: { id: 'tool-b', name: 'Write', type: 'builtin' },
      arguments: {},
      status: 'done',
      response: {}
    }
  }
] as ToolRenderItem[]

const readDoneItem = {
  ...items[0],
  toolResponse: {
    ...items[0].toolResponse,
    status: 'done',
    response: {}
  }
} as ToolRenderItem

const runningEditItem = {
  id: 'tool-c',
  toolResponse: {
    id: 'tool-c',
    toolCallId: 'tool-c',
    tool: { id: 'tool-c', name: 'Edit', type: 'builtin' },
    arguments: {},
    status: 'pending',
    response: undefined
  }
} as ToolRenderItem

const errorEditItem = {
  ...runningEditItem,
  toolResponse: {
    ...runningEditItem.toolResponse,
    status: 'error',
    response: { isError: true }
  }
} as ToolRenderItem

describe('ToolBlockGroup', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows live progress instead of the summary while any tool is still running', () => {
    render(<ToolBlockGroupHeaderContent items={items} summary="2 tool calls" />)

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Read:invoking')
    expect(screen.queryByText('2 tool calls')).toBeNull()
  })

  it('shows the summary after every tool has ended', () => {
    const { container } = render(<ToolBlockGroupHeaderContent items={[items[1]]} summary="1 tool call" />)

    expect(screen.getByText('1 tool call')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-tool-header')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('shows elapsed time with the summary header', () => {
    render(<ToolBlockGroupHeaderContent items={[items[1]]} summary="1 tool call" elapsedText="3 seconds" />)

    expect(screen.getByText('1 tool call')).toBeInTheDocument()
    expect(screen.getByText('3 seconds')).toBeInTheDocument()
  })

  it('prefers the summary when tool details are already expanded', () => {
    render(
      <ToolBlockGroupHeaderContent
        items={items}
        activityLabel="Thinking..."
        summary="2 tool calls"
        isLiveProgress
        preferSummary
        showLatestWhenComplete
      />
    )

    expect(screen.getByText('2 tool calls')).toBeInTheDocument()
    expect(screen.queryByText('Thinking...')).toBeNull()
    expect(screen.queryByTestId('mock-tool-header')).toBeNull()
  })

  it('can keep showing the latest tool even after current tool items have ended', () => {
    render(<ToolBlockGroupHeaderContent items={[items[1]]} summary="1 tool call" showLatestWhenComplete />)

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Write:done')
    expect(screen.queryByText('1 tool call')).toBeNull()
  })

  it('marks the top-level latest tool header as active while live progress continues', () => {
    render(
      <ToolBlockGroupHeaderContent items={[items[1]]} summary="1 tool call" isLiveProgress showLatestWhenComplete />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Write:invoking')
    expect(screen.queryByText('1 tool call')).toBeNull()
  })

  it('shows the current non-tool activity before falling back to the latest completed tool', () => {
    const { container } = render(
      <ToolBlockGroupHeaderContent
        items={[items[1]]}
        activityLabel="Thinking..."
        summary="1 tool call"
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(container.querySelector('.animation-shimmer')).not.toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
    expect(screen.queryByTestId('mock-tool-header')).toBeNull()
    expect(screen.queryByText('1 tool call')).toBeNull()
  })

  it('shows elapsed text at the end of live non-tool activity', () => {
    render(
      <ToolBlockGroupHeaderContent
        items={[items[1]]}
        activityLabel="Thinking..."
        elapsedText="1 second"
        summary="1 tool call"
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(screen.getByText('1 second')).toBeInTheDocument()
  })

  it('passes shimmer only to the current live tool header', () => {
    render(
      <ToolBlockGroupHeaderContent
        items={[items[1]]}
        elapsedText="1 second"
        summary="1 tool call"
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveAttribute('data-shimmer', 'true')
    expect(screen.getByText('1 second')).toBeInTheDocument()
  })

  it('keeps fast live tool header changes stable before switching to the latest tool', () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <ToolBlockGroupHeaderContent items={[items[0]]} summary="1 tool call" isLiveProgress showLatestWhenComplete />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Read:invoking')

    rerender(
      <ToolBlockGroupHeaderContent
        items={[readDoneItem, runningEditItem]}
        summary="2 tool calls"
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Read:invoking')

    act(() => {
      vi.advanceTimersByTime(699)
    })
    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Read:invoking')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Edit:invoking')
  })

  it('updates the header immediately when live progress ends', () => {
    const { rerender } = render(
      <ToolBlockGroupHeaderContent
        items={[]}
        activityLabel="Thinking..."
        summary="Thinking..."
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByText('Thinking...')).toBeInTheDocument()

    rerender(<ToolBlockGroupHeaderContent items={[]} summary="Reasoning content" />)

    expect(screen.getByText('Reasoning content')).toBeInTheDocument()
    expect(screen.queryByText('Thinking...')).toBeNull()
  })

  it('updates the displayed item data when the live candidate key stays the same', () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <ToolBlockGroupHeaderContent items={[items[0]]} summary="1 tool call" isLiveProgress showLatestWhenComplete />
    )

    expect(screen.getByTestId('mock-tool-header')).not.toHaveTextContent('/tmp/a.ts')

    rerender(
      <ToolBlockGroupHeaderContent
        items={[
          {
            ...items[0],
            toolResponse: {
              ...items[0].toolResponse,
              arguments: { file_path: '/tmp/a.ts' }
            }
          }
        ]}
        summary="1 tool call"
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Read:invoking:/tmp/a.ts')
  })

  it('shows error tool headers immediately without waiting for the stability delay', () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <ToolBlockGroupHeaderContent items={[items[0]]} summary="1 tool call" isLiveProgress showLatestWhenComplete />
    )

    rerender(
      <ToolBlockGroupHeaderContent
        items={[readDoneItem, errorEditItem]}
        summary="2 tool calls"
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Edit:error')
  })
})
