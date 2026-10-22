import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import { PartsProvider } from '../../blocks/MessagePartsContext'
import { ToolBlockGroup } from '../../blocks/ToolBlockGroup'
import { AgentLaunchIndexProvider } from '../agent'
import { buildAgentLaunchIndex } from '../shared/agentToolTypes'

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
      t: (key: string) => key
    })
  })

  // ToolGroupPartsBoundary nulls PartsContext once every item completes — the launch-resolution
  // path must survive on the list-level agent-launch index, or this header disappears.
  it('renders the launch identity for a resumed agent from the full-parts map', () => {
    const parts = launchParts()
    const receipt = resumeReceipt()

    render(
      <AgentLaunchIndexProvider value={buildAgentLaunchIndex(parts)}>
        <PartsProvider value={parts}>
          <ToolBlockGroup items={[{ id: 'resume-group', toolResponse: receipt }]} />
        </PartsProvider>
      </AgentLaunchIndexProvider>
    )

    expect(screen.queryByText('Continue the review')).toBeNull()
    expect(screen.getByText('Inspect renderer')).toBeInTheDocument()
  })

  // Without the full-parts map the launch description is unavailable, so the header falls back
  // to the request summary.
  it('falls back to the request summary without the launch identity', () => {
    const receipt = resumeReceipt()

    render(
      <AgentLaunchIndexProvider value={null}>
        <PartsProvider value={null}>
          <ToolBlockGroup items={[{ id: 'resume-group', toolResponse: receipt }]} />
        </PartsProvider>
      </AgentLaunchIndexProvider>
    )

    expect(screen.getByText('Continue the review')).toBeInTheDocument()
    expect(screen.queryByText('Inspect renderer')).toBeNull()
  })

  // A receipt whose result is still an envelope names no child anywhere, so the icon must not be
  // derived from the result: the header leads with the continuation icon like every other receipt.
  it('heads a deferred receipt group with the continuation icon', () => {
    const receipt: NormalToolResponse = {
      ...resumeReceipt(),
      response: { $deferredToolResult: { topicId: 't1', messageId: 'm1', toolCallId: 'call_resume' } }
    }

    const { container } = render(
      <AgentLaunchIndexProvider value={null}>
        <PartsProvider value={null}>
          <ToolBlockGroup items={[{ id: 'resume-group', toolResponse: receipt }]} />
        </PartsProvider>
      </AgentLaunchIndexProvider>
    )

    expect(screen.getByText('Continue the review')).toBeInTheDocument()
    expect(container.querySelector('.lucide-sparkles')).not.toBeNull()
    expect(container.querySelector('.lucide-wrench')).toBeNull()
  })

  // A queued send to a still-running agent carries only pin.id — the group header must treat it
  // as the same continuation entry.
  it('renders the launch identity for a queued-pin receipt', () => {
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
      <AgentLaunchIndexProvider value={buildAgentLaunchIndex(parts)}>
        <PartsProvider value={parts}>
          <ToolBlockGroup items={[{ id: 'resume-group', toolResponse: receipt }]} />
        </PartsProvider>
      </AgentLaunchIndexProvider>
    )

    expect(screen.queryByText('Continue the review')).toBeNull()
    expect(screen.getByText('Inspect renderer')).toBeInTheDocument()
  })
})
