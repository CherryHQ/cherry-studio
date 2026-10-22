import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@renderer/i18n/locales/en-us.json'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { ScheduledTaskListItem } from '@shared/data/api/schemas/agents'

vi.unmock('@cherrystudio/ui')

const { request, navigateToRoute } = vi.hoisted(() => ({ request: vi.fn(), navigateToRoute: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ navigateToRoute })
}))

import { ScheduledTaskToolInline } from '../ScheduledTaskTool'

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})

function scheduledTask(overrides: Partial<ScheduledTaskListItem> = {}): ScheduledTaskListItem {
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
    runSummary: null,
    ...overrides
  }
}

function setTask(task: ScheduledTaskListItem) {
  MockUseDataApiUtils.mockQueryResult('/agent-tasks/:taskId', { data: task })
}

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ScheduledTaskToolInline result={{ taskId: 'task-1', name: 'Gold price' }} />
    </I18nextProvider>
  )
}

describe('ScheduledTaskToolInline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseDataApiUtils.resetMocks()
    setTask(scheduledTask())
    request.mockResolvedValue(scheduledTask())
  })

  it('shows the recurring schedule and opens that task from its quiet detail action', async () => {
    const user = userEvent.setup()
    renderCard()
    expect(screen.getByText(/Daily at 21:00/)).toHaveTextContent('Next Run')
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.queryByText('Results are shown in the app')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View task' }))
    expect(navigateToRoute).toHaveBeenCalledWith({ path: '/settings/scheduled-tasks/task-1' })
  })

  it('distinguishes a consumed one-time schedule from a failed execution', () => {
    setTask(
      scheduledTask({
        trigger: { kind: 'once', at: Date.parse('2026-10-17T01:00:00Z') },
        status: 'completed',
        nextRun: null,
        runSummary: { status: 'failed', finishedAt: '2026-10-17T01:00:05Z' }
      })
    )
    renderCard()
    expect(screen.getByText(/^One time/)).toBeInTheDocument()
    expect(screen.getByText('Triggered')).toBeInTheDocument()
    expect(screen.getByText(/^Last run failed/)).toBeInTheDocument()
    expect(screen.queryByText(/Last run succeeded|Next Run/)).not.toBeInTheDocument()
  })

  it.each(['queued', 'running'] as const)('shows %s independently and prevents another manual run', async (status) => {
    const user = userEvent.setup()
    setTask(scheduledTask({ runSummary: { status } }))
    renderCard()
    expect(screen.getByText(en[`agent.tasks.runSummary.${status}`])).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: en['agent.tasks.run'] })).toHaveAttribute('aria-disabled', 'true')
  })

  it('moves pause and resume into a keyboard-accessible menu', async () => {
    const user = userEvent.setup()
    const view = renderCard()
    screen.getByRole('button', { name: 'More' }).focus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('menuitem', { name: en['agent.tasks.pause'] }))
    expect(request).toHaveBeenCalledWith('ai.agent.task.pause', { agentId: 'agent-1', taskId: 'task-1' })
    view.unmount()
    setTask(scheduledTask({ enabled: false, status: 'paused' }))
    renderCard()
    expect(screen.getByText(en['agent.tasks.status.paused'])).toBeInTheDocument()
    expect(screen.queryByText(/Next Run/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: en['agent.tasks.resume'] }))
    expect(request).toHaveBeenCalledWith('ai.agent.task.resume', { agentId: 'agent-1', taskId: 'task-1' })
  })

  it('requires confirmation before deleting from the menu', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: en['agent.tasks.delete.label'] }))
    expect(request).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: en['agent.tasks.delete.label'] }))
    expect(request).toHaveBeenCalledWith('ai.agent.task.delete', { agentId: 'agent-1', taskId: 'task-1' })
  })

  it('removes all actions after deletion even with a cached task', () => {
    MockUseDataApiUtils.mockQueryResult('/agent-tasks/:taskId', {
      data: scheduledTask(),
      error: DataApiErrorFactory.notFound('Task', 'task-1')
    })
    renderCard()
    expect(screen.getByText('This scheduled task has been deleted')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('distinguishes loading and a retryable read failure from deletion', async () => {
    const user = userEvent.setup()
    MockUseDataApiUtils.mockQueryLoading('/agent-tasks/:taskId')
    const view = renderCard()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    view.unmount()
    const refetch = vi.fn()
    MockUseDataApiUtils.mockQueryResult('/agent-tasks/:taskId', {
      data: undefined,
      error: new Error('offline'),
      refetch
    })
    renderCard()
    expect(screen.getByText('Could not load task')).toBeInTheDocument()
    expect(screen.queryByText('This scheduled task has been deleted')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('keeps the last known task on a transient refresh error', () => {
    MockUseDataApiUtils.mockQueryResult('/agent-tasks/:taskId', { data: scheduledTask(), error: new Error('offline') })
    renderCard()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View task' })).toBeInTheDocument()
  })
})
