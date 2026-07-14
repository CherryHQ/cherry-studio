import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    toolName.startsWith('mcp__') ||
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

const bashDoneItem = {
  ...readDoneItem,
  id: 'tool-bash',
  toolResponse: {
    ...readDoneItem.toolResponse,
    id: 'tool-bash',
    toolCallId: 'tool-bash',
    tool: { id: 'tool-bash', name: 'Bash', type: 'builtin' }
  }
} as ToolRenderItem

const webSearchDoneItem = {
  ...readDoneItem,
  id: 'tool-web-search',
  toolResponse: {
    ...readDoneItem.toolResponse,
    id: 'tool-web-search',
    toolCallId: 'tool-web-search',
    tool: { id: 'tool-web-search', name: 'exa:web_search_exa', type: 'mcp' }
  }
} as ToolRenderItem

const webFetchDoneItem = {
  ...readDoneItem,
  id: 'tool-web-fetch',
  toolResponse: {
    ...readDoneItem.toolResponse,
    id: 'tool-web-fetch',
    toolCallId: 'tool-web-fetch',
    tool: { id: 'tool-web-fetch', name: 'fetch_markdown', type: 'mcp' }
  }
} as ToolRenderItem

const emailDoneItem = {
  ...readDoneItem,
  id: 'tool-email',
  toolResponse: {
    ...readDoneItem.toolResponse,
    id: 'tool-email',
    toolCallId: 'tool-email',
    tool: { id: 'tool-email', name: 'send_email', type: 'mcp' }
  }
} as ToolRenderItem

const cronDoneItem = {
  ...readDoneItem,
  id: 'tool-cron',
  toolResponse: {
    ...readDoneItem.toolResponse,
    id: 'tool-cron',
    toolCallId: 'tool-cron',
    tool: {
      id: 'mcp__cherry-tools__cron',
      name: 'mcp__cherry-tools__cron',
      type: 'mcp',
      description:
        "Manage scheduled tasks. Use action 'add' to create a job, 'list' to see all jobs, or 'remove' to delete a job."
    }
  }
} as ToolRenderItem

const unknownMcpDoneItem = {
  ...readDoneItem,
  id: 'tool-unknown-mcp',
  toolResponse: {
    ...readDoneItem.toolResponse,
    id: 'tool-unknown-mcp',
    toolCallId: 'tool-unknown-mcp',
    tool: { id: 'mcp__custom__do_magic', name: 'mcp__custom__do_magic', type: 'provider' }
  }
} as ToolRenderItem

const unknownMcpRunningItem = {
  ...unknownMcpDoneItem,
  toolResponse: {
    ...unknownMcpDoneItem.toolResponse,
    status: 'pending',
    response: undefined
  }
} as ToolRenderItem

const unknownMcpErrorItem = {
  ...unknownMcpDoneItem,
  toolResponse: {
    ...unknownMcpDoneItem.toolResponse,
    status: 'error',
    response: { isError: true }
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
    expect(trigger).toHaveClass('select-none')
    expect(screen.getByTestId('tool-group-content-icon').querySelector('.lucide-file-text')).not.toBeNull()
    expect(screen.queryByTestId('mock-tool-header')).toBeNull()
    expect(screen.queryByTestId('child-tool-group-divider')).toBeNull()
    expect(screen.queryByTestId('mock-message-tools')).toBeNull()

    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('child-tool-group-content')).toHaveClass('pt-2')
    expect(screen.queryByTestId('child-tool-group-divider')).toBeNull()
    expect(screen.getByTestId('mock-message-tools')).toHaveTextContent('Read')
  })

  it('shows a beat loader while the current task continues after its latest tool completes', () => {
    const { container } = render(<ToolBlockGroup items={[readDoneItem]} isLiveProgress />)

    expect(screen.getByTestId('beat-loader')).toBeInTheDocument()
    expect(container.querySelector('.animation-shimmer')).toBeNull()
  })

  it('shows thinking in the current task title while reasoning streams', () => {
    render(<ToolBlockGroup items={[readDoneItem]} isLiveProgress isThinking />)

    expect(screen.getByTestId('beat-loader')).toBeInTheDocument()
    expect(screen.getByTestId('tool-group-content-icon').querySelector('.lucide-brain')).not.toBeNull()
    expect(screen.getByText('message.tools.thinkingHeader')).toBeInTheDocument()
  })

  it('uses the latest tool type to choose the collapsed group icon', () => {
    render(<ToolBlockGroup items={[bashDoneItem]} />)

    expect(screen.getByTestId('tool-group-content-icon').querySelector('.lucide-square-terminal')).not.toBeNull()
  })

  it('uses a readable title and web icon for a web-search tool group', () => {
    render(<ToolBlockGroup items={[webSearchDoneItem]} />)

    expect(screen.getByTestId('tool-group-content-icon').querySelector('.lucide-globe')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'message.tools.activity.search message.tools.activity.webSearch' })
    ).toBeInTheDocument()
  })

  it('uses a readable title and web icon for a web-fetch tool group', () => {
    render(<ToolBlockGroup items={[webFetchDoneItem]} />)

    expect(screen.getByTestId('tool-group-content-icon').querySelector('.lucide-globe')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'message.tools.activity.view message.tools.activity.webPage' })
    ).toBeInTheDocument()
  })

  it('uses the MCP action and content type for the group title and icon', () => {
    render(<ToolBlockGroup items={[emailDoneItem]} />)

    expect(screen.getByTestId('tool-group-content-icon').querySelector('.lucide-mail')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'message.tools.activity.send message.tools.activity.email' })
    ).toBeInTheDocument()
  })

  it.each([
    ['add', 'create'],
    ['list', 'view'],
    ['remove', 'delete']
  ])('uses the runtime action %s for a multi-action MCP tool description', (action, label) => {
    const item = {
      ...cronDoneItem,
      toolResponse: {
        ...cronDoneItem.toolResponse,
        arguments: { action }
      }
    } as ToolRenderItem

    render(<ToolBlockGroup items={[item]} />)

    expect(
      screen.getByRole('button', { name: `message.tools.activity.${label} message.tools.activity.taskList` })
    ).toBeInTheDocument()
  })

  it('uses a safe extension title for an unrecognized MCP tool', () => {
    render(<ToolBlockGroup items={[unknownMcpDoneItem]} />)

    expect(screen.getByTestId('tool-group-content-icon').querySelector('.lucide-sparkles')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'message.tools.activity.usedExtension' })).toBeInTheDocument()
  })

  it('uses the active extension title while an unrecognized MCP tool is running', () => {
    render(<ToolBlockGroup items={[unknownMcpRunningItem]} isLiveProgress />)

    expect(screen.getByRole('button', { name: 'message.tools.activity.usingExtension' })).toBeInTheDocument()
    expect(screen.getByTestId('beat-loader')).toBeInTheDocument()
  })

  it('uses a clear failure title when an MCP tool fails', () => {
    render(<ToolBlockGroup items={[unknownMcpErrorItem]} />)

    expect(screen.getByRole('button', { name: 'message.tools.activity.extensionFailed' })).toBeInTheDocument()
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

  it('keeps the latest completed tool status while live progress continues', () => {
    render(
      <ToolBlockGroupHeaderContent items={[items[1]]} summary="1 tool call" isLiveProgress showLatestWhenComplete />
    )

    expect(screen.getByTestId('mock-tool-header')).toHaveTextContent('Write:done')
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
      vi.advanceTimersByTime(1199)
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
