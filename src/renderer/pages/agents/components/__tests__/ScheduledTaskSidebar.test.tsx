import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { ScheduledTaskListItem } from '@shared/data/api/schemas/agents'

import { ScheduledTaskGroup, type ScheduledTaskGroupProps } from '../ScheduledTaskSidebar'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@cherrystudio/ui', async () => {
  const { MockCherrystudioUI } = await import('@test-mocks/renderer/CherrystudioUI')
  const dropdown = await import('@cherrystudio/ui/components/primitives/dropdown-menu')
  const confirm = await import('@cherrystudio/ui/components/composites/confirm-dialog')
  const button = await import('@cherrystudio/ui/components/primitives/button')
  const tooltip = await import('@cherrystudio/ui/components/primitives/tooltip')
  return { ...MockCherrystudioUI, ...dropdown, ...confirm, ...button, ...tooltip }
})
vi.mock('@renderer/components/chat/resourceList/base', async () => {
  const { Button } = await import('@cherrystudio/ui/components/primitives/button')
  return { ResourceList: { HeaderActionButton: Button } }
})
vi.mock('@renderer/ipc', () => ({ ipcApi: { request, on: () => () => {} } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const task = {
  id: 'task',
  agentId: 'agent',
  name: 'Daily report',
  status: 'active',
  trigger: { kind: 'interval', ms: 60000 }
} as ScheduledTaskListItem
function source(overrides: Partial<ScheduledTaskGroupProps['source']> = {}): ScheduledTaskGroupProps['source'] {
  return {
    tasks: [task],
    total: 51,
    page: 1,
    pageCount: 2,
    isLoading: false,
    error: undefined,
    hasNext: true,
    hasPrev: false,
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides
  }
}

it('selects by keyboard and pauses without invoking a run or cancel command', async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  request.mockResolvedValue({ ...task, enabled: false, status: 'paused' })
  render(
    <ScheduledTaskGroup
      status="active"
      source={source()}
      selectedTaskId="task"
      agents={new Map([['agent', 'Writer']])}
      onSelect={select}
    />
  )
  const row = screen.getByRole('button', { name: /Daily report Writer/ })
  row.focus()
  await user.keyboard('{Enter}')
  expect(select).toHaveBeenCalledWith('task')
  expect(row).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'common.more Daily report' }))
  expect(request).not.toHaveBeenCalled()
  await user.click(screen.getByRole('menuitem', { name: 'agent.tasks.pause' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('ai.agent.task.pause', { agentId: 'agent', taskId: 'task' }))
  expect(request.mock.calls.map(([name]) => name)).toEqual(['ai.agent.task.pause'])
})

it('keeps the other group usable when one fails and exposes group-specific retry', async () => {
  const failed = source({ error: new Error('offline') })
  const ready = source({ tasks: [], total: 0, hasNext: false })
  render(
    <>
      <ScheduledTaskGroup status="active" source={failed} agents={new Map()} onSelect={vi.fn()} />
      <ScheduledTaskGroup status="paused" source={ready} agents={new Map()} onSelect={vi.fn()} />
    </>
  )
  const paused = screen.getByRole('region', { name: 'agent.tasks.status.paused' })
  expect(within(paused).getByText('scheduledTasks.emptyGroup')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'common.retry' }))
  expect(failed.refetch).toHaveBeenCalledTimes(1)
  expect(ready.refetch).not.toHaveBeenCalled()
})

it('collapses each group independently and restores the selected task with the keyboard', async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  render(
    <>
      <ScheduledTaskGroup
        status="active"
        source={source()}
        selectedTaskId="task"
        agents={new Map()}
        onSelect={select}
      />
      <ScheduledTaskGroup
        status="paused"
        source={source({ tasks: [], total: 0, hasNext: false })}
        agents={new Map()}
        onSelect={select}
      />
    </>
  )
  const active = screen.getByRole('region', { name: 'agent.tasks.status.active' })
  const paused = screen.getByRole('region', { name: 'agent.tasks.status.paused' })
  const toggle = within(active).getByRole('button', { name: 'agent.tasks.status.active 51' })
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(within(active).queryByRole('button', { name: /Daily report/ })).not.toBeInTheDocument()
  expect(within(active).queryByRole('navigation')).not.toBeInTheDocument()
  expect(within(paused).getByText('scheduledTasks.emptyGroup')).toBeVisible()
  await user.keyboard('{Enter}')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(within(active).getByRole('button', { name: /Daily report agent/ })).toHaveAttribute('aria-pressed', 'true')
  expect(within(active).getByRole('navigation')).toBeVisible()
  expect(select).not.toHaveBeenCalled()
})

it('runs a paused task only from the explicit run action, without resuming or selecting it', async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  request.mockResolvedValue(undefined)
  render(
    <ScheduledTaskGroup
      status="paused"
      source={source({ tasks: [{ ...task, status: 'paused' }] })}
      agents={new Map()}
      onSelect={select}
    />
  )
  await user.click(screen.getByRole('button', { name: 'common.more Daily report' }))
  expect(screen.getByRole('menuitem', { name: 'scheduledTasks.resume' })).toBeVisible()
  expect(screen.getByRole('menuitem', { name: 'common.edit' })).toBeVisible()
  expect(request).not.toHaveBeenCalled()
  await user.click(screen.getByRole('menuitem', { name: 'scheduledTasks.runNow' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('ai.agent.task.run', { agentId: 'agent', taskId: 'task' }))
  expect(request.mock.calls.map(([name]) => name)).toEqual(['ai.agent.task.run'])
  expect(select).not.toHaveBeenCalled()
})

it('requires delete confirmation and keeps a failed deletion available for retry', async () => {
  const user = userEvent.setup()
  const deleted = vi.fn()
  request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
  render(
    <ScheduledTaskGroup status="active" source={source()} agents={new Map()} onSelect={vi.fn()} onDeleted={deleted} />
  )
  await user.click(screen.getByRole('button', { name: 'common.more Daily report' }))
  await user.click(screen.getByRole('menuitem', { name: 'agent.tasks.delete.label' }))
  const dialog = screen.getByRole('dialog', { name: 'agent.tasks.delete.confirm' })
  expect(request).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'agent.tasks.delete.label' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  expect(dialog).toBeVisible()
  expect(deleted).not.toHaveBeenCalled()
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'agent.tasks.delete.label' })).toBeEnabled())
  await user.click(within(dialog).getByRole('button', { name: 'agent.tasks.delete.label' }))
  await waitFor(() => expect(deleted).toHaveBeenCalledWith('task'))
  expect(request).toHaveBeenLastCalledWith('ai.agent.task.delete', { agentId: 'agent', taskId: 'task' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
