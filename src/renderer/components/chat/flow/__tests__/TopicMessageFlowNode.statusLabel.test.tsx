import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import type { ReactElement, ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import TopicMessageFlowNode from '../TopicMessageFlowNode'
import { TOPIC_MESSAGE_FLOW_NODE_TYPE, type TopicMessageFlowNodeData } from '../types'

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }))

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: mocks.useQuery,
  useDataChange: vi.fn()
}))

vi.mock('@xyflow/react', () => ({
  Handle: () => <span data-testid="flow-handle" />,
  Position: {
    Bottom: 'bottom',
    Top: 'top'
  }
}))

vi.mock('@cherrystudio/ui', async () => {
  const ReactModule = await import('react')
  const PopoverContext = ReactModule.createContext(false)

  return {
    Popover: ({ children, open }: { children: ReactNode; open?: boolean }) => (
      <PopoverContext value={Boolean(open)}>{children}</PopoverContext>
    ),
    PopoverAnchor: ({ children }: { children: ReactElement }) => children,
    PopoverContent: ({ children, ...props }: { children: ReactNode }) => {
      const open = ReactModule.use(PopoverContext)
      return open ? (
        <div data-testid="message-preview-popover" {...props}>
          {children}
        </div>
      ) : null
    }
  }
})

vi.mock('@renderer/components/chat/primitives', () => ({
  EmptyState: ({ title, ...props }: { title?: ReactNode }) => <div {...props}>{title}</div>,
  LoadingState: ({ label, ...props }: { label?: ReactNode }) => <div {...props}>{label}</div>
}))

vi.mock('@renderer/components/chat/messages/MessageContentProvider', () => ({
  MessageContentProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: () => <div />
}))

const nodeData: TopicMessageFlowNodeData = {
  createdAt: '2026-01-01T00:01:00.000Z',
  isActive: false,
  isInactiveBranch: false,
  isOnActivePath: true,
  messageId: 'message-1',
  modelId: 'openai/gpt-5-codex',
  preview: 'Short preview',
  role: 'assistant',
  status: 'success'
}

function renderNode(overrides: Partial<TopicMessageFlowNodeData> = {}) {
  return render(
    <TopicMessageFlowNode
      data={{ ...nodeData, ...overrides }}
      deletable={true}
      draggable={true}
      dragging={false}
      id="message-1"
      isConnectable={false}
      positionAbsoluteX={0}
      positionAbsoluteY={0}
      selectable={true}
      selected={false}
      type={TOPIC_MESSAGE_FLOW_NODE_TYPE}
      zIndex={0}
    />
  )
}

let originalLanguage: string

beforeAll(async () => {
  originalLanguage = i18n.language
  await i18n.changeLanguage('zh-CN')
})

afterAll(async () => {
  await i18n.changeLanguage(originalLanguage)
})

beforeEach(() => {
  mocks.useQuery.mockReturnValue({ data: undefined, error: undefined, isLoading: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TopicMessageFlowNode status label', () => {
  it('shows the translated paused label in the node header', () => {
    renderNode({ status: 'paused' })

    expect(screen.getByText('已暂停', { selector: 'span.truncate' })).toBeInTheDocument()
    expect(screen.queryByText('agent.task.status.paused')).not.toBeInTheDocument()
  })

  it('does not log a missing key for any status label branch', () => {
    const errorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    for (const overrides of [
      { status: 'pending' },
      { status: 'success' },
      { status: 'error' },
      { status: 'paused' },
      { status: 'success', isAwaitingInput: true }
    ] as const) {
      const view = renderNode(overrides)
      view.unmount()
    }

    expect(
      errorSpy.mock.calls.filter(([message]) => typeof message === 'string' && message.startsWith('Missing key:'))
    ).toEqual([])
  })

  it.each([
    [{ status: 'pending' }, '加载中...'],
    [{ status: 'success' }, '完成'],
    [{ status: 'error' }, '错误'],
    [{ status: 'success', isAwaitingInput: true }, '待输入']
  ] as const)('keeps the %s status label as %s', (overrides, label) => {
    renderNode(overrides)

    expect(screen.getByText(label, { selector: 'span.truncate' })).toBeInTheDocument()
  })
})

describe('TopicMessageFlowNode role label', () => {
  it('shows the translated system label in the node header', () => {
    const errorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

    renderNode({ role: 'system' })

    expect(screen.getByText('系统')).toBeInTheDocument()
    expect(
      errorSpy.mock.calls.filter(([message]) => typeof message === 'string' && message.startsWith('Missing key:'))
    ).toEqual([])
  })
})
