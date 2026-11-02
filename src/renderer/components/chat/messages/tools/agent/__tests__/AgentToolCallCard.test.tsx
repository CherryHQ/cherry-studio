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
vi.mock('@renderer/services/AppErrorDetailService', () => ({
  buildInlineErrorDetailRequest: (input: unknown) => input
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
    fireEvent.click(screen.getByRole('button', { name: 'error.details' }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    const first = detailMocks.open.mock.calls.at(-1)?.[0]
    expect(first.localizedErrorMessage ?? first.message).toBe('message.tools.error')
    expect(first.error.message).toBe('disk failed')
    expect(first.context?.source ?? first.source).toBe('agent.tool')
    expect(first.context?.operation ?? first.operation).toBe('agent.tool.call')
    expect(first.context?.recordId ?? first.recordId).toBe('call-1')

    detailMocks.open.mockClear()
    rerender(<AgentToolCallCard toolCallId="call-1" toolName="Mystery" output="disk failed" hasError />)
    fireEvent.click(screen.getByRole('button', { name: 'error.details' }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    const again = detailMocks.open.mock.calls.at(-1)?.[0]
    expect(again.error.message).toBe('disk failed')
    expect(again.context?.recordId ?? again.recordId).toBe('call-1')

    rerender(<AgentToolCallCard toolCallId="call-2" toolName="Mystery" output="other failure" hasError />)
    detailMocks.open.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'error.details' }))
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    const second = detailMocks.open.mock.calls.at(-1)?.[0]
    expect(second.context?.recordId ?? second.recordId).toBe('call-2')
    expect(second.context?.operation ?? second.operation).toBe('agent.tool.call')
    expect(second.error.message).toBe('other failure')
    expect(second).not.toBe(first)

    rerender(<AgentToolCallCard toolCallId="call-2" toolName="Mystery" output="ok" status="done" />)
    expect(screen.queryByRole('button', { name: 'error.details' })).not.toBeInTheDocument()
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
    const details = screen.getByRole('button', { name: 'error.details' })
    expect(flow.contains(details)).toBe(false)
    fireEvent.click(details)
    await waitFor(() => expect(detailMocks.open).toHaveBeenCalled())
    const opened = detailMocks.open.mock.calls.at(-1)?.[0]
    expect(opened.context?.recordId ?? opened.recordId).toBe('call-9')
    expect(opened.error.message).toBe('tool broke')
  })
})
