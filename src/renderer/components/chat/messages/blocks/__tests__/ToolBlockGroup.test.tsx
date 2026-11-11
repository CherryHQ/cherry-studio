import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PROVIDER_WEB_SEARCH_TOOL_NAME } from '@shared/ai/builtinTools'

import type { ToolRenderItem } from '../../tools/toolResponse'
import { ToolBlockGroup, ToolBlockGroupHeaderContent } from '../ToolBlockGroup'

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

vi.mock('react-spinners', () => ({
  BeatLoader: () => <span data-testid="beat-loader" />
}))

vi.mock('../../tools/shared/GenericTools', () => ({
  getEffectiveStatus: (status: string | undefined, isWaiting: boolean) => {
    if (status === 'pending') return isWaiting ? 'waiting' : 'invoking'
    return status ?? 'pending'
  }
}))

vi.mock('../../tools/ToolHeader', () => ({
  __esModule: true,
  getReadableToolActivity: (toolName: string) =>
    toolName === PROVIDER_WEB_SEARCH_TOOL_NAME
      ? { label: 'message.tools.activity.search', description: 'message.tools.activity.webSearch' }
      : toolName.startsWith('mcp__') ||
          ['do_magic', 'fetch_markdown', 'send_email', 'web_search'].some((name) => toolName.includes(name))
        ? undefined
        : { label: 'Check', description: 'Project checks' },
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

  it('keeps a nested tool group collapsed until its own header is clicked', () => {
    render(<ToolBlockGroup items={[readDoneItem]} />)

    const trigger = screen.getByRole('button', { name: 'Project checks' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    expect(screen.queryByTestId('mock-message-tools')).toBeNull()

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    expect(screen.getByTestId('mock-message-tools')).toHaveTextContent('Read')
  })

  it('shows live progress instead of the summary while any tool is still running', () => {
    render(<ToolBlockGroupHeaderContent items={items} summary="2 tool calls" />)

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Read:invoking')
    expect(screen.queryByText('2 tool calls')).toBeNull()
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

  it('switches immediately from an error header to new live progress', () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <ToolBlockGroupHeaderContent
        items={[errorEditItem]}
        summary="1 tool call"
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Edit:error')

    rerender(
      <ToolBlockGroupHeaderContent
        items={[errorEditItem, items[0]]}
        summary="2 tool calls"
        isLiveProgress
        showLatestWhenComplete
      />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Read:invoking')
  })
})
