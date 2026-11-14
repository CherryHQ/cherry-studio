import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

import { dataApiService } from '@renderer/data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import en from '@renderer/i18n/locales/en-us.json'
import { appErrorDetailService } from '@renderer/services/AppErrorDetailService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { ScheduledTaskListItem } from '@shared/data/api/schemas/agents'

import type AgentChat from '../AgentChat'
import ScheduledTasksPage from '../ScheduledTasksPage'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')
vi.mock('../useAgentConversationBootstrap', () => ({ useAgentConversationBootstrap: (value: unknown) => value }))
vi.mock('../AgentChat', () => ({
  default: ({ pane, conversationToolbar, conversationBootstrap, centerSurface }: ComponentProps<typeof AgentChat>) => (
    <>
      {pane}
      {conversationToolbar}
      <output aria-label="Conversation">{conversationBootstrap?.session?.name}</output>
      {centerSurface?.content}
    </>
  )
}))

const i18n = createInstance()
beforeAll(async () => {
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView ??= () => {}
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})
afterEach(() => vi.restoreAllMocks())

const statuses = ['active', 'paused', 'completed', 'missed'] as const
function task(status: ScheduledTaskListItem['status'], index = 0): ScheduledTaskListItem {
  return {
    id: `${status}-${index}`,
    agentId: `${status}-owner-${index}`,
    name: `${status} task ${index}`,
    prompt: 'Report',
    trigger: { kind: 'once', at: 1 },
    timeoutMinutes: 5,
    workspace: { type: 'system' },
    reuseSession: false,
    reuseSessionId: null,
    enabled: status === 'active',
    status,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    runSummary: null
  }
}

async function openPage(
  withHistory = true,
  legacy?: 'missing' | 'unlinked' | 'error' | 'empty' | 'outside' | 'pending' | 'delayed'
) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const availability = { recent: true }
  const outputs = {
    recent: { kind: 'executed', result: 'recent stored result' },
    older: { result: 'old sentinel\n<script>plain text</script>' }
  }
  const tasks = Array.from({ length: 51 }, (_, index) => statuses.map((status) => task(status, index))).flat()
  vi.spyOn(dataApiService, 'get').mockImplementation(async (path, options) => {
    const query = options?.query as
      | { status?: string | string[]; page?: number; limit?: number; ids?: string[] }
      | undefined
    if (path === '/agent-tasks') {
      const items = tasks.filter((item) =>
        Array.isArray(query?.status) ? query.status.includes(item.status) : item.status === query?.status
      )
      const page = query?.page ?? 1
      return { items: items.slice((page - 1) * 50, page * 50), total: items.length, page, limit: 50 } as never
    }
    if (path.startsWith('/agent-tasks/')) {
      const found = tasks.find((item) => path.endsWith('/' + item.id))
      if (!found) throw new Error('task store unavailable')
      return found as never
    }
    if (path === '/agents')
      return { items: query?.ids?.slice(0, query.limit).map((id) => ({ id, name: `Owner ${id}` })) ?? [] } as never
    if (path.includes('/tasks/') && path.endsWith('/logs')) {
      const id = path.split('/').at(-2)!
      return {
        items:
          id.startsWith('completed') && withHistory
            ? [
                {
                  id: 'recent',
                  sessionId: 'recent-session',
                  startedAt: '2026-01-02T00:00:00Z',
                  status: 'completed',
                  result: outputs.recent.result,
                  error: null
                },
                {
                  id: legacy === 'outside' ? 'another' : 'older',
                  sessionId: 'older-session',
                  startedAt: '2026-01-01T00:00:00Z',
                  status: 'failed',
                  result: outputs.older.result,
                  error: 'failure sentinel\nsecond line'
                }
              ]
            : [],
        total: id.startsWith('completed') && withHistory ? 2 : 0,
        page: 1,
        limit: 50
      } as never
    }
    if (path === '/agent-sessions')
      return {
        items: [
          { id: 'recent-session', name: 'Recent report' },
          { id: 'older-session', name: 'Older report' }
        ]
      } as never
    if (path === '/agent-sessions/recent-session' && !availability.recent)
      throw DataApiErrorFactory.notFound('Session', 'recent-session')
    if (path === '/agent-sessions/older-session' && legacy) {
      if (legacy === 'error') throw new Error('transport timeout')
      throw DataApiErrorFactory.notFound('Session', 'older-session')
    }
    if (path.startsWith('/agent-sessions/'))
      return {
        id: path.split('/').at(-1),
        name: path.endsWith('older-session') ? 'Older report' : 'Recent report'
      } as never
    if (path === '/jobs/older' || path === '/jobs/recent' || path === '/jobs/outside')
      return {
        id: path.split('/').at(-1),
        status:
          path === '/jobs/recent' ? 'completed' : legacy === 'pending' || legacy === 'delayed' ? legacy : 'failed',
        output: path === '/jobs/recent' ? outputs.recent : legacy === 'empty' ? null : outputs.older,
        error: legacy === 'empty' ? null : { message: 'failure sentinel\nsecond line' },
        type: 'agent.task',
        scheduleId: 'completed-0',
        metadata:
          path !== '/jobs/recent' && (legacy === 'unlinked' || legacy === 'empty')
            ? {}
            : { sessionId: path === '/jobs/recent' ? 'recent-session' : 'older-session' },
        startedAt: '2026-01-01T00:00:00Z'
      } as never
    throw new Error(`Unexpected read: ${path}`)
  })
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/app/scheduled-tasks',
    component: ScheduledTasksPage,
    validateSearch: (search: Record<string, unknown>) => ({
      taskId: search.taskId as string | undefined,
      runId: search.runId as string | undefined
    })
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/app/scheduled-tasks'] })
  })
  await router.load()
  const { Wrapper } = createSWRTestWrapper()
  render(
    <I18nextProvider i18n={i18n}>
      <Wrapper>
        <RouterProvider router={router} />
      </Wrapper>
    </I18nextProvider>
  )
  return { router, tasks, availability }
}

it('combines paused and missed tasks into one paginated group while keeping other pages independent', async () => {
  const user = userEvent.setup()
  await openPage()
  const completed = await screen.findByRole('region', { name: 'Completed' })
  const paused = await screen.findByRole('region', { name: 'Paused' })
  await within(completed).findByRole('button', { name: /completed task 49 Owner completed-owner-49/ })
  expect(screen.queryByRole('region', { name: 'Missed' })).not.toBeInTheDocument()
  expect(within(completed).getByRole('button', { name: 'Completed 51' })).toBeVisible()
  expect(within(paused).getByRole('button', { name: 'Paused 102' })).toBeVisible()
  expect(within(paused).getByRole('button', { name: /paused task 24 Owner paused-owner-24/ })).toBeVisible()
  expect(within(paused).getByRole('button', { name: /missed task 24 Owner missed-owner-24/ })).toHaveTextContent(
    'Missed scheduled time'
  )
  await user.click(within(completed).getByRole('button', { name: 'Next' }))
  await within(completed).findByRole('button', { name: /completed task 50 Owner completed-owner-50/ })
  expect(within(paused).getByText('1 / 3')).toBeVisible()
  await user.click(within(paused).getByRole('button', { name: 'Next' }))
  await within(paused).findByRole('button', { name: /missed task 49 Owner missed-owner-49/ })
  await user.click(within(paused).getByRole('button', { name: 'Next' }))
  await within(paused).findByRole('button', { name: /missed task 50 Owner missed-owner-50/ })
  expect(within(completed).getByText('2 / 2')).toBeVisible()
})

it('opens completed history and retains its conversation when the task changes state', async () => {
  const user = userEvent.setup()
  const { router, tasks } = await openPage()
  const completed = await screen.findByRole('region', { name: 'Completed' })
  await user.click(await within(completed).findByRole('button', { name: /completed task 0 / }))
  await waitFor(() => expect(screen.getByRole('status', { name: 'Conversation' })).toHaveTextContent('Recent report'))
  await act(async () => {
    await router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0', runId: 'older' } })
  })
  await waitFor(() => expect(screen.getByRole('status', { name: 'Conversation' })).toHaveTextContent('Older report'))
  tasks.find((item) => item.id === 'completed-0')!.status = 'missed'
  await act(async () => {
    MockDataApiUtils.emitDataChange([{ endpoint: '/agent-tasks', kind: 'projection', entityIds: ['completed-0'] }])
  })
  await within(screen.getByRole('region', { name: 'Paused' })).findByRole('button', { name: /completed task 0 / })
  expect(within(completed).queryByRole('button', { name: /completed task 0 / })).not.toBeInTheDocument()
  expect(router.state.location.search).toMatchObject({ taskId: 'completed-0', runId: 'older' })
  expect(screen.getByRole('status', { name: 'Conversation' })).toHaveTextContent('Older report')
})

it.each(['completed', 'missed'] as const)(
  'keeps a %s task without history selectable without promising a future first run',
  async (status) => {
    const user = userEvent.setup()
    const { router } = await openPage(false)
    const group = await screen.findByRole('region', { name: status === 'completed' ? 'Completed' : 'Paused' })
    await user.click(await within(group).findByRole('button', { name: new RegExp(`${status} task 0 `) }))
    await screen.findByText('No available conversation for this selection.')
    expect(router.state.location.search).toMatchObject({ taskId: `${status}-0` })
    expect(screen.queryByText('Waiting for the first run')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Conversation' })).toBeEmptyDOMElement()
  }
)

it.each(['missing', 'unlinked'] as const)(
  'shows legacy stored text with %s session and recovers through the run selector',
  async (condition) => {
    const user = userEvent.setup()
    const { router } = await openPage(true, condition)
    await act(async () => router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0' } }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Conversation' })).toHaveTextContent('Recent report'))
    await user.click(screen.getByRole('combobox'))
    const options = await screen.findAllByRole('option')
    await user.click(options[1])
    const text = await screen.findByText('old sentinel', { exact: false })
    expect(text.textContent).toBe('old sentinel\n<script>plain text</script>')
    expect(screen.getByText('failure sentinel', { exact: false }).textContent).toBe('failure sentinel\nsecond line')
    expect(screen.getByText('Status:', { exact: false })).toHaveTextContent('Failed')
    expect(screen.getByRole('status', { name: 'Conversation' })).toBeEmptyDOMElement()
    expect(screen.getByRole('combobox')).toBeVisible()
    expect(router.state.location.search).toMatchObject({ runId: 'older' })
    await user.click(screen.getByRole('combobox'))
    await user.click((await screen.findAllByRole('option'))[0])
    await waitFor(() => expect(screen.getByRole('status', { name: 'Conversation' })).toHaveTextContent('Recent report'))
    expect(screen.queryByText('old sentinel', { exact: false })).not.toBeInTheDocument()
  }
)

it('retains the selected option outside loaded history', async () => {
  const user = userEvent.setup()
  const { router } = await openPage(true, 'outside')
  await act(async () =>
    router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0', runId: 'outside' } })
  )
  await screen.findByText('old sentinel', { exact: false })
  await user.click(screen.getByRole('combobox'))
  expect(await screen.findAllByRole('option')).toHaveLength(3)
  expect(screen.getByRole('option', { selected: true })).toBeVisible()
})

it('explicitly explains when neither result nor error is stored', async () => {
  const { router } = await openPage(true, 'empty')
  await act(async () =>
    router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0', runId: 'older' } })
  )
  expect(await screen.findByText('No stored result or error is available for this run.')).toBeVisible()
})

it('keeps unexpected failures in the error and retry path', async () => {
  const { router } = await openPage(true, 'error')
  await act(async () =>
    router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0', runId: 'older' } })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(en['scheduledTasks.unavailable'])
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  expect(screen.queryByText('old sentinel', { exact: false })).not.toBeInTheDocument()
})

it.each(['pending', 'delayed'] as const)('translates the stored-result status for %s jobs', async (status) => {
  const { router } = await openPage(true, status)
  await act(async () =>
    router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0', runId: 'older' } })
  )
  expect(await screen.findByText('Status:', { exact: false })).toHaveTextContent('Waiting to run')
})

it('shows the automatically selected run stored result after its session disappears', async () => {
  const { router, availability } = await openPage()
  await act(async () => router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0' } }))
  await waitFor(() => expect(screen.getByRole('status', { name: 'Conversation' })).toHaveTextContent('Recent report'))
  availability.recent = false
  await act(async () =>
    MockDataApiUtils.emitDataChange([{ endpoint: '/agent-sessions/:sessionId', entityIds: ['recent-session'] }])
  )
  expect(await screen.findByText('recent stored result')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'Conversation' })).toBeEmptyDOMElement()
  expect(router.state.location.search).toMatchObject({ taskId: 'completed-0' })
})

it('renders mixed legacy and executed history rows and opens the legacy result without a readable session', async () => {
  const user = userEvent.setup()
  const { router } = await openPage(true, 'missing')
  await act(async () => router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0' } }))
  await waitFor(() => expect(screen.getByRole('status', { name: 'Conversation' })).toHaveTextContent('Recent report'))
  await user.click(screen.getByRole('combobox'))
  const options = await screen.findAllByRole('option')
  expect(options).toHaveLength(2)
  expect(options[0]).toBeVisible()
  expect(options[1]).toBeVisible()
  await user.click(options[1])
  expect(await screen.findByText('old sentinel', { exact: false })).toHaveTextContent('old sentinel')
  expect(router.state.location.search).toMatchObject({ runId: 'older' })
  expect(screen.getByRole('status', { name: 'Conversation' })).toBeEmptyDOMElement()
})

it('offers failure details beside Retry when the selected task cannot be loaded', async () => {
  const user = userEvent.setup()
  const open = vi.spyOn(appErrorDetailService, 'openAppErrorDetail').mockResolvedValue('opened')
  const { router } = await openPage()
  await act(async () => {
    await router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'deleted-task' } })
  })

  const alert = await screen.findByRole('alert')
  expect(within(alert).getByRole('button', { name: 'Retry' })).toBeVisible()
  await user.click(within(alert).getByRole('button', { name: 'Details' }))

  await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
  const [request] = open.mock.calls[0]
  expect(request.context).toMatchObject({ operation: 'task.load', recordId: 'deleted-task' })
  expect(request.error?.message).toBe('task store unavailable')
})

it('files a run-history failure under its own operation rather than the task load', async () => {
  const user = userEvent.setup()
  const open = vi.spyOn(appErrorDetailService, 'openAppErrorDetail').mockResolvedValue('opened')
  const { router } = await openPage()
  const read = vi.mocked(dataApiService.get)
  const readAll = read.getMockImplementation()!
  read.mockImplementation(async (path, options) => {
    if (path.endsWith('/logs')) throw new Error('history store unavailable')
    return readAll(path, options)
  })
  await act(async () => {
    await router.navigate({ to: '/app/scheduled-tasks', search: { taskId: 'completed-0' } })
  })

  const alert = await screen.findByRole('alert')
  await user.click(within(alert).getByRole('button', { name: 'Details' }))

  await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
  const [request] = open.mock.calls[0]
  expect(request.context).toMatchObject({ operation: 'task.logs.load', recordId: 'completed-0' })
  expect(request.error?.message).toBe('history store unavailable')
})
