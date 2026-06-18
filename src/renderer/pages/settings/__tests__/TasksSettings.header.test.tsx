import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TasksSettings from '../TasksSettings'

const dataApiGetMock = vi.hoisted(() => vi.fn())
const updateTaskMock = vi.hoisted(() => vi.fn())
const runTaskMock = vi.hoisted(() => vi.fn())
const dateTimePickerPropsMock = vi.hoisted(() => vi.fn())
const translations = vi.hoisted(
  () =>
    ({
      'agent.cherryClaw.tasks.cronPlaceholder': '高级 Cron，例如 0 9 * * *（每天上午 9 点）',
      'agent.cherryClaw.tasks.delete.label': '删除',
      'agent.cherryClaw.tasks.frequency.daily': '每天',
      'agent.cherryClaw.tasks.frequency.interval': '间隔',
      'agent.cherryClaw.tasks.frequency.monthly': '每月',
      'agent.cherryClaw.tasks.frequency.once': '单次',
      'agent.cherryClaw.tasks.frequency.period': '周期',
      'agent.cherryClaw.tasks.frequency.weekly': '每周',
      'agent.cherryClaw.tasks.intervalUnit': '分钟',
      'agent.cherryClaw.tasks.lastRun': '上次运行',
      'agent.cherryClaw.tasks.logs.empty': '暂无运行历史。',
      'agent.cherryClaw.tasks.logs.label': '运行历史',
      'agent.cherryClaw.tasks.name.label': '名称',
      'agent.cherryClaw.tasks.nextRun': '下次运行',
      'agent.cherryClaw.tasks.oncePlaceholder': '选择日期和时间',
      'agent.cherryClaw.tasks.onceMustBeFuture': '请选择未来时间',
      'agent.cherryClaw.tasks.pause': '暂停',
      'agent.cherryClaw.tasks.prompt.label': '提示词',
      'agent.cherryClaw.tasks.resume': '恢复',
      'agent.cherryClaw.tasks.scheduleType.cron': 'Cron',
      'agent.cherryClaw.tasks.scheduleType.interval': '间隔',
      'agent.cherryClaw.tasks.scheduleType.once': '单次',
      'agent.cherryClaw.tasks.status.active': '活跃',
      'agent.cherryClaw.tasks.status.completed': '已完成',
      'agent.cherryClaw.tasks.status.paused': '已暂停',
      'agent.cherryClaw.tasks.testRun.description': '额外执行一次，不会消耗或重排触发器。',
      'agent.cherryClaw.tasks.testRun.label': '测试执行',
      'agent.cherryClaw.tasks.timeout.limited': '限制时长',
      'agent.cherryClaw.tasks.timeout.unlimited': '不限制',
      'common.loading': '加载中',
      'common.more': '更多',
      'settings.general.title': '通用',
      'settings.scheduledTasks.title': '定时任务'
    }) as Record<string, string>
)

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    i18n: { language: 'zh-cn' },
    t: (key: string, fallback?: string) => translations[key] ?? fallback ?? key
  })
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: {
    get: (...args: unknown[]) => dataApiGetMock(...args)
  }
}))

vi.mock('@renderer/hooks/agents/useChannels', () => ({
  useChannels: () => ({ channels: [] })
}))

vi.mock('@renderer/hooks/agents/useTasks', () => ({
  useCreateTask: () => ({ createTask: vi.fn() }),
  useDeleteTask: () => ({ deleteTask: vi.fn() }),
  useRunTask: () => ({ runTask: runTaskMock }),
  useTaskLogs: () => ({ logs: [], isLoading: false, error: null }),
  useUpdateTask: () => ({ updateTask: updateTaskMock })
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/MarqueeText', () => ({
  default: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="task-title-marquee" className={className}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/ListItem', () => ({
  default: ({ title, subtitle, icon, active, onClick }: any) => (
    <button type="button" data-active={active ? 'true' : 'false'} onClick={onClick}>
      {icon}
      <span>{title}</span>
      <span>{subtitle}</span>
    </button>
  )
}))

vi.mock('@cherrystudio/ui', async () => {
  const ReactRuntime = await import('react')
  const PopoverContext = ReactRuntime.createContext<{
    open: boolean
    onOpenChange?: (open: boolean) => void
  }>({ open: false })

  const Textarea = {
    Input: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />
  }

  return {
    Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
    Button: ({
      children,
      loading,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
      <button type="button" {...props} disabled={props.disabled || loading}>
        {children}
      </button>
    ),
    Combobox: () => null,
    ConfirmDialog: () => null,
    DataTable: () => null,
    DateTimePicker: (props: {
      placeholder?: string
      triggerClassName?: string
      granularity?: string
      format?: string
      onChange?: (date: Date | undefined) => void
      onOpenChange?: (open: boolean) => void
      open?: boolean
    }) => {
      dateTimePickerPropsMock(props)

      return (
        <button type="button" data-testid="task-once-picker" className={props.triggerClassName ?? 'w-60'}>
          {props.placeholder}
        </button>
      )
    },
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <>{children}</> : null),
    DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    Divider: () => <hr />,
    EmptyState: ({ description }: { description: string }) => <div>{description}</div>,
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    MenuItem: ({
      icon,
      label,
      description,
      descriptionClassName,
      ...props
    }: {
      icon?: ReactNode
      label: string
      description?: ReactNode
      descriptionClassName?: string
      [key: string]: unknown
    }) => (
      <button type="button" {...props}>
        {icon}
        <span>{label}</span>
        {description && <span className={descriptionClassName}>{description}</span>}
      </button>
    ),
    MenuList: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    Popover: ({
      children,
      open,
      onOpenChange
    }: {
      children: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => <PopoverContext value={{ open: Boolean(open), onOpenChange }}>{children}</PopoverContext>,
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const { open } = ReactRuntime.use(PopoverContext)
      return open ? <div>{children}</div> : null
    },
    PopoverTrigger: ({ children, asChild }: { children: ReactNode; asChild?: boolean }) => {
      const { open, onOpenChange } = ReactRuntime.use(PopoverContext)

      if (asChild) {
        return <div onClick={() => onOpenChange?.(!open)}>{children}</div>
      }

      return (
        <button type="button" onClick={() => onOpenChange?.(!open)}>
          {children}
        </button>
      )
    },
    SegmentedControl: ({ options }: { options: Array<{ value: string; label: string }> }) => (
      <div>
        {options.map((option) => (
          <button key={option.value} type="button">
            {option.label}
          </button>
        ))}
      </div>
    ),
    Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
    SelectValue: () => null,
    Spinner: ({ text }: { text: string }) => <div>{text}</div>,
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked ? 'true' : 'false'}
        {...props}
        onClick={(event) => {
          props.onClick?.(event)
          onCheckedChange?.(!checked)
        }}
      />
    ),
    Textarea,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }
})

const activeTask = {
  id: 'task-1',
  agentId: 'agent-1',
  name: '每日代码审查',
  prompt: '检查今日提交',
  trigger: { kind: 'interval', ms: 30 * 60_000 },
  status: 'active',
  lastRun: '2026-06-17T06:05:00.000Z',
  nextRun: '2026-06-17T06:35:00.000Z',
  timeoutMinutes: null,
  channelIds: []
}

const completedTask = {
  ...activeTask,
  id: 'task-2',
  name: '一次性汇总',
  status: 'completed'
}

const pausedTask = {
  ...activeTask,
  id: 'task-3',
  name: '暂停任务',
  status: 'paused'
}

const periodTask = {
  ...activeTask,
  id: 'task-4',
  name: '每日周期任务',
  trigger: { kind: 'period', period: 'daily', time: '09:00' }
}

const complexCronTask = {
  ...activeTask,
  id: 'task-5',
  name: '工作日 Cron 任务',
  trigger: { kind: 'cron', expr: '*/15 9-17 * * 1-5' }
}

const onceTask = {
  ...activeTask,
  id: 'task-6',
  name: '单次任务',
  trigger: { kind: 'once', at: Date.parse('2026-06-25T09:00:00.000Z') }
}

type MockTask =
  | typeof activeTask
  | typeof completedTask
  | typeof pausedTask
  | typeof periodTask
  | typeof complexCronTask
  | typeof onceTask

function mockData(tasks: MockTask[] = [activeTask]) {
  dataApiGetMock.mockImplementation((path: string) => {
    if (path === '/agents') {
      return Promise.resolve({
        items: [
          {
            id: 'agent-1',
            name: 'Codex',
            configuration: { soul_enabled: true }
          }
        ]
      })
    }
    if (path === '/agents/agent-1/tasks') {
      return Promise.resolve({ items: tasks })
    }
    return Promise.resolve({ items: [] })
  })
}

describe('TasksSettings header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runTaskMock.mockReturnValue(new Promise(() => {}))
    mockData()
    window.toast = {
      error: vi.fn()
    } as unknown as typeof window.toast
  })

  it('uses explicit header actions for an active task', async () => {
    render(<TasksSettings />)

    expect(await screen.findAllByText('每日代码审查')).toHaveLength(2)
    expect(screen.getByTestId('task-title-marquee')).toHaveClass('text-base', 'leading-8')
    expect(screen.getByTitle('每日代码审查')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toHaveClass('text-foreground-muted', 'text-sm', 'leading-5')
    expect(screen.queryByRole('button', { name: '测试执行' })).not.toBeInTheDocument()
    expect(screen.getByText('间隔 · 30 分钟')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '暂停' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '更多' }))
    })

    expect(screen.getByRole('menuitem', { name: '测试执行' })).toBeInTheDocument()
    expect(screen.getByText('额外执行一次，不会消耗或重排触发器。')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: '测试执行' }))
    })

    await waitFor(() => {
      expect(runTaskMock).toHaveBeenCalledWith('task-1')
    })

    fireEvent.click(screen.getByRole('switch', { name: '暂停' }))

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('agent-1', 'task-1', { enabled: false })
    })
  })

  it('uses a resume action for a paused task', async () => {
    mockData([pausedTask])

    render(<TasksSettings />)

    expect(await screen.findAllByText('暂停任务')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: '恢复' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: '恢复' }))

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('agent-1', 'task-3', { enabled: true })
    })
  })

  it.each([
    [
      'period schedules separately from cron schedules',
      periodTask,
      '每日周期任务',
      'Codex · 周期',
      '周期 · 每天 09:00'
    ],
    [
      'complex cron schedules as cron schedules',
      complexCronTask,
      '工作日 Cron 任务',
      'Codex · Cron',
      'Cron · */15 9-17 * * 1-5'
    ]
  ])('labels %s', async (_case, task, title, listSubtitle, headerSchedule) => {
    mockData([task])

    render(<TasksSettings />)

    expect(await screen.findAllByText(title)).toHaveLength(2)
    expect(screen.getByText(listSubtitle)).toBeInTheDocument()
    expect(await screen.findByText(headerSchedule)).toBeInTheDocument()
  })

  it('keeps period schedule edits in the period shape', async () => {
    mockData([periodTask])

    render(<TasksSettings />)

    expect(await screen.findAllByText('每日周期任务')).toHaveLength(2)
    const timeInput = screen.getByDisplayValue('09:00')

    fireEvent.change(timeInput, { target: { value: '10:30' } })
    fireEvent.blur(timeInput)

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('agent-1', 'task-4', {
        trigger: { kind: 'period', period: 'daily', time: '10:30' }
      })
    })
  })

  it('uses compact schedule controls for once and cron modes', async () => {
    mockData([onceTask])
    const { unmount } = render(<TasksSettings />)

    expect(await screen.findAllByText('单次任务')).toHaveLength(2)
    expect(screen.getByTestId('task-once-picker')).toHaveClass('w-60')
    expect(dateTimePickerPropsMock).toHaveBeenCalled()
    const oncePickerProps = dateTimePickerPropsMock.mock.calls[dateTimePickerPropsMock.mock.calls.length - 1][0]
    expect(oncePickerProps).toMatchObject({
      format: 'yyyy-MM-dd HH:mm',
      granularity: 'minute'
    })

    unmount()
    mockData([complexCronTask])
    render(<TasksSettings />)

    expect(await screen.findAllByText('工作日 Cron 任务')).toHaveLength(2)
    expect(screen.getByPlaceholderText('高级 Cron，例如 0 9 * * *（每天上午 9 点）')).toHaveClass('w-72', 'max-w-full')
  })

  it('hides run and auto-run controls for a completed task', async () => {
    mockData([completedTask])

    render(<TasksSettings />)

    expect(await screen.findAllByText('一次性汇总')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '测试执行' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '暂停' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: '恢复' })).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '更多' }))
    })

    expect(screen.queryByRole('menuitem', { name: '测试执行' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument()
  })

  it('keeps an invalid past once time as a draft and shows an error only when committing', async () => {
    mockData([onceTask])

    render(<TasksSettings />)

    expect(await screen.findAllByText('单次任务')).toHaveLength(2)
    expect(dateTimePickerPropsMock).toHaveBeenCalled()
    const oncePickerProps = dateTimePickerPropsMock.mock.calls[dateTimePickerPropsMock.mock.calls.length - 1][0]
    updateTaskMock.mockClear()

    act(() => {
      oncePickerProps.onChange?.(new Date(Date.now() - 60_000))
    })

    expect(window.toast.error).not.toHaveBeenCalled()
    expect(updateTaskMock).not.toHaveBeenCalled()

    const updatedOncePickerProps = dateTimePickerPropsMock.mock.calls[dateTimePickerPropsMock.mock.calls.length - 1][0]
    expect(updatedOncePickerProps.onOpenChange).toEqual(expect.any(Function))
    act(() => {
      updatedOncePickerProps.onOpenChange?.(false)
    })

    await waitFor(() => {
      expect(window.toast.error).toHaveBeenCalledWith('请选择未来时间')
    })
    expect(updateTaskMock).not.toHaveBeenCalled()
  })

  it('commits a future once draft only when the picker closes and normalizes seconds', async () => {
    mockData([onceTask])

    render(<TasksSettings />)

    expect(await screen.findAllByText('单次任务')).toHaveLength(2)
    expect(dateTimePickerPropsMock).toHaveBeenCalled()
    const oncePickerProps = dateTimePickerPropsMock.mock.calls[dateTimePickerPropsMock.mock.calls.length - 1][0]
    const futureDate = new Date(Date.now() + 60 * 60_000)
    futureDate.setSeconds(45, 678)
    const normalizedFutureDate = new Date(futureDate)
    normalizedFutureDate.setSeconds(0, 0)
    updateTaskMock.mockClear()

    act(() => {
      oncePickerProps.onChange?.(futureDate)
    })

    expect(updateTaskMock).not.toHaveBeenCalled()

    const updatedOncePickerProps = dateTimePickerPropsMock.mock.calls[dateTimePickerPropsMock.mock.calls.length - 1][0]
    expect(updatedOncePickerProps.onOpenChange).toEqual(expect.any(Function))
    act(() => {
      updatedOncePickerProps.onOpenChange?.(false)
    })

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith('agent-1', 'task-6', {
        trigger: { kind: 'once', at: normalizedFutureDate.getTime() }
      })
    })
    expect(new Date(updateTaskMock.mock.calls[0][2].trigger.at).getSeconds()).toBe(0)
    expect(new Date(updateTaskMock.mock.calls[0][2].trigger.at).getMilliseconds()).toBe(0)
  })
})
