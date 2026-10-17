import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'

const taskMocks = vi.hoisted(() => ({
  task: undefined as ScheduledTaskEntity | undefined,
  error: undefined as Error | undefined,
  logs: [] as Array<Record<string, unknown>>,
  updateTask: vi.fn(),
  setTaskEnabled: vi.fn(),
  runTask: vi.fn(),
  deleteTask: vi.fn()
}))

vi.mock('@renderer/hooks/agent/useTasks', () => ({
  useTask: () => ({ task: taskMocks.task, error: taskMocks.error, isLoading: false }),
  useTaskLogs: () => ({ logs: taskMocks.logs }),
  useUpdateTask: () => ({ updateTask: taskMocks.updateTask }),
  useSetTaskEnabled: () => ({ setTaskEnabled: taskMocks.setTaskEnabled }),
  useRunTask: () => ({ runTask: taskMocks.runTask }),
  useDeleteTask: () => ({ deleteTask: taskMocks.deleteTask })
}))

// Keys stand in for copy; the schedule summary's interpolated time stays visible for assertions.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { time?: string }) => (options?.time ? `${key}{${options.time}}` : key),
    i18n: { language: 'en-US' }
  })
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: () => ({ agent: { id: 'agent-1', name: 'Cherry Assistant' } })
}))

vi.mock('@renderer/hooks/agent/useChannels', () => ({
  useChannels: () => ({ channels: [{ id: 'channel-1', name: 'Team chat' }] })
}))

vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ navigateToRoute: vi.fn() })
}))

// The shared form dialog has its own coverage; this stand-in submits a fixed patch through the card's wiring.
vi.mock('@renderer/components/ScheduledTask/TaskFormDialog', () => ({
  TaskFormDialog: ({ open, onUpdate }: { open: boolean; onUpdate: (patch: { name: string }) => Promise<boolean> }) =>
    open ? (
      <button type="button" onClick={() => void onUpdate({ name: 'Renamed' })}>
        save-edit
      </button>
    ) : null
}))

import { ScheduledTaskToolInline } from '../ScheduledTaskTool'

function scheduledTask(overrides: Partial<ScheduledTaskEntity> = {}): ScheduledTaskEntity {
  return {
    id: 'task-1',
    agentId: 'agent-1',
    name: 'Gold price',
    prompt: 'Check the gold price',
    trigger: { kind: 'cron', expr: '0 21 * * *' },
    timeoutMinutes: 2,
    workspace: { type: 'system' },
    reuseSession: false,
    reuseSessionId: null,
    channelIds: [],
    nextRun: '2026-10-16T13:00:00.000Z',
    lastRun: null,
    enabled: true,
    status: 'active',
    createdAt: '2026-10-16T06:40:55.806Z',
    updatedAt: '2026-10-16T06:40:55.808Z',
    ...overrides
  }
}

function renderCard() {
  return render(<ScheduledTaskToolInline result={{ taskId: 'task-1', name: 'Gold price' }} />)
}

describe('ScheduledTaskToolInline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskMocks.task = scheduledTask()
    taskMocks.error = undefined
    taskMocks.logs = []
    taskMocks.updateTask.mockResolvedValue(scheduledTask({ name: 'Renamed' }))
  })

  it('states the recurring cadence with its next run', () => {
    renderCard()

    expect(screen.getByText('Gold price')).toBeInTheDocument()
    expect(
      screen.getByText(/^agent\.tasks\.schedule\.summary\.daily\{21:00\} · agent\.tasks\.nextRun /)
    ).toBeInTheDocument()
    expect(screen.queryByText(/agent\.tasks\.schedule\.once/)).not.toBeInTheDocument()
  })

  it('states a one-time task as one time on its date instead of a recurring cadence', () => {
    const at = Date.parse('2026-10-17T01:00:00.000Z')
    taskMocks.task = scheduledTask({ trigger: { kind: 'once', at }, nextRun: new Date(at).toISOString() })

    renderCard()

    const scheduleLine = screen.getByText(/^agent\.tasks\.schedule\.once · /)
    expect(scheduleLine.textContent).toContain(
      new Date(at).toLocaleString(undefined, { month: 'numeric', day: 'numeric' })
    )
    expect(scheduleLine.textContent).not.toMatch(/summary|nextRun/)
  })

  it('reports the most recent run, not an older one', () => {
    taskMocks.logs = [
      { id: 'run-2', status: 'failed', startedAt: '2026-10-16T13:00:00.000Z', durationMs: 4000 },
      { id: 'run-1', status: 'completed', startedAt: '2026-10-15T13:00:00.000Z', durationMs: 4000 }
    ]

    renderCard()

    expect(screen.getByText(/^agent\.tasks\.runSummary\.failed/)).toBeInTheDocument()
    expect(screen.queryByText(/agent\.tasks\.runSummary\.completed/)).not.toBeInTheDocument()
  })

  it('shows a run still in progress as running', () => {
    taskMocks.logs = [{ id: 'run-1', status: 'running', startedAt: '2026-10-16T13:00:00.000Z', durationMs: null }]

    renderCard()

    expect(screen.getByText('agent.tasks.runSummary.running')).toBeInTheDocument()
  })

  it('shows no last run for a task that has never run', () => {
    renderCard()

    expect(screen.queryByText(/agent\.tasks\.runSummary/)).not.toBeInTheDocument()
  })

  it('says results stay in the app when no channel is targeted, and names the channels otherwise', () => {
    const { unmount } = renderCard()
    expect(screen.getByText('agent.tasks.card.inApp')).toBeInTheDocument()
    unmount()

    taskMocks.task = scheduledTask({ channelIds: ['channel-1'] })
    renderCard()
    expect(screen.getByText('agent.tasks.channels.label: Team chat')).toBeInTheDocument()
    expect(screen.queryByText('agent.tasks.card.inApp')).not.toBeInTheDocument()
  })

  it('pauses an active task from its switch', async () => {
    renderCard()

    await userEvent.click(screen.getByRole('switch', { name: 'agent.tasks.status.active' }))

    expect(taskMocks.setTaskEnabled).toHaveBeenCalledWith('agent-1', 'task-1', false)
  })

  it('saves edits made from the card to that task', async () => {
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    await userEvent.click(await screen.findByRole('button', { name: 'save-edit' }))

    expect(taskMocks.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', { name: 'Renamed' })
  })

  it('deletes only after the user confirms', async () => {
    renderCard()

    await userEvent.click(screen.getByRole('button', { name: 'agent.tasks.delete.label' }))
    expect(taskMocks.deleteTask).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'agent.tasks.delete.label' }))

    await waitFor(() => expect(taskMocks.deleteTask).toHaveBeenCalledWith('agent-1', 'task-1'))
  })

  it('marks a deleted task as deleted even while its last snapshot is still cached', () => {
    // After a delete, the refetch fails with NOT_FOUND while SWR still holds the previous task.
    taskMocks.error = DataApiErrorFactory.notFound('Task', 'task-1')

    renderCard()

    expect(screen.getByText('Gold price')).toBeInTheDocument()
    expect(screen.getByText('agent.tasks.card.deleted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.edit' })).not.toBeInTheDocument()
  })

  it('keeps showing the task when a refresh fails for another reason', () => {
    taskMocks.error = new Error('network down')

    renderCard()

    expect(screen.queryByText('agent.tasks.card.deleted')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.edit' })).toBeInTheDocument()
  })
})
