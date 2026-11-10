import { MockDataApiUtils, mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { act, render, screen } from '@testing-library/react'
import { Activity } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'

import { useTask } from '../useTasks'

vi.unmock('@data/hooks/useDataApi')

afterEach(() => {
  vi.restoreAllMocks()
})

it('refreshes the task result when a conversation returns after a background run', async () => {
  let status = 'not-run'
  vi.spyOn(mockDataApiService, 'get').mockImplementation(async () => ({
    id: 'task-1',
    name: 'Recurring task',
    runSummary: { status }
  }))
  const { Wrapper } = createSWRTestWrapper()
  function Card() {
    const { task } = useTask('task-1')
    return <div>{task?.runSummary?.status ?? 'loading'}</div>
  }
  const content = (mode: 'visible' | 'hidden') => (
    <Activity mode={mode}>
      <Card />
    </Activity>
  )
  const { rerender } = render(content('visible'), { wrapper: Wrapper })
  await screen.findByText('not-run')
  rerender(content('hidden'))
  status = 'completed'
  act(() => MockDataApiUtils.emitDataChange([{ endpoint: '/agent-tasks/:taskId', entityIds: ['task-1'] }]))
  rerender(content('visible'))

  expect(await screen.findByText('completed')).toBeVisible()
})
