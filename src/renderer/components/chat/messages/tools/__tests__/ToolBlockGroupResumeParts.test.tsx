import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FullPartsMapProvider, PartsProvider } from '../../blocks/MessagePartsContext'
import { ToolBlockGroup } from '../../blocks/ToolBlockGroup'

const mockUseTranslation = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation()
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({}),
  useOptionalMessageListUi: () => ({}),
  useOptionalMessageListTopicId: () => undefined
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultAssistant: vi.fn(() => ({ id: 'test-assistant', name: 'Test Assistant', settings: {} })),
  getDefaultTopic: vi.fn(() => ({
    id: 'test-topic',
    assistantId: 'test-assistant',
    createdAt: new Date().toISOString()
  }))
}))

// Mirrors the CLI's real receipt (capitalized "Use SendMessage") so a casing-sensitive matcher
// can never pass these tests again.
const LAUNCH_OUTPUT = "done. agentId: agent-77 (internal metadata. Use SendMessage with to: 'agent-77')"

function launchParts(): Record<string, CherryMessagePart[]> {
  return {
    m1: [
      {
        type: 'dynamic-tool',
        toolCallId: 'call-launch',
        toolName: 'Agent',
        state: 'output-available',
        input: { description: 'Inspect renderer', prompt: 'Check the message renderer' },
        output: LAUNCH_OUTPUT
      }
    ]
  }
}

function resumeReceipt(): NormalToolResponse {
  return {
    id: 'send-1',
    tool: { id: 'SendMessage', name: 'SendMessage', description: 'Send a message', type: 'provider' },
    arguments: { to: 'agent-77', summary: 'Continue the review', message: 'please continue' },
    status: 'done',
    toolCallId: 'call_resume',
    response: { success: true, message: 'resumed from transcript in the background', resumedAgentId: 'agent-77' }
  }
}

describe('resume presentation inside a completed tool group', () => {
  beforeEach(() => {
    mockUseTranslation.mockReturnValue({
      t: (key: string) => (key === 'message.tools.activity.continueHandle' ? 'Continue handling' : key)
    })
  })

  // ToolGroupPartsBoundary nulls PartsContext once every item completes — the launch-resolution
  // path must survive on the list-level FullPartsMapContext, or this label disappears.
  it('renders the continue label for a resumed agent from the full-parts map', () => {
    const parts = launchParts()
    const receipt = resumeReceipt()

    render(
      <FullPartsMapProvider value={parts}>
        <PartsProvider value={parts}>
          <ToolBlockGroup items={[{ id: 'resume-group', toolResponse: receipt }]} />
        </PartsProvider>
      </FullPartsMapProvider>
    )

    expect(screen.getByText('Continue handling')).toBeInTheDocument()
    expect(screen.getByText('Inspect renderer')).toBeInTheDocument()
  })

  // Even without full-parts map resolution, the continue-handling verb still renders (the
  // receipt's own resumedAgentId is sufficient). Only the identity text is lost.
  it('shows the bare continue-handling verb without launch identity when map is unavailable', () => {
    const receipt = resumeReceipt()

    render(
      <FullPartsMapProvider value={null}>
        <PartsProvider value={null}>
          <ToolBlockGroup items={[{ id: 'resume-group', toolResponse: receipt }]} />
        </PartsProvider>
      </FullPartsMapProvider>
    )

    expect(screen.getByText('Continue handling')).toBeInTheDocument()
    expect(screen.queryByText('Inspect renderer')).toBeNull()
  })

  // A queued send to a still-running agent carries only pin.id — the group header must treat it
  // as the same continuation entry.
  it('renders the continue label for a queued-pin receipt', () => {
    const parts = launchParts()
    const receipt: NormalToolResponse = {
      ...resumeReceipt(),
      response: {
        success: true,
        message: 'Message queued for delivery at its next tool round.',
        pin: { id: 'agent-77', name: 'flow-marker-reader', ref: 'abc' }
      }
    }

    render(
      <FullPartsMapProvider value={parts}>
        <PartsProvider value={parts}>
          <ToolBlockGroup items={[{ id: 'resume-group', toolResponse: receipt }]} />
        </PartsProvider>
      </FullPartsMapProvider>
    )

    expect(screen.getByText('Continue handling')).toBeInTheDocument()
    expect(screen.getByText('Inspect renderer')).toBeInTheDocument()
  })
})
