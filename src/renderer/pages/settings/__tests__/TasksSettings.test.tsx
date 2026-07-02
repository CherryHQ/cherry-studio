import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const taskDataMock = vi.hoisted(() => {
  const defaultTask = {
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

  return {
    defaultTask,
    task: { ...defaultTask }
  }
})

const taskMutationMocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  runTask: vi.fn(),
  updateTask: vi.fn()
}))

const navigationMocks = vi.hoisted(() => ({
  openConversation: vi.fn()
}))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: dataApiMock
}))

vi.mock('@renderer/hooks/agent/useChannels', () => ({
  useChannels: () => ({ channels: [] })
}))

vi.mock('@renderer/hooks/agent/useTasks', () => ({
  useCreateTask: () => ({ createTask: taskMutationMocks.createTask }),
  useDeleteTask: () => ({ deleteTask: taskMutationMocks.deleteTask }),
  useRunTask: () => ({ runTask: taskMutationMocks.runTask }),
  useTaskLogs: () => taskLogsMock,
  useUpdateTask: () => ({ updateTask: taskMutationMocks.updateTask })
}))

vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({
    openConversation: navigationMocks.openConversation
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
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
  const PopoverContext = React.createContext<{
    open: boolean
    setOpen: (open: boolean) => void
  } | null>(null)

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
    ConfirmDialog: ({
      cancelText,
      confirmText,
      onConfirm,
      open,
      title
    }: {
      cancelText?: React.ReactNode
      confirmText?: React.ReactNode
      onConfirm?: () => void
      open?: boolean
      title?: React.ReactNode
    }) =>
      open ? (
        <div role="dialog">
          {title && <span>{title}</span>}
          {cancelText && <button type="button">{cancelText}</button>}
          {confirmText && (
            <button type="button" onClick={onConfirm}>
              {confirmText}
            </button>
          )}
        </div>
      ) : null,
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
    MenuItem: ({
      description,
      icon,
      label,
      onClick,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      description?: React.ReactNode
      icon?: React.ReactNode
      label: string
    }) => (
      <button type="button" onClick={onClick} {...props}>
        {icon}
        <span>{label}</span>
        {description && <span>{description}</span>}
      </button>
    ),
    MenuList: passthrough('div'),
    Popover: ({
      children,
      onOpenChange,
      open
    }: {
      children?: React.ReactNode
      onOpenChange?: (open: boolean) => void
      open?: boolean
    }) => {
      const [internalOpen, setInternalOpen] = React.useState(Boolean(open))
      const actualOpen = open ?? internalOpen
      const setOpen = (nextOpen: boolean) => {
        setInternalOpen(nextOpen)
        onOpenChange?.(nextOpen)
      }

      return <PopoverContext value={{ open: actualOpen, setOpen }}>{children}</PopoverContext>
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => {
      const context = React.use(PopoverContext)

      return context?.open ? <div>{children}</div> : null
    },
    PopoverTrigger: ({ children }: { asChild?: boolean; children?: React.ReactNode }) => {
      const context = React.use(PopoverContext)

      if (React.isValidElement<{ onClick?: React.MouseEventHandler }>(children)) {
        return React.cloneElement(children, {
          onClick: (event: React.MouseEvent) => {
            children.props.onClick?.(event)
            context?.setOpen(!context.open)
          }
        })
      }

      return (
        <button type="button" onClick={() => context?.setOpen(!context.open)}>
          {children}
        </button>
      )
    },
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
    Switch: ({
      checked,
      disabled,
      onCheckedChange,
      title,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        title={title}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      />
    ),
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
    taskLogsMock.logs = [taskLogsMock.defaultTaskLog]
    taskDataMock.task = { ...taskDataMock.defaultTask }
    dataApiMock.get.mockImplementation((path: string) => {
      if (path === '/agents') {
        return Promise.resolve({
          items: [{ id: 'agent-1', name: 'Agent One', configuration: { soul_enabled: true } }]
        })
      }

      if (path === '/agents/agent-1/tasks') {
        return Promise.resolve({
          items: [taskDataMock.task]
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

  it('delegates task log session navigation to conversation navigation', async () => {
    render(<TasksSettings />)

    await clickTaskLogSessionButton()

    expect(navigationMocks.openConversation).toHaveBeenCalledWith('session-1')
    await waitFor(() => expect(dataApiMock.get).toHaveBeenCalledWith('/agents', { query: { limit: 100 } }))
  })

  it('keeps the full task log result in the DOM while clamping its height', async () => {
    const longResult = 'x'.repeat(220)
    taskLogsMock.logs = [{ ...taskLogsMock.defaultTaskLog, result: longResult }]

    render(<TasksSettings />)

    // Full text stays in the DOM (copyable) ...
    const resultText = await screen.findByText(longResult)
    // ... but the cell height is bounded by a line clamp.
    expect(resultText).toHaveClass('line-clamp-4')
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

  it('swaps the schedule input when the segmented selector changes type', async () => {
    render(<TasksSettings />)

    await screen.findByText('agent.cherryClaw.tasks.logs.viewSession')

    // Interval is the task's initial type.
    expect(screen.getByPlaceholderText('agent.cherryClaw.tasks.intervalPlaceholder')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('agent.cherryClaw.tasks.cronPlaceholder')).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: 'agent.cherryClaw.tasks.scheduleType.cron' }))
    })

    expect(await screen.findByPlaceholderText('agent.cherryClaw.tasks.cronPlaceholder')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('agent.cherryClaw.tasks.intervalPlaceholder')).not.toBeInTheDocument()
    )
  })

  it('moves run and delete into the task detail more menu', async () => {
    render(<TasksSettings />)

    await screen.findByText('agent.cherryClaw.tasks.logs.viewSession')

    expect(screen.getByRole('switch', { name: 'agent.cherryClaw.tasks.status.active' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.queryByTitle('agent.cherryClaw.tasks.run')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.cherryClaw.tasks.pause' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.more' }))
    expect(screen.getByRole('button', { name: 'agent.cherryClaw.tasks.delete.label' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'agent.cherryClaw.tasks.run' }))

    await waitFor(() => expect(taskMutationMocks.runTask).toHaveBeenCalledWith('task-1'))
  })

  it('toggles the selected task status from the header switch', async () => {
    render(<TasksSettings />)

    await screen.findByText('agent.cherryClaw.tasks.logs.viewSession')

    fireEvent.click(screen.getByRole('switch', { name: 'agent.cherryClaw.tasks.status.active' }))

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', { enabled: false })
    )
  })

  it('renders completed task status badge with raw blue tokens matching the status dot', async () => {
    taskDataMock.task = {
      ...taskDataMock.defaultTask,
      enabled: false,
      status: 'completed'
    }

    render(<TasksSettings />)

    const completedBadge = await screen.findByText('agent.cherryClaw.tasks.status.completed')

    expect(completedBadge).toHaveClass('border-blue-500/30', 'bg-blue-500/10', 'text-blue-500')
    expect(completedBadge).not.toHaveClass('border-info/30', 'bg-info/10', 'text-info')
  })

  it('keeps delete in the more menu for completed tasks without showing run or status controls', async () => {
    taskDataMock.task = {
      ...taskDataMock.defaultTask,
      enabled: false,
      status: 'completed'
    }

    render(<TasksSettings />)

    await screen.findByText('agent.cherryClaw.tasks.logs.viewSession')

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'common.more' }))
    })

    expect(screen.queryByRole('button', { name: 'agent.cherryClaw.tasks.run' })).not.toBeInTheDocument()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'agent.cherryClaw.tasks.delete.label' }))
    })

    expect(screen.getByRole('dialog')).toHaveTextContent('agent.cherryClaw.tasks.delete.confirm')
  })
})
