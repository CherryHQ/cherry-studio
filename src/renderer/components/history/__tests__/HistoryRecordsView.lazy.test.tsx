import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const moduleMocks = vi.hoisted(() => ({
  agentLoaded: vi.fn(),
  assistantLoaded: vi.fn()
}))

vi.mock('../AgentHistoryRecords', () => {
  moduleMocks.agentLoaded()
  return { default: () => <div>Agent history implementation</div> }
})

vi.mock('../AssistantHistoryRecords', () => {
  moduleMocks.assistantLoaded()
  return { default: () => <div>Assistant history implementation</div> }
})

import HistoryRecordsView from '../HistoryRecordsView'

beforeEach(() => {
  moduleMocks.agentLoaded.mockClear()
  moduleMocks.assistantLoaded.mockClear()
})

it('loads neither implementation while closed and only the selected implementation when opened', async () => {
  const props = { onClose: vi.fn(), onRecordSelect: vi.fn() }
  const { rerender } = render(<HistoryRecordsView {...props} mode="assistant" open={false} />)

  expect(moduleMocks.agentLoaded).not.toHaveBeenCalled()
  expect(moduleMocks.assistantLoaded).not.toHaveBeenCalled()

  rerender(<HistoryRecordsView {...props} mode="assistant" open />)

  expect(await screen.findByText('Assistant history implementation')).toBeInTheDocument()
  expect(moduleMocks.assistantLoaded).toHaveBeenCalledOnce()
  expect(moduleMocks.agentLoaded).not.toHaveBeenCalled()

  rerender(<HistoryRecordsView {...props} mode="agent" open />)

  expect(await screen.findByText('Agent history implementation')).toBeInTheDocument()
  expect(moduleMocks.agentLoaded).toHaveBeenCalledOnce()
})
