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

async function openPage(withHistory = true) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
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
    if (path.startsWith('/agent-tasks/')) return tasks.find((item) => path.endsWith('/' + item.id)) as never
    if (path === '/agents')
      return { items: query?.ids?.slice(0, query.limit).map((id) => ({ id, name: `Owner ${id}` })) ?? [] } as never
    if (path.includes('/tasks/') && path.endsWith('/logs')) {
      const id = path.split('/').at(-2)!
      return {
        items:
          id.startsWith('completed') && withHistory
            ? [
                { id: 'recent', sessionId: 'recent-session', startedAt: '2026-01-02T00:00:00Z' },
                { id: 'older', sessionId: 'older-session', startedAt: '2026-01-01T00:00:00Z' }
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
    if (path.startsWith('/agent-sessions/'))
      return {
        id: path.split('/').at(-1),
        name: path.endsWith('older-session') ? 'Older report' : 'Recent report'
      } as never
    if (path === '/jobs/older')
      return {
        type: 'agent.task',
        scheduleId: 'completed-0',
        metadata: { sessionId: 'older-session' },
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
  return { router, tasks }
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
