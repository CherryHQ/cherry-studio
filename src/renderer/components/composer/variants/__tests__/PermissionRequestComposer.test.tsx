import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import PermissionRequestComposer, { type PermissionRequestComposerRequest } from '../PermissionRequestComposer'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const template =
        {
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
          'local_agents.allow_always': '始终允许',
          'local_agents.allow_always_host': '始终允许主机：{{host}}',
          'local_agents.allow_always_target': '始终允许：{{target}}',
          'local_agents.allow_once': '允许一次',
          'local_agents.allow_session': '本次会话内允许',
          'local_agents.deny_always': '始终拒绝',
          'local_agents.deny_always_host': '始终拒绝主机：{{host}}',
          'agent.toolPermission.button.allowOnce': 'Allow this invocation',
          'agent.toolPermission.workingDirectory': 'Working directory',
          'agent.toolPermission.policyEvidence': 'Matching command details',
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
          'agent.toolPermission.background': 'Background task',
          'common.cancel': 'Cancel'
        }[key] ?? key
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(params?.[token] ?? ''))
    }
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
  it('returns the original scoped native permission option', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'native-session-grant', decision: 'acceptForSession', name: 'Allow during this session' },
        { optionId: 'native-deny', decision: 'decline', name: 'Reject this operation' }
      ]
    }
    render(<PermissionRequestComposer request={request} onRespond={onRespond} />)
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Allow during this session' }))
    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith({
        match: request.match,
        approved: true,
        updatedInput: { localPermissionOption: 'native-session-grant' }
      })
    )
  })

  it.each([
    { label: 'allow_always' as const, expectedText: '始终允许' },
    { label: 'allow_session' as const, expectedText: '本次会话内允许' }
  ])('translates explicit $label option labels and shows option warnings', async ({ label, expectedText }) => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        {
          optionId: 'allow_scoped',
          decision: label === 'allow_always' ? 'acceptAlways' : 'acceptForSession',
          label,
          name: 'Scoped allow',
          warning: 'Runs shell commands without further prompts'
        },
        { optionId: 'custom', decision: 'acceptAlways', name: 'Allow only /tmp/project' },
        { optionId: 'reject', decision: 'decline', label: 'deny', name: 'Reject' }
      ]
    }
    render(<PermissionRequestComposer request={request} onRespond={onRespond} />)
    expect(screen.getByTestId('permission-option-warnings')).toHaveTextContent(
      'Runs shell commands without further prompts'
    )
    expect(screen.getByRole('button', { name: 'Allow only /tmp/project' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: expectedText }))
    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith({
        match: request.match,
        approved: true,
        updatedInput: { localPermissionOption: 'allow_scoped' }
      })
    )
  })

  it('strips localPermissionOptions from generic tool previews outside native ACP payloads', () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const request = makeRequest()
    request.toolResponse.arguments = {
      command: 'pnpm build',
      localPermissionOptions: [{ optionId: 'session', decision: 'acceptForSession', name: 'Allow for session' }]
    }
    render(<PermissionRequestComposer request={request} onRespond={onRespond} />)
    expect(screen.getByText(/pnpm build/)).toBeVisible()
    expect(screen.queryByText(/localPermissionOptions/)).not.toBeInTheDocument()
  })

  it('shows the native ACP operation without its protocol envelope and returns the original grant ID', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const request = makeRequest()
    request.toolResponse.arguments = {
      localAcpTool: { title: 'Write report', rawInput: { file_path: '/tmp/report.txt', content: 'report body' } },
      tool: { toolCallId: 'call-1' },
      localPermissionOptions: [{ optionId: 'once', decision: 'accept', label: 'allow_once', name: 'Allow once' }]
    }
    render(<PermissionRequestComposer request={request} onRespond={onRespond} />)
    expect(screen.getByText('/tmp/report.txt')).toBeVisible()
    expect(screen.getByText('report body')).toBeVisible()
    expect(screen.queryByText('localAcpTool')).not.toBeInTheDocument()
    expect(screen.queryByText('localPermissionOptions')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '允许一次' }))
    expect(onRespond).toHaveBeenCalledWith({
      match: request.match,
      approved: true,
      updatedInput: { localPermissionOption: 'once' }
    })
  })

  it('supports Enter/Esc shortcuts and emphasizes only the primary allow option for local options', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'allow-once', decision: 'accept', label: 'allow_once', name: 'Allow once' },
        { optionId: 'allow-session', decision: 'acceptAlways', label: 'allow_always', name: 'Always allow' },
        { optionId: 'deny-once', decision: 'decline', label: 'deny', name: 'Reject' }
      ]
    }
    const { rerender } = render(<PermissionRequestComposer request={request} onRespond={onRespond} />)

    const primaryAllow = screen.getByRole('button', { name: '允许一次' })
    const secondaryAllow = screen.getByRole('button', { name: '始终允许' })
    const primaryReject = screen.getByRole('button', { name: 'Deny' })

    expect(primaryAllow).toHaveTextContent('Enter')
    expect(secondaryAllow).not.toHaveTextContent('Enter')
    expect(primaryReject).toHaveTextContent('Esc')
    expect(primaryAllow.className).toContain('bg-neutral-900')
    expect(secondaryAllow.className).toContain('bg-secondary')
    expect(primaryReject.className).toContain('border-border')

    fireEvent.keyDown(document, { key: 'Enter' })
    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith({
        match: request.match,
        approved: true,
        updatedInput: { localPermissionOption: 'allow-once' }
      })
    )

    const nextRequest = makeRequest({
      approvalId: 'approval-2',
      match: { ...makeRequest().match, approvalId: 'approval-2' }
    })
    nextRequest.toolResponse.arguments = request.toolResponse.arguments
    rerender(<PermissionRequestComposer request={nextRequest} onRespond={onRespond} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith({
        match: nextRequest.match,
        approved: false,
        updatedInput: { localPermissionOption: 'deny-once' }
      })
    )
  })

  // Catch evidence disclosure accidentally granting permission through the global Enter shortcut.
  it('shows execution facts and lets the user inspect evidence before granting one invocation', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn()
    const request = makeRequest({
      commandPolicy: {
        cwd: '/workspace/project',
        revision: '1',
        reason: 'May discard working-tree changes.',
        rules: [{ ruleId: 'git-risk', reasonCode: 'git-discard-worktree', evidence: 'git reset --hard' }]
      }
    })
    render(<PermissionRequestComposer request={request} onRespond={onRespond} />)
    expect(screen.getByText('May discard working-tree changes.')).toBeVisible()
    expect(screen.getByText('/workspace/project')).toBeVisible()
    const disclosure = screen.getByRole('button', { name: 'Matching command details' })
    disclosure.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('git reset --hard')).toBeVisible()
    expect(onRespond).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Allow this invocation/ }))
    expect(onRespond).toHaveBeenCalledWith({ match: request.match, approved: true })
  })

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

  describe('Agent settings changes', () => {
    // Each test uses its own approval, as the preview is fetched once per approval.
    function agentConfigRequest(approvalId: string, serverId: string, name: string, args: Record<string, unknown>) {
      return makeRequest({
        approvalId,
        title: name,
        toolResponse: {
          id: 'call-1',
          toolCallId: 'call-1',
          status: 'pending',
          arguments: args,
          tool: {
            id: `${serverId}__${name}`,
            name,
            type: 'mcp',
            serverId,
            serverName: serverId,
            inputSchema: { type: 'object', properties: {}, required: [] }
          }
        }
      })
    }

    it.each([
      ['update_agent', 'assistant', 'update_agent'],
      ['config_update', 'cherry_tools', 'config_update']
    ])(
      "shows %s as each changed field's current and new value, read for that approval",
      async (_tool, serverId, name) => {
        const approvalId = `approval-${name}`
        vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({
          ok: true,
          data: { ok: true, summary: ['Model: Default Model → Other Model'] }
        })
        render(
          <PermissionRequestComposer
            request={agentConfigRequest(approvalId, serverId, name, { model: 'wire::other' })}
            onRespond={vi.fn()}
          />
        )

        expect(await screen.findByText('Model: Default Model → Other Model')).toBeInTheDocument()
        expect(window.api.ipcApi.request).toHaveBeenCalledWith('ai.agent.preview_config_change', { approvalId })
      }
    )

    // A create's arguments carry the whole system prompt; the card shows the new resource instead.
    it('shows a create as the new resource with its raw arguments folded away', async () => {
      const user = userEvent.setup()
      vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          resource: {
            kind: 'agent',
            name: 'Reviewer',
            emoji: '🧐',
            description: 'Reviews pull requests',
            highlights: ['Other Model']
          }
        }
      })
      render(
        <PermissionRequestComposer
          request={agentConfigRequest('approval-create', 'cherry_tools', 'agent_create', {
            name: 'Reviewer',
            instructions: 'LONG_SYSTEM_PROMPT'
          })}
          onRespond={vi.fn()}
        />
      )

      // Wait for the preview: the raw arguments also name the Agent while it loads.
      expect(await screen.findByText('Reviews pull requests · Other Model')).toBeInTheDocument()
      expect(screen.getByText('Reviewer')).toBeInTheDocument()
      expect(screen.getByText('agent.toolPermission.agent_config.title.create_agent')).toBeInTheDocument()
      expect(screen.queryByText('LONG_SYSTEM_PROMPT')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Input' }))

      expect(screen.getByText('LONG_SYSTEM_PROMPT')).toBeInTheDocument()
    })

    // Catches a long prompt edit that can only be checked through its shortened summary line.
    it('shows the full current and new text of a long field on demand', async () => {
      const user = userEvent.setup()
      vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          summary: ['System Prompt: …Reply in English. → …Reply in French.'],
          details: [{ field: 'System Prompt', from: 'FULL_OLD_PROMPT', to: 'FULL_NEW_PROMPT' }]
        }
      })
      render(
        <PermissionRequestComposer
          request={agentConfigRequest('approval-details', 'assistant', 'update_agent', { instructions: 'x' })}
          onRespond={vi.fn()}
        />
      )

      await user.click(await screen.findByRole('button', { name: 'agent.toolPermission.agent_config.full_text' }))

      expect(screen.getByText('FULL_OLD_PROMPT')).toBeInTheDocument()
      expect(screen.getByText('FULL_NEW_PROMPT')).toBeInTheDocument()
    })

    it('keeps the raw arguments on screen while the preview loads', () => {
      vi.mocked(window.api.ipcApi.request).mockReturnValueOnce(new Promise(() => {}))
      render(
        <PermissionRequestComposer
          request={agentConfigRequest('approval-loading', 'assistant', 'update_agent', { model: 'wire::other' })}
          requiresAgentConfigPreview
          onRespond={vi.fn()}
        />
      )

      expect(screen.getByText('agent.toolPermission.agent_config.loading')).toBeInTheDocument()
      expect(screen.getByText('wire::other')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Allow/ })).toBeDisabled()
    })

    it('falls back to the raw arguments when main cannot preview the change', async () => {
      vi.mocked(window.api.ipcApi.request).mockResolvedValueOnce({ ok: true, data: { ok: false } })
      render(
        <PermissionRequestComposer
          request={agentConfigRequest('approval-refused', 'assistant', 'update_agent', {
            permissionMode: 'bypassPermissions'
          })}
          onRespond={vi.fn()}
        />
      )

      expect(await screen.findByText('agent.toolPermission.agent_config.error')).toBeInTheDocument()
      expect(screen.getByText('bypassPermissions')).toBeInTheDocument()
    })
  })

  it('renders ACP text content previews outside MessageListProvider without crashing', async () => {
    render(
      <PermissionRequestComposer
        request={makeRequest({
          toolResponse: {
            id: 'acp-write-1',
            toolCallId: 'acp-write-1',
            status: 'pending',
            arguments: {
              localAcpTool: {
                title: 'Write',
                kind: 'edit',
                status: 'pending',
                content: [
                  {
                    type: 'content',
                    content: {
                      type: 'text',
                      text: 'Requesting approval to write **tool_kimi.txt**'
                    }
                  }
                ]
              }
            },
            tool: {
              id: 'ACP: WriteFile',
              name: 'ACP: WriteFile',
              type: 'builtin'
            }
          }
        })}
        onRespond={vi.fn()}
      />
    )

    expect(await screen.findByText('tool_kimi.txt')).toBeInTheDocument()
  })

  it('deduplicates repeated option warnings and falls back Enter/Esc shortcuts to session/cancel decisions', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        {
          optionId: 'session-1',
          decision: 'acceptForSession',
          label: 'allow_session',
          name: 'Session',
          warning: 'Repeated security warning'
        },
        {
          optionId: 'always-1',
          decision: 'acceptAlways',
          label: 'allow_always',
          name: 'Always',
          warning: 'Repeated security warning'
        },
        { optionId: 'cancel-1', decision: 'cancel', label: 'cancel', name: 'Cancel' }
      ]
    }
    const { rerender } = render(<PermissionRequestComposer request={request} onRespond={onRespond} />)
    expect(screen.getAllByText('Repeated security warning')).toHaveLength(1)
    fireEvent.keyDown(document, { key: 'Enter' })
    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith({
        match: request.match,
        approved: true,
        updatedInput: { localPermissionOption: 'session-1' }
      })
    )

    const nextRequest = makeRequest({
      approvalId: 'approval-cancel',
      match: { ...makeRequest().match, approvalId: 'approval-cancel' }
    })
    nextRequest.toolResponse.arguments = request.toolResponse.arguments
    rerender(<PermissionRequestComposer request={nextRequest} onRespond={onRespond} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith({
        match: nextRequest.match,
        approved: false,
        updatedInput: { localPermissionOption: 'cancel-1' }
      })
    )
  })

  it('previews host-delegated ACP terminal commands without disclosing environment values', () => {
    const request = makeRequest()
    request.toolResponse.tool.name = 'ACP: Terminal'
    request.toolResponse.arguments = {
      command: '/bin/bash',
      args: ['-c', 'git status'],
      cwd: '/workspace',
      env: [{ name: 'GATEWAY_TOKEN', value: 'private-value' }]
    }
    render(<PermissionRequestComposer request={request} onRespond={vi.fn()} />)

    const preview = screen.getByTestId('permission-preview')
    expect(preview).toHaveTextContent('/bin/bash')
    expect(preview).toHaveTextContent('git status')
    expect(preview).toHaveTextContent('/workspace')
    expect(preview).toHaveTextContent('GATEWAY_TOKEN')
    expect(preview).not.toHaveTextContent('private-value')
  })

  it('requires explicit activation when ACP offers only persistent permission choices', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'persistent-allow', decision: 'acceptAlways', name: 'Allow every workspace check' },
        {
          optionId: 'persistent-deny',
          decision: 'decline',
          persistent: true,
          name: 'Reject every workspace check'
        }
      ]
    }

    render(<PermissionRequestComposer request={request} onRespond={onRespond} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onRespond).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Reject every workspace check' }))
    expect(onRespond).toHaveBeenCalledWith({
      match: request.match,
      approved: false,
      updatedInput: { localPermissionOption: 'persistent-deny' }
    })
  })

  it('orders compact local permission options from deny to allow (matching built-in agents)', () => {
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'allow-once', name: 'Allow once', label: 'allow_once', decision: 'accept' },
        { optionId: 'allow-session', name: 'Allow for session', label: 'allow_session', decision: 'acceptForSession' },
        { optionId: 'reject-once', name: 'Reject', label: 'deny', decision: 'decline' }
      ]
    }

    render(<PermissionRequestComposer request={request} onRespond={vi.fn()} />)

    const actions = screen.getByTestId('permission-actions')
    expect(actions).toHaveAttribute('data-layout', 'inline')
    const buttonTexts = within(actions)
      .getAllByRole('button')
      .map((button) => button.textContent?.replace(/\s+/g, ' ').trim())
    expect(buttonTexts).toEqual(['DenyEsc', '本次会话内允许', '允许一次Enter'])
  })

  it('stacks long Grok-style permission options vertically with primary allow first and dispatches clicked optionId', () => {
    const onRespond = vi.fn()
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        {
          optionId: 'allow-always-domain',
          name: 'Yes, always allow github.com for this project',
          decision: 'acceptAlways'
        },
        {
          optionId: 'allow-once',
          name: 'Yes, allow once',
          decision: 'accept'
        },
        {
          optionId: 'reject-once',
          name: 'No, and tell Grok what to do differently',
          decision: 'decline'
        },
        {
          optionId: 'reject-always-domain',
          name: 'No, never allow github.com for this project',
          decision: 'cancel'
        }
      ]
    }

    render(<PermissionRequestComposer request={request} onRespond={onRespond} />)

    const actions = screen.getByTestId('permission-actions')
    expect(actions).toHaveAttribute('data-layout', 'stacked')
    const buttons = within(actions).getAllByRole('button')
    expect(buttons.map((button) => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Yes, allow onceEnter',
      'Yes, always allow github.com for this project',
      'No, and tell Grok what to do differentlyEsc',
      'No, never allow github.com for this project'
    ])

    fireEvent.click(buttons[1])
    expect(onRespond).toHaveBeenCalledWith({
      match: request.match,
      approved: true,
      updatedInput: { localPermissionOption: 'allow-always-domain' }
    })
  })

  it('binds Esc to explicit deny instead of a preceding persistent deny amendment (Codex / ACP)', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'accept', decision: 'accept', label: 'allow', name: 'Allow' },
        {
          optionId: 'always-deny-host',
          decision: 'decline',
          name: 'Always deny host: github.com'
        },
        { optionId: 'decline', decision: 'decline', label: 'deny', name: 'Deny' },
        { optionId: 'cancel', decision: 'cancel', label: 'cancel', name: 'Cancel' }
      ]
    }

    render(<PermissionRequestComposer request={request} onRespond={onRespond} />)

    const actions = screen.getByTestId('permission-actions')
    expect(actions).toHaveAttribute('data-layout', 'stacked')
    const buttonTexts = within(actions)
      .getAllByRole('button')
      .map((button) => button.textContent?.replace(/\s+/g, ' ').trim())
    expect(buttonTexts).toEqual(['AllowEnter', 'DenyEsc', 'Always deny host: github.com', 'Cancel'])

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(onRespond).toHaveBeenCalledWith({
        match: request.match,
        approved: false,
        updatedInput: { localPermissionOption: 'decline' }
      })
    )
  })

  it('stacks CJK ACP permission options when wide characters exceed compact visual width', () => {
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'allow-once', decision: 'accept', label: 'allow_once', name: 'Allow once' },
        { optionId: 'allow-domain', decision: 'acceptAlways', name: '始终允许当前项目访问此域名' },
        { optionId: 'reject-once', decision: 'decline', label: 'deny', name: 'Deny' }
      ]
    }

    render(<PermissionRequestComposer request={request} onRespond={vi.fn()} />)

    const actions = screen.getByTestId('permission-actions')
    expect(actions).toHaveAttribute('data-layout', 'stacked')
  })

  it('stacks four medium-width options that would wrap while keeping Codex compact four-option layout inline', () => {
    const mediumRequest = makeRequest()
    mediumRequest.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'allow-once', decision: 'accept', name: 'Yes, allow once' },
        { optionId: 'allow-always', decision: 'acceptAlways', name: 'Yes, always allow' },
        { optionId: 'reject-once', decision: 'decline', name: 'No, deny once' },
        { optionId: 'reject-always', decision: 'cancel', name: 'No, never allow' }
      ]
    }
    const { rerender } = render(<PermissionRequestComposer request={mediumRequest} onRespond={vi.fn()} />)
    expect(screen.getByTestId('permission-actions')).toHaveAttribute('data-layout', 'stacked')

    const codexCompactRequest = makeRequest({
      approvalId: 'approval-codex-compact',
      match: { ...makeRequest().match, approvalId: 'approval-codex-compact' }
    })
    codexCompactRequest.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'accept', decision: 'accept', label: 'allow', name: 'Allow' },
        {
          optionId: 'acceptForSession',
          decision: 'acceptForSession',
          label: 'allow_session',
          name: 'Allow for session'
        },
        { optionId: 'decline', decision: 'decline', label: 'deny', name: 'Deny' },
        { optionId: 'cancel', decision: 'cancel', label: 'cancel', name: 'Cancel' }
      ]
    }
    rerender(<PermissionRequestComposer request={codexCompactRequest} onRespond={vi.fn()} />)

    const actions = screen.getByTestId('permission-actions')
    expect(actions).toHaveAttribute('data-layout', 'inline')
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent?.replace(/\s+/g, ' ').trim())
    ).toEqual(['Cancel', 'DenyEsc', '本次会话内允许', 'AllowEnter'])
  })

  it('localizes Codex command/host amendments instead of mixing English labels with Chinese UI', () => {
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'accept', decision: 'accept', label: 'allow', name: 'Allow' },
        {
          optionId: 'execpolicy-1',
          decision: 'acceptAlways',
          label: 'allow_always_target',
          labelTarget: 'prlctl start Windows 11',
          name: 'Always allow: prlctl start Windows 11'
        },
        {
          optionId: 'deny-host-1',
          decision: 'decline',
          label: 'deny_always_host',
          labelTarget: 'github.com',
          name: 'Always deny host: github.com'
        },
        { optionId: 'decline', decision: 'decline', label: 'deny', name: 'Deny' }
      ]
    }

    render(<PermissionRequestComposer request={request} onRespond={vi.fn()} />)

    const actions = screen.getByTestId('permission-actions')
    expect(actions).toHaveAttribute('data-layout', 'stacked')
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent?.replace(/\s+/g, ' ').trim())
    ).toEqual(['AllowEnter', '始终允许：prlctl start Windows 11', 'DenyEsc', '始终拒绝主机：github.com'])
  })

  it('stacks and contains huge unbroken Codex command amendments without horizontal overflow', () => {
    const hugeCommand =
      'prlctl exec Windows11 powershell -NoProfile -Command Get-Process explorer; Get-Command node,electron -ErrorAction SilentlyContinue; Get-ChildItem C:\\ProgramFiles\\VeryLongUnbrokenDirectoryNameForOverflowTest\\SubFolder'
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'accept', decision: 'accept', label: 'allow', name: 'Allow' },
        {
          optionId: 'execpolicy-huge',
          decision: 'acceptAlways',
          label: 'allow_always_target',
          labelTarget: hugeCommand,
          name: `Always allow: ${hugeCommand}`
        },
        { optionId: 'cancel', decision: 'cancel', label: 'cancel', name: 'Cancel' }
      ]
    }

    render(<PermissionRequestComposer request={request} onRespond={vi.fn()} />)

    const actions = screen.getByTestId('permission-actions')
    expect(actions).toHaveAttribute('data-layout', 'stacked')
    const expectedLabel = `始终允许：${hugeCommand}`
    const hugeButton = screen.getByRole('button', { name: expectedLabel })
    expect(hugeButton).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-hidden')
    expect(hugeButton).toHaveAttribute('title', expectedLabel)
    const labelSpan = within(hugeButton).getByText(expectedLabel)
    expect(labelSpan).toHaveClass('line-clamp-2', 'min-w-0', '[overflow-wrap:anywhere]')
  })

  it('always stacks parameterized rules even when target text is short (ls)', () => {
    const request = makeRequest()
    request.toolResponse.arguments = {
      localPermissionOptions: [
        { optionId: 'accept', decision: 'accept', label: 'allow', name: 'Allow' },
        {
          optionId: 'execpolicy-short',
          decision: 'acceptAlways',
          label: 'allow_always_target',
          labelTarget: 'ls',
          name: 'Always allow: ls'
        },
        { optionId: 'decline', decision: 'decline', label: 'deny', name: 'Deny' }
      ]
    }

    render(<PermissionRequestComposer request={request} onRespond={vi.fn()} />)

    const actions = screen.getByTestId('permission-actions')
    expect(actions).toHaveAttribute('data-layout', 'stacked')
    expect(
      within(actions)
        .getAllByRole('button')
        .map((button) => button.textContent?.replace(/\s+/g, ' ').trim())
    ).toEqual(['AllowEnter', '始终允许：ls', 'DenyEsc'])
  })

  it('switches standard verb actions from inline to stacked via ResizeObserver when the container narrows', () => {
    let observedWidth = 640
    let observerCallback: ResizeObserverCallback | undefined

    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallback = callback
      }
      observe(target: Element) {
        Object.defineProperty(target, 'clientWidth', {
          configurable: true,
          get: () => observedWidth
        })
      }
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    try {
      const request = makeRequest()
      request.toolResponse.arguments = {
        localPermissionOptions: [
          { optionId: 'accept', decision: 'accept', label: 'allow', name: 'Allow' },
          {
            optionId: 'acceptForSession',
            decision: 'acceptForSession',
            label: 'allow_session',
            name: 'Allow for session'
          },
          { optionId: 'decline', decision: 'decline', label: 'deny', name: 'Deny' },
          { optionId: 'cancel', decision: 'cancel', label: 'cancel', name: 'Cancel' }
        ]
      }

      render(<PermissionRequestComposer request={request} onRespond={vi.fn()} />)
      const actions = screen.getByTestId('permission-actions')
      expect(actions).toHaveAttribute('data-layout', 'inline')

      observedWidth = 260
      act(() => {
        observerCallback?.([], {} as ResizeObserver)
      })

      expect(actions).toHaveAttribute('data-layout', 'stacked')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
