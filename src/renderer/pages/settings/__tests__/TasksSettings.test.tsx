import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TasksSettings from '../TasksSettings'

const dataApiMock = vi.hoisted(() => ({
  get: vi.fn()
}))

const taskLogsMock = vi.hoisted(() => {
  const defaultTaskLog = {
    id: 'log-1',
    scheduleId: 'task-1',
    sessionId: 'session-1',
    startedAt: '2026-06-25T00:00:00.000Z',
    durationMs: 1200,
    status: 'completed' as const,
    result: 'done',
    error: null
  }

  return {
    defaultTaskLog,
    logs: [defaultTaskLog],
    isLoading: false,
    error: null
  }
})

const navigationMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openConversationTab: vi.fn(),
  openConversationWindow: vi.fn(),
  tabsContext: {} as Record<string, never> | null,
  windowFrameMode: 'embedded' as 'embedded' | 'window'
}))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: dataApiMock
}))

vi.mock('@renderer/hooks/agents/useChannels', () => ({
  useChannels: () => ({ channels: [] })
}))

vi.mock('@renderer/hooks/agents/useTasks', () => ({
  useCreateTask: () => ({ createTask: vi.fn() }),
  useDeleteTask: () => ({ deleteTask: vi.fn() }),
  useRunTask: () => ({ runTask: vi.fn() }),
  useTaskLogs: () => taskLogsMock,
  useUpdateTask: () => ({ updateTask: vi.fn() })
}))

vi.mock('@renderer/context/TabsContext', () => ({
  useOptionalTabsContext: () => navigationMocks.tabsContext
}))

vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({
    openConversationTab: navigationMocks.openConversationTab,
    openConversationWindow: navigationMocks.openConversationWindow
  })
}))

vi.mock('@renderer/components/chat/shell/WindowFrameContext', () => ({
  useWindowFrame: () => ({ mode: navigationMocks.windowFrameMode })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigationMocks.navigate
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/ListItem', () => ({
  default: ({
    active,
    icon,
    subtitle,
    title,
    onClick
  }: {
    active?: boolean
    icon?: React.ReactNode
    subtitle?: React.ReactNode
    title: React.ReactNode
    onClick?: () => void
  }) => (
    <button type="button" data-active={active} onClick={onClick}>
      {icon}
      <span>{title}</span>
      {subtitle && <span>{subtitle}</span>}
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const passthrough =
    (tag: keyof React.JSX.IntrinsicElements) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(tag, props, children)

  return {
    Badge: passthrough('span'),
    Button: ({
      children,
      disabled,
      loading,
      onClick,
      title,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
      <button type="button" disabled={disabled || Boolean(loading)} title={title} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Combobox: passthrough('div'),
    ConfirmDialog: () => null,
    DataTable: ({
      columns,
      data,
      maxHeight,
      rowKey
    }: {
      columns: Array<{
        accessorKey?: string
        id?: string
        cell?: (ctx: { getValue: () => unknown; row: { original: Record<string, unknown> } }) => React.ReactNode
      }>
      data: Array<Record<string, unknown>>
      maxHeight?: number | string
      rowKey: string
    }) => (
      <div data-slot="data-table">
        <div
          data-slot="data-table-scroll"
          className={maxHeight ? 'overflow-y-auto' : undefined}
          style={{ maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}>
          <table>
            <tbody>
              {data.map((row) => (
                <tr key={String(row[rowKey])}>
                  {columns.map((column) => (
                    <td key={column.id ?? column.accessorKey}>
                      {column.cell
                        ? column.cell({
                            getValue: () => (column.accessorKey ? row[column.accessorKey] : undefined),
                            row: { original: row }
                          })
                        : column.accessorKey
                          ? String(row[column.accessorKey] ?? '')
                          : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ),
    DateTimePicker: passthrough('div'),
    Dialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
      open ? <div>{children}</div> : null,
    DialogContent: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('h2'),
    Divider: passthrough('hr'),
    EmptyState: ({ description }: { description?: React.ReactNode }) => <div>{description}</div>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    SegmentedControl: <TValue extends string>({
      disabled,
      options,
      value,
      onValueChange,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      disabled?: boolean
      options: Array<{ value: TValue; label: React.ReactNode; disabled?: boolean }>
      value?: TValue
      onValueChange?: (value: TValue) => void
    }) => (
      <div role="radiogroup" {...props}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            disabled={disabled || option.disabled}
            onClick={() => onValueChange?.(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    ),
    Select: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    SelectContent: passthrough('div'),
    SelectItem: passthrough('div'),
    SelectTrigger: passthrough('div'),
    SelectValue: passthrough('div'),
    Spinner: ({ text }: { text?: React.ReactNode }) => <div>{text}</div>,
    Textarea: {
      Input: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />
    },
    Tooltip: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
      <div data-testid="tooltip">
        {children}
        {title && <span>{title}</span>}
      </div>
    )
  }
})

describe('TasksSettings task logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.tabsContext = {}
    navigationMocks.windowFrameMode = 'embedded'
    taskLogsMock.logs = [taskLogsMock.defaultTaskLog]
    dataApiMock.get.mockImplementation((path: string) => {
      if (path === '/agents') {
        return Promise.resolve({
          items: [{ id: 'agent-1', name: 'Agent One', configuration: { soul_enabled: true } }]
        })
      }

      if (path === '/agents/agent-1/tasks') {
        return Promise.resolve({
          items: [
            {
              id: 'task-1',
              agentId: 'agent-1',
              name: 'Daily task',
              prompt: 'Run daily summary',
              trigger: { kind: 'interval', ms: 60000 },
              timeoutMinutes: 10,
              workspace: { type: 'system' },
              channelIds: [],
              nextRun: null,
              lastRun: null,
              enabled: true,
              status: 'active',
              createdAt: '2026-06-25T00:00:00.000Z',
              updatedAt: '2026-06-25T00:00:00.000Z'
            }
          ]
        })
      }

      throw new Error(`unexpected path: ${path}`)
    })
  })

  async function clickTaskLogSessionButton() {
    const viewSessionTooltip = await screen.findByText('agent.cherryClaw.tasks.logs.viewSession')
    const button = within(viewSessionTooltip.closest('[data-testid="tooltip"]') as HTMLElement).getByRole('button')

    fireEvent.click(button)
  }

  it('opens a task log session in the current tabs context when hosted by the main window', async () => {
    render(<TasksSettings />)

    await clickTaskLogSessionButton()

    expect(navigationMocks.openConversationTab).toHaveBeenCalledWith('session-1')
    expect(navigationMocks.openConversationWindow).not.toHaveBeenCalled()
    expect(navigationMocks.navigate).not.toHaveBeenCalled()
    await waitFor(() => expect(dataApiMock.get).toHaveBeenCalledWith('/agents', { query: { limit: 100 } }))
  })

  it('opens a task log session in a new detached window when settings is hosted by a detached tab window', async () => {
    navigationMocks.windowFrameMode = 'window'

    render(<TasksSettings />)

    await clickTaskLogSessionButton()

    expect(navigationMocks.openConversationWindow).toHaveBeenCalledWith('session-1')
    expect(navigationMocks.openConversationTab).not.toHaveBeenCalled()
    expect(navigationMocks.navigate).not.toHaveBeenCalled()
    await waitFor(() => expect(dataApiMock.get).toHaveBeenCalledWith('/agents', { query: { limit: 100 } }))
  })

  it('opens a task log session in a new detached window when settings has no tabs context', async () => {
    navigationMocks.tabsContext = null

    render(<TasksSettings />)

    await clickTaskLogSessionButton()

    expect(navigationMocks.openConversationWindow).toHaveBeenCalledWith('session-1')
    expect(navigationMocks.openConversationTab).not.toHaveBeenCalled()
    expect(navigationMocks.navigate).not.toHaveBeenCalled()
    await waitFor(() => expect(dataApiMock.get).toHaveBeenCalledWith('/agents', { query: { limit: 100 } }))
  })

  it('truncates long task log results in the result column', async () => {
    const longResult = 'x'.repeat(220)
    taskLogsMock.logs = [{ ...taskLogsMock.defaultTaskLog, result: longResult }]

    render(<TasksSettings />)

    expect(await screen.findByText(`${'x'.repeat(97)}...`)).toBeInTheDocument()
    expect(screen.queryByText(longResult)).not.toBeInTheDocument()
  })

  it('marks already capped task log results with an ellipsis', async () => {
    const cappedResult = 'x'.repeat(200)
    taskLogsMock.logs = [{ ...taskLogsMock.defaultTaskLog, result: cappedResult }]

    render(<TasksSettings />)

    expect(await screen.findByText(`${'x'.repeat(97)}...`)).toBeInTheDocument()
    expect(screen.queryByText(cappedResult)).not.toBeInTheDocument()
  })

  it('lets task log table height follow content while scrolling horizontally', async () => {
    render(<TasksSettings />)

    const table = await screen.findByRole('table')
    const horizontalScroll = table.closest('[data-slot="task-logs-table-scroll"]')
    const tableWidth = table.closest('[data-slot="task-logs-table-width"]')
    const dataTableScroll = table.closest('[data-slot="data-table-scroll"]')

    expect(horizontalScroll).toHaveClass('overflow-x-auto')
    expect(tableWidth).toHaveClass('min-w-[720px]')
    expect(dataTableScroll).not.toHaveClass('overflow-y-auto')
    expect(dataTableScroll).not.toHaveStyle({ maxHeight: '300px' })
  })

  it('renders the segmented schedule type selector for the selected task', async () => {
    render(<TasksSettings />)

    await screen.findByText('agent.cherryClaw.tasks.logs.viewSession')

    expect(screen.getByPlaceholderText('agent.cherryClaw.tasks.intervalPlaceholder')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'agent.cherryClaw.tasks.scheduleType.interval' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'agent.cherryClaw.tasks.scheduleType.once' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByRole('radio', { name: 'agent.cherryClaw.tasks.scheduleType.cron' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })
})
