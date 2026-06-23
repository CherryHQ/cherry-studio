import type { NormalToolResponse } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PermissionRequestComposer, { type PermissionRequestComposerRequest } from '../PermissionRequestComposer'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'agent.toolPermission.defaultDenyMessage': 'User denied permission for this tool.',
        'agent.toolPermission.error.sendFailed': 'Failed to send your decision. Please try again.',
        'agent.toolPermission.confirmation': 'Allow tool call?',
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
  beforeEach(() => {
    window.toast = { error: vi.fn() } as any
  })

  it('marks the root panel as a composer viewport inset target', () => {
    const { container } = render(<PermissionRequestComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(container.firstElementChild).toHaveAttribute('data-composer-viewport-inset-target', '')
  })

  it('submits an approval decision', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(
      <PermissionRequestComposer
        request={makeRequest({ title: 'Allow CustomTool to run focused tests?' })}
        onRespond={onRespond}
      />
    )

    expect(screen.getByText('Allow tool call?')).toBeInTheDocument()
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

    expect(screen.getByText('lookup_docs')).toBeInTheDocument()
    expect(screen.getByText('Search project documentation.')).toBeInTheDocument()
    expect(screen.getByTestId('permission-preview')).not.toHaveClass('overflow-y-auto')
    expect(screen.getByTestId('permission-mcp-args-scroll')).toHaveClass('max-h-60', 'overflow-y-auto')
    expect(screen.queryByText('Docs : lookup_docs')).not.toBeInTheDocument()
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText('composer')).toBeInTheDocument()
  })

  it('bounds builtin previews that do not own their own scroll region', () => {
    render(<PermissionRequestComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(screen.getByTestId('permission-preview')).not.toHaveClass('overflow-y-auto')
    expect(screen.getByTestId('permission-builtin-body-scroll')).toHaveClass('max-h-60', 'overflow-y-auto')
  })

  it('does not add a fallback body scroller when the tool content owns scrolling', () => {
    render(
      <PermissionRequestComposer
        request={makeRequest({
          title: 'Write',
          toolResponse: {
            id: 'write-call-1',
            toolCallId: 'write-call-1',
            status: 'pending',
            arguments: {
              file_path: '/tmp/cherry-approval-long-preview-note.md',
              content: '# Long approval preview\n\nA long document body.'
            },
            tool: {
              id: 'Write',
              name: 'Write',
              type: 'builtin'
            }
          }
        })}
        onRespond={vi.fn()}
      />
    )

    expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-max-height', '240')
    expect(screen.queryByTestId('permission-builtin-body-scroll')).not.toBeInTheDocument()
  })

  it('hides the request title when it only repeats the tool name', () => {
    render(<PermissionRequestComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(screen.getByText('Allow tool call?')).toBeInTheDocument()
    expect(screen.getAllByText('CustomTool')).toHaveLength(1)
  })

  it('disables actions while a response is submitting', async () => {
    const onRespond = vi.fn(() => new Promise<void>(() => undefined))
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
  })

  it('re-enables the request when submitting the response fails', async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error('failed'))
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(window.toast.error).toHaveBeenCalledWith('Failed to send your decision. Please try again.')
    )
    expect(screen.getByRole('button', { name: 'Allow' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny' })).not.toBeDisabled()
  })
})
