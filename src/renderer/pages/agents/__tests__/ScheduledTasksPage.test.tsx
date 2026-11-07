import { act, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { TabIdContext } from '@renderer/hooks/tab/useCurrentTab'
import { clearConversationLocate, requestConversationLocate } from '@renderer/hooks/useConversationLocateRequest'

import type AgentChat from '../AgentChat'
import ScheduledTasksPage from '../ScheduledTasksPage'

const state = vi.hoisted(() => ({ visible: true }))
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({ useSearch: () => ({ taskId: 'task' }) }),
  useNavigate: () => vi.fn()
}))
vi.mock('@renderer/hooks/agent/useTasks', () => ({
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
  default: ({ locateMessageId, locateToEnd, onLocateMessageHandled }: ComponentProps<typeof AgentChat>) => (
    <button onClick={onLocateMessageHandled}>{locateMessageId ?? (locateToEnd ? 'latest' : 'no request')}</button>
  )
}))

afterEach(() => {
  clearConversationLocate('task-tab')
  state.visible = true
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
