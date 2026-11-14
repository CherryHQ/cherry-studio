import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({
  openAgentToolFlow: vi.fn(),
  isAgentToolFlowActive: vi.fn(() => false)
}))
const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('../../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => actions
}))
vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))

import { AgentToolCallCard } from '../AgentToolCallCard'

describe('AgentToolCallCard failure details', () => {
  beforeEach(() => {
    detailMocks.open.mockReset()
    actions.openAgentToolFlow.mockReset()
  })

  it('adds a sibling detail for a tool failure and omits it on success', async () => {
    const { rerender } = render(
      <AgentToolCallCard toolCallId="call-1" toolName="Mystery" output="disk failed" hasError />
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.detail' }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    expect(detailMocks.open.mock.calls.at(-1)?.[0]).toMatchObject({
      localizedErrorMessage: 'message.tools.error',
      context: { source: 'agent.tool', operation: 'agent.tool.call', recordId: 'call-1', message: 'disk failed' }
    })

    rerender(<AgentToolCallCard toolCallId="call-2" toolName="Mystery" output="other failure" hasError />)
    detailMocks.open.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'common.detail' }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    expect(detailMocks.open.mock.calls.at(-1)?.[0]).toMatchObject({
      context: { recordId: 'call-2', message: 'other failure' }
    })

    rerender(<AgentToolCallCard toolCallId="call-2" toolName="Mystery" output="ok" status="done" />)
    expect(screen.queryByRole('button', { name: 'common.detail' })).not.toBeInTheDocument()
  })

  it('keeps the open-flow control free of a nested details button', async () => {
    render(
      <AgentToolCallCard
        toolCallId="call-9"
        toolName="Mystery"
        input={{ title: 'Inspect files' }}
        output="tool broke"
        hasError
        openFlowOnClick
      />
    )
    const flow = screen.getByRole('button', { name: /Inspect files/ })
    const details = screen.getByRole('button', { name: 'common.detail' })
    expect(flow.contains(details)).toBe(false)
    fireEvent.click(details)
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    expect(detailMocks.open.mock.calls.at(-1)?.[0]).toMatchObject({
      context: { recordId: 'call-9', message: 'tool broke' }
    })
  })
})
