import type { NormalToolResponse } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import PermissionRequestComposer, { type PermissionRequestComposerRequest } from '../PermissionRequestComposer'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.toolPermission.defaultDenyMessage': 'User denied permission for this tool.',
        'agent.toolPermission.error.sendFailed': 'Failed to send your decision. Please try again.',
        'agent.toolPermission.confirmation': 'Are you sure you want to run this Claude tool?',
        'agent.toolPermission.inputPreview': 'Tool input preview',
        'agent.toolPermission.pending': 'Waiting for approval',
        'agent.toolPermission.button.allow': 'Allow',
        'agent.toolPermission.button.deny': 'Deny',
        'agent.toolPermission.button.run': 'Run',
        'agent.toolPermission.waiting': 'Waiting for tool permission decision...',
        'message.tools.labels.mcpServerTool': 'MCP Server Tool',
        'message.tools.labels.tool': 'Tool',
        'message.tools.sections.input': 'Input'
      })[key] ?? key
  })
}))

const part = {
  type: 'tool-CustomTool',
  toolName: 'CustomTool',
  toolCallId: 'call-1',
  state: 'approval-requested',
  input: { command: 'pnpm test' },
  approval: { id: 'approval-1' }
} as unknown as CherryMessagePart

function makeRequest(overrides: Partial<PermissionRequestComposerRequest> = {}): PermissionRequestComposerRequest {
  const toolResponse: NormalToolResponse = {
    id: 'call-1',
    toolCallId: 'call-1',
    status: 'pending',
    arguments: { command: 'pnpm test' },
    tool: {
      id: 'call-1',
      name: 'CustomTool',
      type: 'builtin'
    }
  }

  return {
    messageId: 'message-1',
    toolCallId: 'call-1',
    approvalId: 'approval-1',
    title: 'Allow CustomTool to run focused tests?',
    toolResponse,
    match: {
      part,
      state: 'approval-requested',
      toolCallId: 'call-1',
      messageId: 'message-1',
      approvalId: 'approval-1',
      input: { command: 'pnpm test' }
    },
    ...overrides
  }
}

describe('PermissionRequestComposer', () => {
  it('submits an approval decision', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    expect(screen.getByText('Allow CustomTool to run focused tests?')).toBeInTheDocument()
    expect(screen.queryByText('Tool input preview')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: true
    })
  })

  it('submits a denial decision with the default deny reason', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: false,
      reason: 'User denied permission for this tool.'
    })
  })

  it('renders MCP tool name with the argument preview', () => {
    render(
      <PermissionRequestComposer
        request={makeRequest({
          toolResponse: {
            id: 'mcp-call-1',
            toolCallId: 'mcp-call-1',
            status: 'pending',
            arguments: { query: 'composer' },
            tool: {
              id: 'docs-server__lookup_docs',
              name: 'lookup_docs',
              type: 'mcp',
              serverId: 'docs-server',
              serverName: 'Docs',
              inputSchema: { type: 'object', properties: {}, required: [] }
            }
          }
        })}
        onRespond={vi.fn()}
      />
    )

    expect(screen.getByText('lookup_docs')).toBeInTheDocument()
    expect(screen.queryByText('Docs : lookup_docs')).not.toBeInTheDocument()
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText('composer')).toBeInTheDocument()
  })

  it('disables actions while a response is submitting', async () => {
    const onRespond = vi.fn(() => new Promise<void>(() => undefined))
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
  })
})
