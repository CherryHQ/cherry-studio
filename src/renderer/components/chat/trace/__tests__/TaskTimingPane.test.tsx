import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskTimingPane } from '../TaskTimingPane'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const task = {
  id: 'root',
  taskId: 'task',
  parentId: null,
  name: 'agent.task',
  startTime: 1000,
  endTime: 1200,
  durationMs: 200,
  status: 'success',
  completeness: 'complete'
}
const mount = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TaskTimingPane sessionId="session" />
    </SWRConfig>
  )

beforeEach(() => {
  request.mockReset()
})

describe('TaskTimingPane', () => {
  it('shows unavailable interrupted timing rather than a fabricated zero', async () => {
    request.mockImplementation(async (_route, query) => ({
      tasks: [task],
      nodes: query.list
        ? []
        : [
            {
              ...task,
              id: 'upload',
              parentId: 'root',
              name: 'upload',
              status: 'interrupted',
              endTime: null,
              durationMs: null,
              completeness: 'incomplete'
            }
          ],
      availability: 'incomplete',
      nextOffset: null
    }))
    mount()
    expect(await screen.findByText('upload')).toBeInTheDocument()
    expect(screen.getByText('trace.timing.status.interrupted')).toBeInTheDocument()
    expect(screen.getByText('trace.timing.unavailable')).toBeInTheDocument()
    expect(screen.queryByText('0.000 ms')).not.toBeInTheDocument()
  })

  it('reads the next node page without invoking any execution endpoint', async () => {
    request.mockImplementation(async (_route, query) => ({
      tasks: [task],
      nodes: query.list ? [] : [{ ...task, name: query.offset ? 'second tool' : 'first tool' }],
      availability: 'available',
      nextOffset: query.list || query.offset ? null : 100
    }))
    mount()
    await screen.findByText('first tool')
    await userEvent.setup().click(screen.getByRole('button', { name: 'trace.timing.next' }))
    expect(await screen.findByText('second tool')).toBeInTheDocument()
    expect(request.mock.calls.every(([route]) => route === 'ai.agent.session.timing')).toBe(true)
  })
})
