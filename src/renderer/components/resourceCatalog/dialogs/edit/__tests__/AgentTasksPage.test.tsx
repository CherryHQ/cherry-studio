import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { AgentTasksPage } from '../AgentTasksPage'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

// The code editor needs app providers; the prompt field is not under test here.
vi.mock('@renderer/components/PromptEditorField', () => ({ default: () => null }))

const { ipcRequest } = vi.hoisted(() => ({ ipcRequest: vi.fn() }))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequest },
  useIpcOn: vi.fn()
}))

const task = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  agentId: 'agent-1',
  name,
  prompt: 'Summarize new PRs',
  trigger: { kind: 'cron', expr: '0 9 * * 1-5' },
  timeoutMinutes: 10,
  workspace: { type: 'system' },
  reuseSession: false,
  reuseSessionId: null,
  enabled: true,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  ipcRequest.mockReset().mockResolvedValue({})
  mockUseQuery.mockImplementation((path: string) => ({
    data:
      path === '/agents/:agentId/tasks'
        ? { items: [task('t1', 'Daily review'), task('t2', 'Weekly report', { enabled: false, status: 'paused' })] }
        : path === '/agents/:agentId/tasks/:taskId/logs'
          ? { items: [{ id: 'run-1', scheduleId: 't1', startedAt: '2026-01-02T09:00:00.000Z', status: 'completed' }] }
          : undefined,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn(),
    mutate: vi.fn()
  }))
})

// AC7: this Agent's tasks, pause and resume, and the task form with the Agent fixed.
describe('AgentTasksPage', () => {
  it("lists this Agent's tasks and pauses or resumes them", async () => {
    const user = userEvent.setup()
    render(<AgentTasksPage agentId="agent-1" agentName="Reviewer" />)

    expect(screen.getByText('Daily review')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Weekly report/ })).getByText('已暂停')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: /Daily review/ }))
    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith('ai.agent.task.pause', { agentId: 'agent-1', taskId: 't1' })
    )
    await user.click(screen.getByRole('switch', { name: /Weekly report/ }))
    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith('ai.agent.task.resume', { agentId: 'agent-1', taskId: 't2' })
    )
  })

  it('opens a new task with this Agent fixed', async () => {
    const user = userEvent.setup()
    render(<AgentTasksPage agentId="agent-1" agentName="Reviewer" />)

    await user.click(screen.getByRole('button', { name: '新建任务' }))

    const agentPicker = await screen.findByRole('button', { name: '绑定智能体' })
    expect(agentPicker).toHaveTextContent('Reviewer')
    expect(agentPicker).toBeDisabled()
  })

  it('offers run history, Run now, and Delete when editing a task', async () => {
    const user = userEvent.setup()
    render(<AgentTasksPage agentId="agent-1" agentName="Reviewer" />)

    await user.click(screen.getByRole('button', { name: /Daily review/ }))
    const form = await screen.findByRole('dialog')
    expect(within(form).getByText('运行历史')).toBeInTheDocument()
    expect(within(form).getByText(/已完成/)).toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: /立即执行/ }))
    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith('ai.agent.task.run', { agentId: 'agent-1', taskId: 't1' })
    )

    await user.click(within(form).getByRole('button', { name: /删除/ }))
    const confirm = screen.getAllByRole('dialog').at(-1)!
    await user.click(within(confirm).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith('ai.agent.task.delete', { agentId: 'agent-1', taskId: 't1' })
    )
  })
})
