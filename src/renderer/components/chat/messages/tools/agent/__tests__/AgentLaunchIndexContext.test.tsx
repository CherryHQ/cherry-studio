import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'

import { AgentLaunchIndexProvider, useAgentResumePresentation } from '../AgentLaunchIndexContext'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function sendResponse(status: NormalToolResponse['status'], response: unknown): NormalToolResponse {
  return {
    id: 'response-send',
    toolCallId: 'call-send',
    tool: { id: 'SendMessage', name: 'SendMessage', description: 'Message an agent', type: 'provider' },
    arguments: { to: 'agent-77', summary: 'Continue the review', message: 'please continue' },
    status,
    response
  }
}

function Probe({ toolResponse, canNavigate }: { toolResponse: NormalToolResponse; canNavigate: boolean }) {
  const presentation = useAgentResumePresentation()
  const header = presentation?.renderResumeHeader(toolResponse, canNavigate)
  return <span data-testid="has-header">{header ? 'header' : 'none'}</span>
}

describe('AgentLaunchIndexProvider resume presentation', () => {
  // A failed delivery resumed nothing, so its group must keep the diagnostic row — a resume header
  // would lead to a flow whose part.output projection cannot explain the failure.
  it('offers no resume header for a failed send', () => {
    render(
      <AgentLaunchIndexProvider value={null}>
        <Probe
          toolResponse={sendResponse('error', { isError: true, content: [{ type: 'text', text: 'not delivered' }] })}
          canNavigate
        />
      </AgentLaunchIndexProvider>
    )

    expect(screen.getByTestId('has-header')).toHaveTextContent('none')
  })

  // A cancelled delivery resumed nothing either, even when a result payload is present.
  it('offers no resume header for a cancelled send', () => {
    render(
      <AgentLaunchIndexProvider value={null}>
        <Probe toolResponse={sendResponse('cancelled', 'delivered before the interrupt')} canNavigate />
      </AgentLaunchIndexProvider>
    )

    expect(screen.getByTestId('has-header')).toHaveTextContent('none')
  })

  it('keeps the resume header for a delivered receipt', () => {
    render(
      <AgentLaunchIndexProvider value={null}>
        <Probe toolResponse={sendResponse('done', 'The child finished the audit.')} canNavigate />
      </AgentLaunchIndexProvider>
    )

    expect(screen.getByTestId('has-header')).toHaveTextContent('header')
  })
})
