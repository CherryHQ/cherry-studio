import { act, fireEvent, render as renderView, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComputerUseAppIcons } from '@renderer/components/chat/messages/tools/automation/ComputerUseAppIcons'
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

it('shows controlled applications and their stop action', () => {
  const row = {
    ownerId: 'agent:session:agent',
    label: 'Agent',
    appId: 'browser',
    appName: 'Browser',
    status: 'active' as const
  }
  render(
    <AgentSessionDetailsSections status={status([])} desktopControls={[row]} stopDesktopControl={async () => {}} />
  )
  fireEvent.click(screen.getByRole('button', { name: /agent.right_pane.info.desktop_control.title/ }))
  expect(screen.getByText('Browser')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'agent.right_pane.info.desktop_control.stop' })).toBeInTheDocument()
})

it('shows statuses and only allows stopping opening or active applications', async () => {
  const user = userEvent.setup()
  const stop = vi.fn().mockResolvedValue(undefined)
  const rows = (['opening', 'active', 'stopping', 'stopped', 'unconfirmed'] as const).map((state) => ({
    ownerId: 'agent:s:a',
    label: 'Agent',
    appId: state,
    appName: state,
    status: state
  }))
  render(<AgentSessionDetailsSections status={status([])} desktopControls={rows} stopDesktopControl={stop} />)
  await user.click(screen.getByRole('button', { name: /agent.right_pane.info.desktop_control.title/ }))
  for (const row of rows) expect(screen.getByText(`agent.right_pane.info.desktop_control.${row.status}`)).toBeVisible()
  const buttons = screen.getAllByRole('button', { name: 'agent.right_pane.info.desktop_control.stop' })
  expect(buttons).toHaveLength(2)
  await user.click(buttons[1])
  expect(stop).toHaveBeenCalledWith(rows[1])
  expect(screen.queryByRole('button', { name: /allow/i })).toBeNull()
})

it('does not render a group for empty or owner-only snapshots', () => {
  const view = render(<AgentSessionDetailsSections status={status([])} desktopControls={[]} />)
  expect(screen.queryByRole('button', { name: /agent.right_pane.info.desktop_control.title/ })).toBeNull()
  view.rerender(
    <AgentSessionDetailsSections
      status={status([])}
      desktopControls={[{ ownerId: 'agent:s:a', label: 'Agent', status: 'active' }]}
    />
  )
  expect(screen.queryByRole('button', { name: /agent.right_pane.info.desktop_control.title/ })).toBeNull()
})

it('shares native app icons between session details and the tool card', async () => {
  class LoadedImage {
    complete = true
    naturalWidth = 64
    src = ''
    addEventListener() {}
    removeEventListener() {}
  }
  vi.stubGlobal('Image', LoadedImage)
  let queries = 0
  const app = { id: 'finder', name: 'Finder', identity: 'com.apple.finder' }
  vi.spyOn(ipcApi, 'request').mockImplementation(async (route) => {
    if (route === 'computer_use.get_call_apps') return [app]
    queries++
    return { status: 'available', icon: { mimeType: 'image/png', dataBase64: 'aWNvbg==' } }
  })
  try {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <AgentSessionDetailsSections
          status={status([])}
          desktopControls={[
            {
              ownerId: 'agent:s:a',
              label: 'Agent',
              appId: app.id,
              appName: app.name,
              appIdentity: app.identity,
              status: 'active'
            }
          ]}
        />
        <ComputerUseAppIcons cell="12345678-1234-4234-8234-123456789abc" />
      </SWRConfig>
    )
    fireEvent.click(screen.getByRole('button', { name: /agent.right_pane.info.desktop_control.title/ }))
    await waitFor(() => {
      const icons = screen.getAllByRole('img', { name: 'Finder' })
      expect(icons).toHaveLength(2)
      for (const icon of icons) expect(icon).toHaveAttribute('src', 'data:image/png;base64,aWNvbg==')
    })
    expect(queries).toBe(1)
  } finally {
    vi.unstubAllGlobals()
  }
})
