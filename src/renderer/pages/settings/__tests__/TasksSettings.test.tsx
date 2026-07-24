import type { ScheduledTaskEntity } from '@shared/data/types/agent'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TasksSettings, { formStateToTrigger, type ScheduleFormState, triggerToFormState } from '../TasksSettings'

const taskLogsMock = vi.hoisted(() => {
  const defaultTaskLog = {
    id: 'log-1',
    scheduleId: 'task-1',
    sessionId: 'session-1' as string | null,
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
  const defaultTask: ScheduledTaskEntity = {
    id: 'task-1',
    agentId: 'agent-1',
    name: 'Daily task',
    prompt: 'Run daily summary',
    trigger: { kind: 'interval' as const, ms: 60_000 },
    timeoutMinutes: 10,
    workspace: { type: 'system' as const },
    channelIds: [] as string[],
    nextRun: null,
    lastRun: null,
    enabled: true,
    status: 'active' as 'active' | 'paused' | 'completed',
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z'
  }

  return {
    defaultTask,
    task: { ...defaultTask },
    tasks: null as null | ScheduledTaskEntity[]
  }
})

const agentDataMock = vi.hoisted(() => ({
  agents: [{ id: 'agent-1', name: 'Agent One', configuration: {} }]
}))

const tasksVersionMock = vi.hoisted(() => ({
  version: 0,
  listeners: new Set<() => void>(),
  bump() {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}))

const taskMutationMocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  nextPage: vi.fn(),
  prevPage: vi.fn(),
  refetchTasks: vi.fn(),
  runTask: vi.fn(),
  updateTask: vi.fn()
}))

const taskPaginationMock = vi.hoisted(() => ({
  page: 1,
  pageCount: 1,
  total: 1,
  hasNext: false,
  hasPrev: false
}))

const navigationMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openConversation: vi.fn(),
  openRoute: vi.fn(),
  taskId: 'task-1' as string | undefined
}))

const channelDataMock = vi.hoisted(() => ({
  channels: [] as Array<Record<string, unknown>>,
  isLoading: false
}))

const translationMock = vi.hoisted(() => ({
  i18n: { language: 'en-US' },
  t: (key: string) => key
}))

const promptPolishActionsMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/hooks/agent/useChannels', () => ({
  useChannels: () => ({ channels: channelDataMock.channels, isLoading: channelDataMock.isLoading })
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: (path: string) =>
    path === '/agents' ? { data: { items: agentDataMock.agents }, error: undefined, isLoading: false } : { data: [] }
}))

vi.mock('@renderer/components/PromptEditorField', () => ({
  default: ({
    actions,
    error,
    label,
    minHeight,
    onChange,
    placeholder,
    value
  }: {
    actions?: React.ReactNode
    error?: string
    label: React.ReactNode
    minHeight?: string
    onChange: (value: string) => void
    placeholder?: string
    value: string
  }) => (
    <div data-slot="prompt-editor-field">
      {label}
      {actions}
      <textarea
        aria-label="agent.tasks.prompt.label"
        aria-invalid={Boolean(error) || undefined}
        placeholder={placeholder}
        style={{ minHeight }}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error ? <div role="alert">{error}</div> : null}
    </div>
  )
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/components/PromptPolishActions', () => ({
  PromptPolishActions: (props: {
    disabled?: boolean
    emptyValueSystemPrompt: string
    existingValueSystemPrompt: string
  }) => {
    promptPolishActionsMock(props)
    return (
      <button type="button" aria-label="library.config.prompt.generate" disabled={props.disabled}>
        library.config.prompt.generate
      </button>
    )
  }
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AgentSelector: ({ onChange, trigger }: { onChange: (agentId: string) => void; trigger: React.ReactNode }) => (
    <>
      {trigger}
      <button type="button" aria-label="select Agent Two" onClick={() => onChange('agent-2')}>
        Agent Two
      </button>
    </>
  ),
  WorkspaceSelector: ({ trigger }: { trigger: React.ReactNode }) => <>{trigger}</>
}))

vi.mock('@renderer/hooks/agent/useTasks', () => {
  const subscribeTasks = (listener: () => void) => {
    tasksVersionMock.listeners.add(listener)
    return () => tasksVersionMock.listeners.delete(listener)
  }
  return {
    // Mirrors SWR semantics: refetch bumps a version the hook subscribes to,
    // so consumers re-render and read the updated taskDataMock state.
    useAllTasks: () => {
      React.useSyncExternalStore(subscribeTasks, () => tasksVersionMock.version)
      return {
        tasks: taskDataMock.tasks ?? [taskDataMock.task],
        total: taskPaginationMock.total,
        page: taskPaginationMock.page,
        pageCount: taskPaginationMock.pageCount,
        error: null,
        isLoading: false,
        hasNext: taskPaginationMock.hasNext,
        hasPrev: taskPaginationMock.hasPrev,
        nextPage: taskMutationMocks.nextPage,
        prevPage: taskMutationMocks.prevPage,
        refetch: async () => {
          await taskMutationMocks.refetchTasks()
          tasksVersionMock.bump()
        }
      }
    },
    useCreateTask: () => ({ createTask: taskMutationMocks.createTask }),
    useDeleteTask: () => ({ deleteTask: taskMutationMocks.deleteTask }),
    useRunTask: () => ({ runTask: taskMutationMocks.runTask }),
    useTask: (taskId: string | null) => {
      React.useSyncExternalStore(subscribeTasks, () => tasksVersionMock.version)
      return {
        task: taskId === taskDataMock.task.id ? taskDataMock.task : undefined,
        error: null,
        isLoading: false
      }
    },
    useTaskLogs: () => taskLogsMock,
    useUpdateTask: () => ({ updateTask: taskMutationMocks.updateTask })
  }
})

vi.mock('@renderer/hooks/useConversationNavigation', () => ({
  useConversationNavigation: () => ({
    openConversation: navigationMocks.openConversation
  })
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openRoute: navigationMocks.openRoute
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params, to }: { children?: React.ReactNode; params: { taskId: string }; to: string }) => (
    <a
      href={to.replace('$taskId', params.taskId)}
      onClick={(event) => {
        event.preventDefault()
        void navigationMocks.navigate({ to, params })
      }}>
      {children}
    </a>
  ),
  useNavigate: () => navigationMocks.navigate,
  useParams: () => ({ taskId: navigationMocks.taskId })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => translationMock
}))

vi.mock('@cherrystudio/ui', () => {
  const DropdownContext = React.createContext<{
    open: boolean
    setOpen: (open: boolean) => void
  } | null>(null)
  const SelectContext = React.createContext<{
    disabled?: boolean
    onValueChange?: (value: string) => void
    value?: string
  } | null>(null)
  const TabsContext = React.createContext<{
    value: string
    setValue: (value: string) => void
  } | null>(null)

  const passthrough =
    (tag: keyof React.JSX.IntrinsicElements, slot?: string) =>
    ({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) =>
      React.createElement(tag, { className, 'data-slot': slot, ...props }, children)

  return {
    Alert: ({
      description,
      message,
      type = 'info'
    }: {
      description?: React.ReactNode
      message?: React.ReactNode
      type?: string
    }) => (
      <div role={type === 'error' ? 'alert' : 'status'} data-type={type}>
        {message}
        {description}
      </div>
    ),
    Badge: ({
      children,
      variant
    }: {
      children?: React.ReactNode
      variant?: 'default' | 'secondary' | 'destructive' | 'outline'
    }) => <span data-variant={variant}>{children}</span>,
    Button: ({
      children,
      disabled,
      loading,
      onClick,
      size,
      variant,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean
      size?: string
      variant?: string
    }) => {
      void size
      void variant
      return (
        <button
          type="button"
          data-size={size}
          data-variant={variant}
          disabled={disabled || Boolean(loading)}
          onClick={onClick}
          {...props}>
          {children}
        </button>
      )
    },
    Center: passthrough('div'),
    Combobox: ({
      disabled,
      multiple,
      onChange,
      options,
      placeholder,
      renderOption,
      searchable,
      searchPlaceholder,
      value
    }: {
      disabled?: boolean
      multiple?: boolean
      onChange?: (value: string | string[]) => void
      options?: Array<{ value: string; label: React.ReactNode }>
      placeholder?: React.ReactNode
      renderOption?: (option: { value: string; label: React.ReactNode }) => React.ReactNode
      searchable?: boolean
      searchPlaceholder?: string
      value?: string | string[]
    }) => (
      <div>
        {placeholder && <span>{placeholder}</span>}
        {searchable ? <input type="search" placeholder={searchPlaceholder} /> : null}
        {options?.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!multiple) {
                onChange?.(option.value)
                return
              }
              const current = Array.isArray(value) ? value : []
              onChange?.(
                current.includes(option.value)
                  ? current.filter((currentValue) => currentValue !== option.value)
                  : [...current, option.value]
              )
            }}>
            {renderOption ? renderOption(option) : option.label}
          </button>
        ))}
      </div>
    ),
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
        <div role="alertdialog">
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
      rowKey
    }: {
      columns: Array<{
        accessorKey?: string
        id?: string
        cell?: (context: { getValue: () => unknown; row: { original: Record<string, unknown> } }) => React.ReactNode
      }>
      data: Array<Record<string, unknown>>
      rowKey: string
    }) => (
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
    ),
    DateTimePicker: ({
      disabled,
      onChange,
      placeholder,
      value
    }: {
      disabled?: boolean
      onChange?: (date: Date | undefined) => void
      placeholder?: React.ReactNode
      value?: Date
    }) => (
      <button type="button" disabled={disabled} onClick={() => onChange?.(new Date('2026-08-01T09:30:00.000Z'))}>
        {value?.toISOString() ?? placeholder}
      </button>
    ),
    Dialog: ({ children, open }: { children?: React.ReactNode; open?: boolean }) => (open ? <>{children}</> : null),
    DialogContent: ({
      children,
      closeOnOverlayClick,
      size
    }: {
      children?: React.ReactNode
      closeOnOverlayClick?: boolean
      size?: string
    }) => {
      void closeOnOverlayClick
      return (
        <div role="dialog" data-size={size}>
          {children}
        </div>
      )
    },
    DialogDescription: passthrough('p'),
    DialogFooter: passthrough('div'),
    DialogHeader: passthrough('div'),
    DialogTitle: passthrough('h2'),
    Divider: passthrough('hr'),
    DropdownMenu: ({ children }: { children?: React.ReactNode }) => {
      const [open, setOpen] = React.useState(false)
      return <DropdownContext value={{ open, setOpen }}>{children}</DropdownContext>
    },
    DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => {
      const context = React.use(DropdownContext)
      return context?.open ? <div role="menu">{children}</div> : null
    },
    DropdownMenuGroup: passthrough('div'),
    DropdownMenuItem: ({
      children,
      disabled,
      onSelect
    }: {
      children?: React.ReactNode
      disabled?: boolean
      onSelect?: () => void
      variant?: string
    }) => (
      <button type="button" role="menuitem" disabled={disabled} onClick={onSelect}>
        {children}
      </button>
    ),
    DropdownMenuTrigger: ({ children }: { asChild?: boolean; children?: React.ReactNode }) => {
      const context = React.use(DropdownContext)
      if (React.isValidElement<{ onClick?: React.MouseEventHandler }>(children)) {
        // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild trigger behavior
        return React.cloneElement(children, {
          onClick: (event: React.MouseEvent) => {
            children.props.onClick?.(event)
            context?.setOpen(!context.open)
          }
        })
      }
      return <button type="button">{children}</button>
    },
    EmptyState: ({
      actionLabel,
      description,
      icon: Icon,
      onAction,
      title
    }: {
      actionLabel?: React.ReactNode
      description?: React.ReactNode
      icon?: React.ElementType
      onAction?: () => void
      title?: React.ReactNode
    }) => (
      <div>
        {Icon && <Icon data-testid="empty-state-icon" />}
        {title && <h2>{title}</h2>}
        {description && <p>{description}</p>}
        {actionLabel && onAction && (
          <button type="button" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    ),
    Field: ({
      children,
      orientation,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode; orientation?: string }) => {
      void orientation
      return (
        <div role="group" {...props}>
          {children}
        </div>
      )
    },
    FieldDescription: passthrough('p'),
    FieldError: ({ children }: { children?: React.ReactNode }) =>
      children ? <div role="alert">{children}</div> : null,
    FieldGroup: passthrough('div'),
    FieldLabel: ({
      children,
      required,
      ...props
    }: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) => (
      <label {...props}>
        {children}
        {required ? <span aria-hidden="true">*</span> : null}
      </label>
    ),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    InputGroup: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div data-slot="input-group" role="group" {...props}>
        {children}
      </div>
    ),
    InputGroupAddon: ({ align, children }: { align?: string; children?: React.ReactNode }) => {
      void align
      return <span>{children}</span>
    },
    InputGroupInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    InputGroupText: passthrough('span'),
    Item: ({ asChild, children }: { asChild?: boolean; children?: React.ReactNode; size?: string }) => {
      if (asChild && React.isValidElement(children)) {
        // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces the public Item asChild contract
        return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          'data-slot': 'item'
        })
      }
      return <div data-slot="item">{children}</div>
    },
    ItemActions: passthrough('div', 'item-actions'),
    ItemContent: passthrough('div', 'item-content'),
    ItemDescription: passthrough('p', 'item-description'),
    ItemGroup: ({ children }: { children?: React.ReactNode }) => <div role="list">{children}</div>,
    ItemMedia: passthrough('div', 'item-media'),
    ItemSeparator: () => <hr />,
    ItemTitle: passthrough('div', 'item-title'),
    RowFlex: passthrough('div'),
    Scrollbar: passthrough('div', 'scrollbar'),
    SearchInput: ({
      'aria-label': ariaLabel,
      clearLabel,
      onChange,
      onClear,
      placeholder,
      value
    }: {
      'aria-label'?: string
      clearLabel?: string
      onChange?: React.ChangeEventHandler<HTMLInputElement>
      onClear?: () => void
      placeholder?: string
      value?: string
    }) => (
      <div>
        <input aria-label={ariaLabel} type="search" placeholder={placeholder} value={value} onChange={onChange} />
        {value && onClear && (
          <button type="button" aria-label={clearLabel} onClick={onClear}>
            {clearLabel}
          </button>
        )}
      </div>
    ),
    Select: ({
      children,
      disabled,
      onValueChange,
      value
    }: {
      children?: React.ReactNode
      disabled?: boolean
      onValueChange?: (value: string) => void
      value?: string
    }) => <SelectContext value={{ disabled, onValueChange, value }}>{children}</SelectContext>,
    SelectContent: ({ children }: { children?: React.ReactNode }) => <div role="listbox">{children}</div>,
    SelectGroup: passthrough('div'),
    SelectItem: ({ children, disabled, value }: { children?: React.ReactNode; disabled?: boolean; value: string }) => {
      const context = React.use(SelectContext)
      return (
        <button
          type="button"
          role="option"
          aria-selected={context?.value === value}
          disabled={disabled || context?.disabled}
          onClick={() => context?.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectTrigger: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => {
      const context = React.use(SelectContext)
      return (
        <button type="button" role="combobox" data-value={context?.value} disabled={context?.disabled} {...props}>
          {children}
          {context?.value}
        </button>
      )
    },
    SelectValue: ({ placeholder }: { placeholder?: React.ReactNode }) => <>{placeholder}</>,
    Spinner: ({ text }: { text?: React.ReactNode }) => <div>{text}</div>,
    Switch: ({
      checked,
      disabled,
      onCheckedChange,
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
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      />
    ),
    Tabs: ({
      children,
      defaultValue,
      value
    }: {
      children?: React.ReactNode
      defaultValue?: string
      value?: string
      variant?: string
    }) => {
      const [internalValue, setInternalValue] = React.useState(defaultValue ?? '')
      return (
        <TabsContext value={{ value: value ?? internalValue, setValue: setInternalValue }}>
          <div data-slot="tabs">{children}</div>
        </TabsContext>
      )
    },
    TabsContent: ({ children, value }: { children?: React.ReactNode; value: string }) => {
      const context = React.use(TabsContext)
      return context?.value === value ? <div role="tabpanel">{children}</div> : null
    },
    TabsList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div role="tablist" {...props}>
        {children}
      </div>
    ),
    TabsTrigger: ({ children, value }: { children?: React.ReactNode; value: string }) => {
      const context = React.use(TabsContext)
      return (
        <button
          type="button"
          role="tab"
          aria-selected={context?.value === value}
          onClick={() => context?.setValue(value)}>
          {children}
        </button>
      )
    },
    Textarea: {
      Input: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />
    },
    Tooltip: ({ children }: { children?: React.ReactNode; title?: React.ReactNode }) => <>{children}</>
  }
})

describe('scheduled task frequency conversion', () => {
  const timeoutMinutes = ''

  it.each([
    {
      name: 'hourly',
      form: { kind: 'hourly', value: '', weekday: '1', timeoutMinutes },
      trigger: { kind: 'cron', expr: '0 * * * *' }
    },
    {
      name: 'daily',
      form: { kind: 'daily', value: '09:30', weekday: '1', timeoutMinutes },
      trigger: { kind: 'cron', expr: '30 9 * * *' }
    },
    {
      name: 'weekdays',
      form: { kind: 'weekdays', value: '18:05', weekday: '1', timeoutMinutes },
      trigger: { kind: 'cron', expr: '5 18 * * 1-5' }
    },
    {
      name: 'weekly',
      form: { kind: 'weekly', value: '07:45', weekday: '3', timeoutMinutes },
      trigger: { kind: 'cron', expr: '45 7 * * 3' }
    },
    {
      name: 'custom interval',
      form: { kind: 'interval', value: '15', weekday: '1', timeoutMinutes },
      trigger: { kind: 'interval', ms: 900_000 }
    },
    {
      name: 'one time',
      form: { kind: 'once', value: '2026-08-01T09:30:00.000Z', weekday: '1', timeoutMinutes },
      trigger: { kind: 'once', at: 1_785_576_600_000 }
    }
  ] satisfies Array<{ name: string; form: ScheduleFormState; trigger: Record<string, unknown> }>)(
    'converts the $name preset to the existing Trigger contract',
    ({ form, trigger }) => {
      expect(formStateToTrigger(form)).toEqual(trigger)
    }
  )

  it.each([
    [{ kind: 'cron' as const, expr: '0 * * * *' }, 'hourly'],
    [{ kind: 'cron' as const, expr: '0 9 * * *' }, 'daily'],
    [{ kind: 'cron' as const, expr: '30 10 * * 1-5' }, 'weekdays'],
    [{ kind: 'cron' as const, expr: '15 8 * * 4' }, 'weekly'],
    [{ kind: 'interval' as const, ms: 1_800_000 }, 'interval'],
    [{ kind: 'once' as const, at: 1_785_576_600_000 }, 'once']
  ])('recognizes a common Trigger as %s', (trigger, kind) => {
    expect(triggerToFormState(trigger).kind).toBe(kind)
  })

  it('preserves an existing complex Cron without making it a selectable preset', () => {
    const trigger = { kind: 'cron' as const, expr: '*/15 9-17 * * MON-FRI' }
    const form = {
      ...triggerToFormState(trigger),
      timeoutMinutes
    }

    expect(form).toEqual({
      kind: 'cron',
      value: '*/15 9-17 * * MON-FRI',
      weekday: '1',
      timeoutMinutes
    })
    expect(formStateToTrigger(form)).toEqual(trigger)
  })
})

describe('TasksSettings routing and creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.taskId = 'task-1'
    navigationMocks.navigate.mockResolvedValue(undefined)
    agentDataMock.agents = [{ id: 'agent-1', name: 'Agent One', configuration: {} }]
    taskDataMock.task = { ...taskDataMock.defaultTask }
    taskLogsMock.logs = [taskLogsMock.defaultTaskLog]
    taskLogsMock.isLoading = false
    taskLogsMock.error = null
    channelDataMock.channels = []
    channelDataMock.isLoading = false
    taskDataMock.tasks = null
    taskPaginationMock.page = 1
    taskPaginationMock.pageCount = 1
    taskPaginationMock.total = 1
    taskPaginationMock.hasNext = false
    taskPaginationMock.hasPrev = false
    taskMutationMocks.createTask.mockResolvedValue(undefined)
    taskMutationMocks.deleteTask.mockResolvedValue(true)
    taskMutationMocks.refetchTasks.mockResolvedValue(undefined)
    taskMutationMocks.runTask.mockResolvedValue(true)
    taskMutationMocks.updateTask.mockResolvedValue(taskDataMock.task)
  })

  it('renders only the full-width task list on the base route', async () => {
    navigationMocks.taskId = undefined

    render(<TasksSettings />)

    const taskLink = await screen.findByRole('link', { name: /Daily task/ })
    expect(taskLink).toHaveAttribute('href', '/settings/scheduled-tasks/task-1')
    expect(screen.queryByDisplayValue('Run daily summary')).not.toBeInTheDocument()

    fireEvent.click(taskLink)
    expect(navigationMocks.navigate).toHaveBeenCalledWith({
      to: '/settings/scheduled-tasks/$taskId',
      params: { taskId: 'task-1' }
    })
  })

  it('navigates all task-list pages instead of stopping at the first page', async () => {
    navigationMocks.taskId = undefined
    taskPaginationMock.total = 51
    taskPaginationMock.pageCount = 2
    taskPaginationMock.hasNext = true
    taskPaginationMock.hasPrev = true

    render(<TasksSettings />)

    await screen.findByText('settings.scheduledTasks.paginationStatus')
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.previous' }))

    expect(taskMutationMocks.nextPage).toHaveBeenCalledTimes(1)
    expect(taskMutationMocks.prevPage).toHaveBeenCalledTimes(1)
  })

  it('searches tasks and filters them by Agent and status', async () => {
    navigationMocks.taskId = undefined
    agentDataMock.agents = [
      { id: 'agent-1', name: 'Agent One', configuration: {} },
      { id: 'agent-2', name: 'Agent Two', configuration: {} }
    ]
    const pausedTask = {
      ...taskDataMock.defaultTask,
      id: 'task-2',
      agentId: 'agent-2',
      name: 'Weekly review',
      status: 'paused' as const
    }
    taskDataMock.tasks = [taskDataMock.defaultTask, pausedTask]

    render(<TasksSettings />)

    expect(await screen.findByRole('link', { name: /Daily task/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Weekly review/ })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'settings.scheduledTasks.search' }), {
      target: { value: 'weekly' }
    })
    expect(screen.queryByRole('link', { name: /Daily task/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Weekly review/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))
    fireEvent.click(screen.getByRole('option', { name: 'Agent Two' }))
    expect(screen.queryByRole('link', { name: /Daily task/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Weekly review/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'agent.tasks.status.active' }))
    expect(screen.getByText('settings.scheduledTasks.noMatchesTitle')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'settings.scheduledTasks.clearFilters' }))
    expect(screen.getByRole('link', { name: /Daily task/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Weekly review/ })).toBeInTheDocument()
  })

  it('opens a task detail route and returns to the list', async () => {
    render(<TasksSettings />)

    const backButton = await screen.findByRole('button', { name: 'common.back' })
    expect(backButton).toHaveTextContent('Daily task')
    expect(backButton).not.toHaveTextContent('settings.scheduledTasks.title')
    expect(backButton).toHaveAttribute('data-size', 'lg')
    expect(screen.queryByRole('textbox', { name: 'agent.tasks.name.label' })).not.toBeInTheDocument()
    fireEvent.click(backButton)

    expect(navigationMocks.navigate).toHaveBeenCalledWith({ to: '/settings/scheduled-tasks' })
  })

  it('loads a task detail independently from the current list page', async () => {
    taskDataMock.tasks = []
    taskPaginationMock.total = 501
    taskPaginationMock.pageCount = 11

    render(<TasksSettings />)

    expect(await screen.findByText('Daily task')).toBeInTheDocument()
    expect(screen.queryByText('settings.scheduledTasks.notFoundTitle')).not.toBeInTheDocument()
  })

  it('shows a recoverable empty state for an invalid task id', async () => {
    navigationMocks.taskId = 'missing-task'

    render(<TasksSettings />)

    expect(await screen.findByText('settings.scheduledTasks.notFoundTitle')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }))
    expect(navigationMocks.navigate).toHaveBeenCalledWith({ to: '/settings/scheduled-tasks' })
  })

  it('returns to the list after deleting a task', async () => {
    render(<TasksSettings />)

    await screen.findByText('Daily task')
    fireEvent.click(screen.getByRole('button', { name: 'common.more' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'agent.tasks.delete.label' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'agent.tasks.delete.label' }))

    await waitFor(() => expect(taskMutationMocks.deleteTask).toHaveBeenCalledWith('agent-1', 'task-1'))
    expect(navigationMocks.navigate).toHaveBeenCalledWith({ to: '/settings/scheduled-tasks' })
    expect(taskMutationMocks.refetchTasks).not.toHaveBeenCalled()
  })

  it('disables only manual creation when no Agent exists', async () => {
    navigationMocks.taskId = undefined
    agentDataMock.agents = []
    taskDataMock.tasks = []

    render(<TasksSettings />)

    await screen.findByText('settings.scheduledTasks.noAgentsTitle')
    fireEvent.click(screen.getByRole('button', { name: 'settings.scheduledTasks.newTask' }))

    expect(screen.getByRole('menuitem', { name: 'settings.scheduledTasks.manualCreate' })).toBeDisabled()
    const agentCreate = screen.getByRole('menuitem', { name: 'settings.scheduledTasks.agentCreate' })
    expect(agentCreate).toBeEnabled()
    fireEvent.click(agentCreate)
    expect(navigationMocks.openRoute).toHaveBeenCalledWith('/app/agents')
  })

  it('centers the empty state in the remaining page height', async () => {
    navigationMocks.taskId = undefined
    taskDataMock.tasks = []

    render(<TasksSettings />)

    const emptyState = (await screen.findByText('settings.scheduledTasks.noTasksTitle')).parentElement
    expect(screen.getByTestId('empty-state-icon')).toHaveClass('lucide-calendar-clock')
    expect(emptyState?.parentElement).toHaveClass('flex', 'flex-1', 'flex-col')
    expect(emptyState?.parentElement?.parentElement).toHaveClass('flex', 'min-h-full', 'flex-col')
  })

  it('opens a public xl Dialog with a daily 09:00 default', async () => {
    navigationMocks.taskId = undefined

    render(<TasksSettings />)

    await screen.findByRole('link', { name: /Daily task/ })
    fireEvent.click(screen.getByRole('button', { name: 'settings.scheduledTasks.newTask' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'settings.scheduledTasks.manualCreate' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-size', 'xl')
    expect(within(dialog).getByText('settings.scheduledTasks.createTitle')).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'agent.tasks.frequency.label' })).toHaveAttribute(
      'data-value',
      'daily'
    )
    const timeSelect = within(dialog).getByRole('group', { name: 'agent.tasks.schedule.time' })
    expect(within(timeSelect).getByRole('combobox', { name: 'agent.tasks.schedule.hour' })).toHaveAttribute(
      'data-value',
      '09'
    )
    expect(within(timeSelect).getByRole('combobox', { name: 'agent.tasks.schedule.minute' })).toHaveAttribute(
      'data-value',
      '00'
    )
    expect(within(dialog).queryByRole('option', { name: 'agent.tasks.schedule.advanced' })).not.toBeInTheDocument()
    expect(within(dialog).queryByText('agent.tasks.schedule.description')).not.toBeInTheDocument()

    expect(within(dialog).getByRole('textbox', { name: 'agent.tasks.name.label' })).toBeRequired()
    expect(
      within(dialog).getByRole('textbox', { name: 'agent.tasks.name.label' }).closest('[data-slot="scrollbar"]')
    ).toHaveClass('-m-1', 'p-1', 'pr-3')
    const promptInput = within(dialog).getByLabelText('agent.tasks.prompt.label')
    expect(promptInput).toHaveStyle({ minHeight: '100px' })
    const promptEditor = promptInput.closest('[data-slot="prompt-editor-field"]')
    expect(promptEditor).not.toBeNull()
    expect(
      within(promptEditor as HTMLElement).getByRole('button', { name: 'library.config.prompt.generate' })
    ).toBeInTheDocument()
    expect(promptPolishActionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emptyValueSystemPrompt: expect.stringContaining('scheduled Agent task'),
        existingValueSystemPrompt: expect.stringContaining('scheduled task prompt')
      })
    )
    expect(promptPolishActionsMock.mock.lastCall?.[0].emptyValueSystemPrompt).toContain(
      'Do not create a persona, role profile'
    )
    const taskInputGroup = promptInput.closest('[data-task-input-context]')
    expect(taskInputGroup).not.toBeNull()
    expect(
      within(taskInputGroup as HTMLElement).getByRole('button', { name: 'agent.channels.bindAgent' })
    ).toBeInTheDocument()
    expect(
      within(taskInputGroup as HTMLElement).getByRole('button', { name: 'agent.session.display.workdir' })
    ).toBeInTheDocument()

    expect(within(dialog).getByRole('button', { name: 'common.cancel' })).toHaveAttribute('data-variant', 'outline')
    expect(within(dialog).getByRole('button', { name: 'common.cancel' })).not.toHaveAttribute('data-size')
    expect(within(dialog).getByRole('button', { name: 'agent.tasks.save' })).not.toHaveAttribute('data-size')
  })

  it('uses shared schedule controls instead of native time and number widgets', async () => {
    navigationMocks.taskId = undefined

    render(<TasksSettings />)

    await screen.findByRole('link', { name: /Daily task/ })
    fireEvent.click(screen.getByRole('button', { name: 'settings.scheduledTasks.newTask' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'settings.scheduledTasks.manualCreate' }))

    const dialog = screen.getByRole('dialog')
    const timeSelect = within(dialog).getByRole('group', { name: 'agent.tasks.schedule.time' })
    const [hourOptions, minuteOptions] = within(timeSelect).getAllByRole('listbox')
    fireEvent.click(within(hourOptions).getByRole('option', { name: '18' }))
    fireEvent.click(within(minuteOptions).getByRole('option', { name: '05' }))

    expect(within(timeSelect).getByRole('combobox', { name: 'agent.tasks.schedule.hour' })).toHaveAttribute(
      'data-value',
      '18'
    )
    expect(within(timeSelect).getByRole('combobox', { name: 'agent.tasks.schedule.minute' })).toHaveAttribute(
      'data-value',
      '05'
    )

    const timeoutInput = within(dialog).getByLabelText('agent.tasks.timeout.label')
    expect(timeoutInput).toHaveAttribute('type', 'text')
    expect(timeoutInput).toHaveAttribute('inputmode', 'numeric')
  })

  it('marks required fields invalid after an attempted create', async () => {
    navigationMocks.taskId = undefined
    agentDataMock.agents = [
      { id: 'agent-1', name: 'Agent One', configuration: {} },
      { id: 'agent-2', name: 'Agent Two', configuration: {} }
    ]

    render(<TasksSettings />)

    await screen.findByRole('link', { name: /Daily task/ })
    fireEvent.click(screen.getByRole('button', { name: 'settings.scheduledTasks.newTask' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'settings.scheduledTasks.manualCreate' }))
    fireEvent.click(screen.getByRole('button', { name: 'agent.tasks.save' }))

    expect(screen.getByRole('button', { name: 'agent.channels.bindAgent' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: 'agent.tasks.name.label' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('agent.tasks.prompt.label')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByRole('alert')).toHaveLength(3)
  })

  it('keeps the Dialog open when creation fails', async () => {
    navigationMocks.taskId = undefined

    render(<TasksSettings />)

    await screen.findByRole('link', { name: /Daily task/ })
    fireEvent.click(screen.getByRole('button', { name: 'settings.scheduledTasks.newTask' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'settings.scheduledTasks.manualCreate' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'agent.channels.bindAgent' })).toHaveTextContent('Agent One')
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'agent.tasks.name.label' }), {
      target: { value: 'Review code' }
    })
    fireEvent.change(screen.getByLabelText('agent.tasks.prompt.label'), { target: { value: 'Review the repository' } })
    fireEvent.click(screen.getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() => expect(taskMutationMocks.createTask).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(navigationMocks.navigate).not.toHaveBeenCalled()
  })

  it('closes the Dialog and navigates to the new detail after a successful create', async () => {
    navigationMocks.taskId = undefined
    const created = { ...taskDataMock.defaultTask, id: 'task-new', name: 'Review code' }
    taskMutationMocks.createTask.mockResolvedValue(created)

    render(<TasksSettings />)

    await screen.findByRole('link', { name: /Daily task/ })
    fireEvent.click(screen.getByRole('button', { name: 'settings.scheduledTasks.newTask' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'settings.scheduledTasks.manualCreate' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'agent.channels.bindAgent' })).toHaveTextContent('Agent One')
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'agent.tasks.name.label' }), {
      target: { value: 'Review code' }
    })
    fireEvent.change(screen.getByLabelText('agent.tasks.prompt.label'), { target: { value: 'Review the repository' } })
    fireEvent.click(screen.getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() =>
      expect(taskMutationMocks.createTask).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({
          name: 'Review code',
          prompt: 'Review the repository',
          trigger: { kind: 'cron', expr: '0 9 * * *' },
          timeoutMinutes: null
        })
      )
    )
    await waitFor(() =>
      expect(navigationMocks.navigate).toHaveBeenCalledWith({
        to: '/settings/scheduled-tasks/$taskId',
        params: { taskId: 'task-new' }
      })
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(taskMutationMocks.refetchTasks).not.toHaveBeenCalled()
  })
})

describe('TasksSettings detail behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.taskId = 'task-1'
    navigationMocks.navigate.mockResolvedValue(undefined)
    agentDataMock.agents = [{ id: 'agent-1', name: 'Agent One', configuration: {} }]
    taskDataMock.task = { ...taskDataMock.defaultTask }
    taskLogsMock.logs = [taskLogsMock.defaultTaskLog]
    taskLogsMock.isLoading = false
    taskLogsMock.error = null
    channelDataMock.channels = []
    channelDataMock.isLoading = false
    taskDataMock.tasks = null
    taskPaginationMock.page = 1
    taskPaginationMock.pageCount = 1
    taskPaginationMock.total = 1
    taskPaginationMock.hasNext = false
    taskPaginationMock.hasPrev = false
    taskMutationMocks.deleteTask.mockResolvedValue(true)
    taskMutationMocks.refetchTasks.mockResolvedValue(undefined)
    taskMutationMocks.runTask.mockResolvedValue(true)
    taskMutationMocks.updateTask.mockResolvedValue(taskDataMock.task)
  })

  it('keeps task logs searchable and opens the related session', async () => {
    taskLogsMock.logs = [
      taskLogsMock.defaultTaskLog,
      { ...taskLogsMock.defaultTaskLog, id: 'log-2', sessionId: null, result: 'other result' }
    ]

    render(<TasksSettings />)

    fireEvent.click(await screen.findByRole('tab', { name: 'agent.tasks.logs.label' }))
    fireEvent.change(await screen.findByPlaceholderText('agent.tasks.logs.search'), { target: { value: 'done' } })
    expect(screen.getByText('done')).toBeInTheDocument()
    expect(screen.getByText('done')).toHaveClass('line-clamp-4')
    expect(screen.queryByText('other result')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'agent.tasks.logs.viewSession' }))
    expect(navigationMocks.openConversation).toHaveBeenCalledWith('session-1')
  })

  it('filters channels to the owning Agent and uses Alert for delivery warnings', async () => {
    taskDataMock.task = { ...taskDataMock.defaultTask, channelIds: ['channel-agent-1'] }
    channelDataMock.channels = [
      {
        id: 'channel-agent-1',
        agentId: 'agent-1',
        name: 'Agent One Telegram',
        isActive: true,
        activeChatIds: []
      },
      {
        id: 'channel-agent-2',
        agentId: 'agent-2',
        name: 'Agent Two Slack',
        isActive: true,
        activeChatIds: ['chat-2']
      }
    ]

    render(<TasksSettings />)

    fireEvent.click(await screen.findByRole('tab', { name: 'settings.general.title' }))
    expect(await screen.findByText('Agent One Telegram')).toBeInTheDocument()
    expect(screen.queryByText('Agent Two Slack')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('agent.tasks.channels.placeholder')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('agent.tasks.channels.noActiveChatIds')
  })

  it('keeps the detail read-only and edits through the shared task Dialog', async () => {
    taskMutationMocks.updateTask.mockImplementationOnce(async () => {
      taskDataMock.task = { ...taskDataMock.task, name: 'Server-normalized task name' }
      tasksVersionMock.bump()
      return taskDataMock.task
    })

    render(<TasksSettings />)

    await screen.findByText('Daily task')
    expect(screen.queryByRole('textbox', { name: 'agent.tasks.name.label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'agent.tasks.frequency.label' })).not.toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Daily task' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'agent.tasks.prompt.label' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('settings.scheduledTasks.editTitle')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'agent.tasks.name.label' })).toHaveValue('Daily task')

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'agent.tasks.name.label' }), {
      target: { value: 'Edited task name' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', { name: 'Edited task name' })
    )
    await waitFor(() => expect(screen.getByText('Server-normalized task name')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(taskMutationMocks.refetchTasks).not.toHaveBeenCalled()
  })

  it('persists the simplified interval editor through the shared edit Dialog', async () => {
    render(<TasksSettings />)

    await screen.findByText('Daily task')
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const dialog = screen.getByRole('dialog')
    const intervalInput = within(dialog).getByPlaceholderText('agent.tasks.intervalPlaceholder')
    expect(within(dialog).getByRole('combobox', { name: 'agent.tasks.frequency.label' })).toHaveAttribute(
      'data-value',
      'interval'
    )
    fireEvent.change(intervalInput, { target: { value: '15' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith(
        'agent-1',
        'task-1',
        expect.objectContaining({
          trigger: { kind: 'interval', ms: 900_000 }
        })
      )
    )
  })

  it('does not rewrite an unchanged unlimited timeout', async () => {
    taskDataMock.task = { ...taskDataMock.defaultTask, timeoutMinutes: 0 }

    render(<TasksSettings />)

    fireEvent.click(await screen.findByRole('tab', { name: 'settings.general.title' }))
    expect(await screen.findByText('agent.tasks.timeout.placeholder')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('agent.tasks.timeout.label')).toHaveValue('')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'agent.tasks.name.label' }), {
      target: { value: 'Renamed task' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', { name: 'Renamed task' })
    )
  })

  it.each([
    {
      name: 'cron timezone and limit',
      trigger: { kind: 'cron' as const, expr: '*/15 9-17 * * 1-5', timezone: 'Asia/Shanghai', limit: 12 }
    },
    {
      name: 'interval anchor and exact milliseconds',
      trigger: { kind: 'interval' as const, ms: 90_001, anchor: 'createdAt' as const }
    }
  ])('preserves $name when editing another field', async ({ trigger }) => {
    taskDataMock.task = { ...taskDataMock.defaultTask, trigger }

    render(<TasksSettings />)

    await screen.findByText('Daily task')
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'agent.tasks.name.label' }), {
      target: { value: 'Renamed task' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', { name: 'Renamed task' })
    )
  })

  it('preserves an interval anchor when the interval changes', async () => {
    taskDataMock.task = {
      ...taskDataMock.defaultTask,
      trigger: { kind: 'interval', ms: 60_000, anchor: 'createdAt' }
    }

    render(<TasksSettings />)

    await screen.findByText('Daily task')
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('agent.tasks.intervalPlaceholder'), {
      target: { value: '15' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', {
        trigger: { kind: 'interval', ms: 900_000, anchor: 'createdAt' }
      })
    )
  })

  it('reassigns an edited task to another Agent and clears incompatible channels', async () => {
    agentDataMock.agents = [
      { id: 'agent-1', name: 'Agent One', configuration: {} },
      { id: 'agent-2', name: 'Agent Two', configuration: {} }
    ]
    taskDataMock.task = { ...taskDataMock.defaultTask, channelIds: ['channel-agent-1'] }
    channelDataMock.channels = [
      {
        id: 'channel-agent-1',
        agentId: 'agent-1',
        name: 'Agent One Telegram',
        isActive: true,
        activeChatIds: ['chat-1']
      }
    ]

    render(<TasksSettings />)

    await screen.findByText('Daily task')
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const dialog = screen.getByRole('dialog')
    const agentTrigger = within(dialog).getByRole('button', { name: 'agent.channels.bindAgent' })
    expect(agentTrigger).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'select Agent Two' }))
    expect(agentTrigger).toHaveTextContent('Agent Two')
    fireEvent.click(within(dialog).getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith(
        'agent-1',
        'task-1',
        expect.objectContaining({
          agentId: 'agent-2',
          channelIds: []
        })
      )
    )
  })

  it('shows each channel enabled state inside the channel selector options', async () => {
    channelDataMock.channels = [
      { id: 'channel-on', agentId: 'agent-1', name: 'Active channel', isActive: true, activeChatIds: ['chat-1'] },
      { id: 'channel-off', agentId: 'agent-1', name: 'Inactive channel', isActive: false, activeChatIds: ['chat-2'] }
    ]

    render(<TasksSettings />)

    await screen.findByText('Daily task')
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))

    const activeStatus = await screen.findByText('common.enabled')
    expect(activeStatus).toHaveClass('sr-only')
    expect(activeStatus.parentElement).toHaveTextContent('Active channel')
    const inactiveStatus = screen.getByText('common.disabled')
    expect(inactiveStatus).toHaveClass('sr-only')
    expect(inactiveStatus.parentElement).toHaveTextContent('Inactive channel')
  })

  it('skips a queued run after a failed save but still lets a queued pause through', async () => {
    let resolveFirstSave!: (value: unknown) => void
    taskMutationMocks.updateTask.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve
        })
    )

    render(<TasksSettings />)

    const statusSwitch = await screen.findByRole('switch', { name: 'agent.tasks.status.active' })
    fireEvent.click(statusSwitch)
    fireEvent.click(screen.getByRole('button', { name: 'agent.tasks.run' }))
    fireEvent.click(statusSwitch)
    await waitFor(() => expect(taskMutationMocks.updateTask).toHaveBeenCalledTimes(1))
    resolveFirstSave(undefined)

    await waitFor(() => expect(taskMutationMocks.updateTask).toHaveBeenCalledTimes(2))
    expect(taskMutationMocks.updateTask).toHaveBeenLastCalledWith('agent-1', 'task-1', { enabled: false })
    expect(taskMutationMocks.runTask).not.toHaveBeenCalled()
  })

  it('defers a queued run until the pending status update succeeds', async () => {
    let resolveFirstSave!: (value: unknown) => void
    taskMutationMocks.updateTask.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = resolve
        })
    )

    render(<TasksSettings />)

    const statusSwitch = await screen.findByRole('switch', { name: 'agent.tasks.status.active' })
    fireEvent.click(statusSwitch)
    fireEvent.click(screen.getByRole('button', { name: 'agent.tasks.run' }))
    await waitFor(() => expect(taskMutationMocks.updateTask).toHaveBeenCalledTimes(1))
    expect(taskMutationMocks.runTask).not.toHaveBeenCalled()

    resolveFirstSave({ ...taskDataMock.defaultTask, enabled: false, status: 'paused' })

    await waitFor(() => expect(taskMutationMocks.runTask).toHaveBeenCalledWith('task-1'))
    await waitFor(() => expect(taskMutationMocks.refetchTasks).toHaveBeenCalled())
  })

  it('keeps existing channel bindings when saving while channels are still loading', async () => {
    taskDataMock.task = { ...taskDataMock.defaultTask, channelIds: ['channel-agent-1'] }
    channelDataMock.channels = []
    channelDataMock.isLoading = true

    render(<TasksSettings />)

    await screen.findByText('Daily task')
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'agent.tasks.name.label' }), {
      target: { value: 'Renamed while loading' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'agent.tasks.save' }))

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith(
        'agent-1',
        'task-1',
        expect.objectContaining({
          name: 'Renamed while loading',
          channelIds: ['channel-agent-1']
        })
      )
    )
  })

  it('toggles task status from the semantic switch', async () => {
    render(<TasksSettings />)

    const statusSwitch = await screen.findByRole('switch', { name: 'agent.tasks.status.active' })
    expect(statusSwitch).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(statusSwitch)

    await waitFor(() =>
      expect(taskMutationMocks.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', { enabled: false })
    )
  })

  it('runs the task from the detail header action', async () => {
    render(<TasksSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'agent.tasks.run' }))

    await waitFor(() => expect(taskMutationMocks.runTask).toHaveBeenCalledWith('task-1'))
  })

  it('uses a neutral Badge and hides run/status controls for completed tasks', async () => {
    taskDataMock.task = {
      ...taskDataMock.defaultTask,
      enabled: false,
      status: 'completed'
    }

    render(<TasksSettings />)

    const completedBadge = await screen.findByText('agent.tasks.status.completed')
    expect(completedBadge).toHaveAttribute('data-variant', 'secondary')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agent.tasks.run' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.more' }))
    expect(screen.queryByRole('menuitem', { name: 'agent.tasks.run' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'agent.tasks.delete.label' })).toBeInTheDocument()
  })
})
