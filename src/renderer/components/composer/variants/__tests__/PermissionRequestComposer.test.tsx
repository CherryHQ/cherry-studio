import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import PermissionRequestComposer, { type PermissionRequestComposerRequest } from '../PermissionRequestComposer'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.toolPermission.error.sendFailed': 'Failed to send your decision. Please try again.',
        'agent.toolPermission.reasonLabel': 'Reason for rejection (optional)',
        'agent.toolPermission.reasonPlaceholder': 'Tell the Agent what to do instead',
        'agent.toolPermission.risk.title': 'What this does',
        'agent.toolPermission.risk.destructive': 'Deletes or overwrites data.',
        'agent.toolPermission.risk.irreversible': 'Cannot be undone automatically.',
        'agent.toolPermission.risk.network': 'Sends data over the network or fetches remote content.',
        'agent.toolPermission.confirmation': 'Allow tool call?',
        'agent.toolPermission.inputPreview': 'Tool input preview',
        'agent.toolPermission.button.allow': 'Allow',
        'agent.toolPermission.button.deny': 'Deny',
        'agent.toolPermission.button.run': 'Run',
        'agent.toolPermission.waiting': 'Waiting for tool permission decision...',
        'message.processing': 'Processing',
        'message.tools.activity.checking': 'Checking',
        'message.tools.activity.projectChecks': 'project checks',
        'message.tools.activity.relatedContent': 'related content',
        'message.tools.activity.searching': 'Searching',
        'message.tools.activity.usingExtension': 'Bringing in an extension',
        'message.tools.labels.mcpServerTool': 'MCP Server Tool',
        'message.tools.labels.tool': 'Tool',
        'message.tools.sections.input': 'Input',
        'agent.toolPermission.title': 'Approval required',
        'agent.toolPermission.source': 'From',
        'agent.toolPermission.subagent': 'Subagent',
        'agent.toolPermission.background': 'Background task'
      })[key] ?? key
  })
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ maxHeight, value }: { maxHeight?: number; value: string }) => (
    <div data-max-height={maxHeight} data-testid="code-viewer">
      {value}
    </div>
  )
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
    title: 'CustomTool',
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
  it('opens the requesting subagent without deciding its approval', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn()
    const onOpenSource = vi.fn()
    const source = { toolCallId: 'spawn-a', title: 'Review changes', isBackgrounded: true }
    render(
      <PermissionRequestComposer request={makeRequest({ source })} onRespond={onRespond} onOpenSource={onOpenSource} />
    )

    await user.tab()
    await user.keyboard('{Enter}')

    expect(onOpenSource).toHaveBeenCalledWith(source)
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('submits an approval decision', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(
      <PermissionRequestComposer
        request={makeRequest({ title: 'Allow CustomTool to run focused tests?' })}
        onRespond={onRespond}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: true
    })
  })

  it('submits a denial decision without a reason when the box is empty', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: false
    })
  })

  it('trims and submits user feedback without changing the denial decision', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'Reason for rejection (optional)' }))
    await user.type(screen.getByRole('textbox', { name: 'Reason for rejection (optional)' }), '  use a copy instead  ')
    await user.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: false,
      reason: 'use a copy instead'
    })
  })

  it('renders MCP tool name with the argument preview', () => {
    render(
      <PermissionRequestComposer
        request={makeRequest({
          title: 'lookup_docs',
          toolResponse: {
            id: 'mcp-call-1',
            toolCallId: 'mcp-call-1',
            status: 'pending',
            arguments: { query: 'composer' },
            tool: {
              id: 'docs-server__lookup_docs',
              name: 'lookup_docs',
              description: 'Search project documentation.',
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

    expect(screen.getByText('Search project documentation.')).toBeInTheDocument()

    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText('composer')).toBeInTheDocument()
  })

  it('renders the ExitPlanMode plan in the approval preview', () => {
    render(
      <PermissionRequestComposer
        request={makeRequest({
          title: 'ExitPlanMode',
          toolResponse: {
            id: 'exit-plan-call-1',
            toolCallId: 'exit-plan-call-1',
            status: 'pending',
            arguments: { plan: '# Release plan\n\n1. Run the focused tests' },
            tool: { id: 'ExitPlanMode', name: 'ExitPlanMode', type: 'builtin' }
          }
        })}
        onRespond={vi.fn()}
      />
    )

    const preview = screen.getByTestId('permission-preview')
    expect(preview).toHaveTextContent('Release plan')
    expect(preview).toHaveTextContent('Run the focused tests')
  })

  it('shows the reason once in the header and warnings in the risk summary', () => {
    render(
      <PermissionRequestComposer
        request={makeRequest({
          title: 'Clean up the old build output',
          toolResponse: {
            id: 'bash-call-1',
            toolCallId: 'bash-call-1',
            status: 'pending',
            arguments: { command: 'rm -rf ./dist' },
            tool: {
              id: 'Bash',
              name: 'Bash',
              type: 'builtin'
            }
          }
        })}
        onRespond={vi.fn()}
      />
    )

    expect(screen.getByText('Clean up the old build output')).toBeInTheDocument()
    const summary = screen.getByTestId('permission-risk-summary')
    expect(summary).toHaveTextContent('What this does')
    expect(summary).toHaveTextContent('Deletes or overwrites data.')
    expect(summary).toHaveTextContent('Cannot be undone automatically.')
    expect(summary).not.toHaveTextContent('Clean up the old build output')
    expect(screen.getByTestId('permission-preview')).toHaveTextContent('rm -rf ./dist')
  })

  it('hides the risk summary for read-only commands and keeps the reason in the header', () => {
    render(
      <PermissionRequestComposer
        request={makeRequest({
          title: 'Run the focused tests',
          toolResponse: {
            id: 'bash-call-1',
            toolCallId: 'bash-call-1',
            status: 'pending',
            arguments: { command: 'pnpm test' },
            tool: {
              id: 'Bash',
              name: 'Bash',
              type: 'builtin'
            }
          }
        })}
        onRespond={vi.fn()}
      />
    )

    expect(screen.queryByTestId('permission-risk-summary')).not.toBeInTheDocument()
    expect(screen.getByText('Run the focused tests')).toBeInTheDocument()
  })

  it('approves when Enter is pressed outside editable controls', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.keyDown(document, { key: 'Enter' })

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: true
    })
  })

  it('denies when Escape is pressed outside editable controls', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: false
    })
  })

  it('denies with the typed reason when Enter is pressed inside the rejection reason', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'Reason for rejection (optional)' }))
    const reason = screen.getByRole('textbox', { name: 'Reason for rejection (optional)' })
    await user.click(reason)
    await user.keyboard('use a copy instead{Enter}')

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: false,
      reason: 'use a copy instead'
    })
    expect(reason).toHaveValue('use a copy instead')
  })

  it('approves when Enter is pressed inside an empty rejection reason', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'Reason for rejection (optional)' }))
    const reason = screen.getByRole('textbox', { name: 'Reason for rejection (optional)' })
    await user.click(reason)
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: true
    })
  })

  it('keeps Escape inside the rejection reason from triggering the global deny shortcut', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'Reason for rejection (optional)' }))
    const reason = screen.getByRole('textbox', { name: 'Reason for rejection (optional)' })
    await user.click(reason)
    await user.keyboard('{Escape}')

    expect(onRespond).not.toHaveBeenCalled()
  })

  it('keeps Shift+Enter as a newline inside the rejection reason', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'Reason for rejection (optional)' }))
    const reason = screen.getByRole('textbox', { name: 'Reason for rejection (optional)' })
    await user.click(reason)
    await user.keyboard('use a copy{Shift>}{Enter}{/Shift}instead')

    expect(onRespond).not.toHaveBeenCalled()
    expect(reason).toHaveValue('use a copy\ninstead')
  })

  it('denies rather than approves when Enter is pressed outside a filled rejection reason', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'Reason for rejection (optional)' }))
    await user.type(screen.getByRole('textbox', { name: 'Reason for rejection (optional)' }), 'use a copy instead')
    fireEvent.keyDown(document, { key: 'Enter' })

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: false,
      reason: 'use a copy instead'
    })
  })

  it('does not carry a rejection reason into the next approval request', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'Reason for rejection (optional)' }))
    await user.type(screen.getByRole('textbox', { name: 'Reason for rejection (optional)' }), 'use a copy instead')

    rerender(
      <PermissionRequestComposer
        request={makeRequest({ approvalId: 'approval-2', match: { ...makeRequest().match, approvalId: 'approval-2' } })}
        onRespond={onRespond}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Reason for rejection (optional)' }))
    expect(screen.getByRole('textbox', { name: 'Reason for rejection (optional)' })).toHaveValue('')
  })

  it('shows progress and resets actions when the next approval becomes active', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn(() => new Promise<void>(() => undefined))
    const { rerender } = render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status')).toHaveTextContent('Processing')
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()

    const nextPart = {
      ...part,
      toolCallId: 'call-2',
      approval: { id: 'approval-2' }
    } as unknown as CherryMessagePart
    const nextRequest = makeRequest({
      toolCallId: 'call-2',
      approvalId: 'approval-2',
      match: {
        ...makeRequest().match,
        part: nextPart,
        toolCallId: 'call-2',
        approvalId: 'approval-2'
      }
    })
    rerender(<PermissionRequestComposer request={nextRequest} onRespond={onRespond} />)

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('button', { name: 'Allow' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).not.toBeDisabled()
  })

  it('re-enables the request when submitting the response fails', async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error('failed'))
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to send your decision. Please try again.'))
    expect(screen.getByRole('button', { name: 'Allow' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).not.toBeDisabled()
  })
})
