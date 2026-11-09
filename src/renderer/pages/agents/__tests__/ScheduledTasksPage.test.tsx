import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { CommandProvider } from '@renderer/components/command/CommandProvider'
import { useCommandRuntime } from '@renderer/hooks/command'
import type * as TabHooks from '@renderer/hooks/tab'
import { TabIdContext } from '@renderer/hooks/tab/useCurrentTab'
import { clearConversationLocate, requestConversationLocate } from '@renderer/hooks/useConversationLocateRequest'
import { WindowFrameContext } from '@renderer/hooks/useWindowFrame'

import type AgentChat from '../AgentChat'
import ScheduledTasksPage from '../ScheduledTasksPage'

const state = vi.hoisted(() => ({ active: true, visible: true, notificationId: undefined as string | undefined }))
vi.mock('@renderer/hooks/tab', async (importOriginal) => ({
  ...(await importOriginal<typeof TabHooks>()),
  useIsActiveTab: () => state.active
}))
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => ({ taskId: 'task', notificationId: state.notificationId }) }),
  useNavigate: () => vi.fn()
}))
vi.mock('@renderer/hooks/agent/useTasks', () => ({
  TASKS_PAGE_LIMIT: 50,
  useAllTasks: () => ({ tasks: [] }),
  useTask: () => ({ task: { id: 'task' } }),
  useCreateTask: () => ({ createTask: vi.fn() })
}))
vi.mock('@renderer/hooks/agent/useTaskConversation', () => ({
  useTaskConversation: () => ({
    session: state.visible ? { id: 'session' } : null,
    result: { session: { id: 'session' }, logs: [] }
  })
}))
vi.mock('../useAgentConversationBootstrap', () => ({ useAgentConversationBootstrap: (value: unknown) => value }))
vi.mock('../components/ScheduledTaskSidebar', () => ({ ScheduledTaskGroup: () => null }))
vi.mock('../AgentChat', () => ({
  default: ({ locateMessageId, locateToEnd, onLocateMessageHandled, paneOpen }: ComponentProps<typeof AgentChat>) => (
    <button type="button" aria-expanded={paneOpen} onClick={onLocateMessageHandled}>
      {locateMessageId ?? (locateToEnd ? 'latest' : 'no request')}
    </button>
  )
}))

afterEach(() => {
  clearConversationLocate('task-tab')
  state.visible = true
  state.active = true
  state.notificationId = undefined
  MockUseDataApiUtils.resetMocks()
})

it.each(['message', null])('delivers navigation %s only when the task conversation is visible', (messageId) => {
  state.visible = false
  requestConversationLocate('task-tab', 'session', messageId)
  const page = (
    <TabIdContext value="task-tab">
      <ScheduledTasksPage />
    </TabIdContext>
  )
  const view = render(page)
  expect(screen.getByRole('button', { name: 'no request' })).toBeInTheDocument()

  state.visible = true
  view.rerender(
    <TabIdContext value="task-tab">
      <ScheduledTasksPage />
    </TabIdContext>
  )
  const request = screen.getByRole('button', { name: messageId ?? 'latest' })
  act(() => request.click())
  expect(screen.getByRole('button', { name: 'no request' })).toBeInTheDocument()
})

it.each([
  { taskId: 'task', notificationId: 'notice', visible: true },
  { taskId: 'another-task', notificationId: 'notice', visible: false },
  { taskId: 'task', notificationId: 'stale-notice', visible: false }
])(
  'shows a notification error only for its matching task and notification: %j',
  ({ taskId, notificationId, visible }) => {
    state.notificationId = 'notice'
    MockUseDataApiUtils.mockQueryResult('/notifications/:id', {
      data: {
        id: notificationId,
        target: { kind: 'scheduled-task', taskId, result: { errorSummary: 'Execution failed' } }
      } as never
    })
    const query = mockUseQuery.getMockImplementation()!
    mockUseQuery.mockImplementation((path, options) => ({
      ...query(path, options),
      ...(path === '/agents' ? { data: undefined } : {})
    }))
    render(
      <TabIdContext value="task-tab">
        <ScheduledTasksPage />
      </TabIdContext>
    )
    expect(screen.queryByText('Execution failed') !== null).toBe(visible)
  }
)

function ToggleCommand() {
  const runtime = useCommandRuntime()
  return (
    <button type="button" onClick={() => runtime.execute('app.sidebar.toggle')}>
      toggle sidebar
    </button>
  )
}

it('toggles the task sidebar through the command only while its tab is active', () => {
  const page = () => (
    <CommandProvider>
      <WindowFrameContext value={{ mode: 'window' }}>
        <TabIdContext value="task-tab">
          <ScheduledTasksPage />
        </TabIdContext>
      </WindowFrameContext>
      <ToggleCommand />
    </CommandProvider>
  )
  const view = render(page())
  const pane = () => screen.getByRole('button', { name: 'no request' })
  expect(pane()).toHaveAttribute('aria-expanded', 'false')
  act(() => screen.getByRole('button', { name: 'toggle sidebar' }).click())
  expect(pane()).toHaveAttribute('aria-expanded', 'true')
  state.active = false
  view.rerender(page())
  act(() => screen.getByRole('button', { name: 'toggle sidebar' }).click())
  expect(pane()).toHaveAttribute('aria-expanded', 'true')
  state.active = true
  view.rerender(page())
  act(() => screen.getByRole('button', { name: 'toggle sidebar' }).click())
  expect(pane()).toHaveAttribute('aria-expanded', 'false')
})
