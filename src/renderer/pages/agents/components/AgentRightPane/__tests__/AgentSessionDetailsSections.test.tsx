import { act, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'

import type { AgentRightPaneStatus, AgentRunTask } from '../agentRightPaneProjection'
import { AgentRunTaskStopsProvider, AgentSessionDetailsSections } from '../AgentSessionDetailsSections'

vi.mock('@cherrystudio/ui', async (original) => original())

function render(ui: ReactElement) {
  return renderView(ui, { wrapper: AgentRunTaskStopsProvider })
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => vi.restoreAllMocks())

function status(runTasks: AgentRunTask[]): AgentRightPaneStatus {
  return { runTasks, tasks: [], completedTaskCount: 0, totalTaskCount: 0, artifacts: [] }
}

// Catches SDK task types disappearing or being counted twice in different sections.
it('keeps unknown tasks visible and separates workflows and shell tasks from subagents', () => {
  render(
    <AgentSessionDetailsSections
      status={status([
        { id: 'a', title: 'Inspect source', status: 'pending', taskType: 'subagent' },
        { id: 'w', title: 'Workflow task', status: 'pending', taskType: 'local_workflow', subagentType: 'review' },
        { id: 's', title: 'Shell task', status: 'pending', taskType: 'background_shell' },
        { id: 'u', title: 'Unknown task', status: 'pending', taskType: 'future_sdk_task' }
      ])}
    />
  )
  for (const group of ['subagents', 'workflows', 'shell_tasks', 'other_tasks']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`agent.right_pane.info.${group}`) }))
  }
  for (const title of ['Inspect source', 'Workflow task', 'Shell task', 'Unknown task']) {
    expect(screen.getAllByText(title)).toHaveLength(1)
  }
  expect(screen.queryByText('agent.right_pane.info.plan')).toBeNull()
  expect(screen.queryByText('agent.right_pane.info.artifacts')).toBeNull()
})

// Catches completed work burying live or failing tasks and losing finished-task navigation.
it('orders running, failed and pending tasks first and keeps finished tasks behind a disclosure', () => {
  render(
    <AgentSessionDetailsSections
      onOpenFlow={() => {}}
      status={status([
        { id: 'c', title: 'Completed review', status: 'completed', taskType: 'subagent', toolUseId: 'c' },
        { id: 'p', title: 'Pending review', status: 'pending', taskType: 'subagent', toolUseId: 'p' },
        { id: 'e', title: 'Failed review', status: 'error', taskType: 'subagent', toolUseId: 'e' },
        { id: 'r', title: 'Running review', status: 'in_progress', taskType: 'subagent', toolUseId: 'r' }
      ])}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /agent.right_pane.info.subagents/ }))
  const tasks = screen.getAllByRole('button', { name: /review/ })
  expect(tasks.map((task) => task.textContent)).toEqual([
    'Running reviewsubagent',
    'Failed reviewsubagent',
    'Pending reviewsubagent'
  ])
  expect(screen.queryByText('Completed review')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /agent.right_pane.info.finished_tasks/ }))
  expect(screen.getByRole('button', { name: /Completed review/ })).toBeInTheDocument()
})

describe('runtime-owned task settlement', () => {
  // Catches a Stop click claiming completion before the runtime settles, or allowing duplicate clicks.
  it('keeps the running state and disables Stop until a terminal event replaces it', async () => {
    vi.spyOn(ipcApi, 'request').mockResolvedValue(true)
    const task: AgentRunTask = { id: 'r', title: 'Review', status: 'in_progress', taskType: 'subagent' }
    const view = render(<AgentSessionDetailsSections sessionId="session" status={status([task])} />)
    fireEvent.click(screen.getByRole('button', { name: /agent.right_pane.info.subagents/ }))
    const stop = screen.getByRole('button', { name: 'agent.right_pane.status.stop_run_task' })
    fireEvent.click(stop)
    expect(stop).toBeDisabled()
    expect(screen.getByRole('img', { name: 'message.tools.status.running' })).toBeInTheDocument()
    view.rerender(<AgentSessionDetailsSections sessionId="session" status={status([{ ...task, status: 'stopped' }])} />)
    expect(screen.queryByRole('button', { name: 'agent.right_pane.status.stop_run_task' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /agent.right_pane.info.finished_tasks/ }))
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'message.tools.cancelled' })).toBeInTheDocument()
  })
})

// Catches disclosure or presentation unmounts permitting a duplicate outstanding Stop request.
it('keeps Stop pending across disclosure and content remounts, and allows retry after failure', async () => {
  let settle!: (accepted: boolean) => void
  const request = vi.spyOn(ipcApi, 'request').mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        settle = resolve
      })
  )
  const task: AgentRunTask = { id: 'r', title: 'Review', status: 'in_progress', taskType: 'subagent' }
  const content = (sessionId = 'a') => <AgentSessionDetailsSections sessionId={sessionId} status={status([task])} />
  const view = render(content())
  const expand = () => fireEvent.click(screen.getByRole('button', { name: /agent.right_pane.info.subagents/ }))
  const stop = () => screen.getByRole('button', { name: 'agent.right_pane.status.stop_run_task' })
  expand()
  fireEvent.click(stop())
  expand()
  expect(screen.queryByRole('button', { name: 'agent.right_pane.status.stop_run_task' })).toBeNull()
  expand()
  expect(stop()).toBeDisabled()
  view.rerender(<></>)
  view.rerender(content('b'))
  expand()
  expect(stop()).toBeEnabled()
  view.rerender(<></>)
  view.rerender(content())
  expand()
  expect(stop()).toBeDisabled()
  fireEvent.click(stop())
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => settle(false))
  await waitFor(() => expect(stop()).toBeEnabled())
  fireEvent.click(stop())
  expect(request).toHaveBeenCalledTimes(2)
  await act(async () => settle(true))
  expect(stop()).toBeDisabled()
  expect(screen.getByRole('img', { name: 'message.tools.status.running' })).toBeInTheDocument()
})
