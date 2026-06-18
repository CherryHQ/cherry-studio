import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

vi.mock('../../tools/agent/GenericTools', () => ({
  getEffectiveStatus: (status: string | undefined, isWaiting: boolean) => {
    if (status === 'pending') return isWaiting ? 'waiting' : 'invoking'
    return status ?? 'pending'
  }
}))

vi.mock('../../tools/ToolHeader', () => ({
  __esModule: true,
  default: ({ toolResponse, status }: any) => (
    <div data-testid="mock-tool-header">
      {toolResponse?.tool?.name}:{status ?? toolResponse?.status}
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

describe('ToolBlockGroup', () => {
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
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByTestId('mock-tool-header')).toBeNull()
    expect(screen.queryByText('1 tool call')).toBeNull()
  })
})
