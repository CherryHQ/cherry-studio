import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type * as ReactI18next from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'

import PermissionRequestComposer, { type PermissionRequestComposerRequest } from '../PermissionRequestComposer'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18next>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const table: Record<string, string> = {
        'agent.toolPermission.defaultDenyMessage': 'User denied permission for this tool.',
        'agent.toolPermission.error.sendFailed': 'Failed to send your decision. Please try again.',
        'agent.toolPermission.reasonLabel': 'Reason for rejection (optional)',
        'agent.toolPermission.reasonPlaceholder': 'Tell the Agent what to do instead',
        'agent.toolPermission.confirmation': 'Allow tool call?',
        'agent.toolPermission.inputPreview': 'Tool input preview',
        'agent.toolPermission.button.allow': 'Allow',
        'agent.toolPermission.button.deny': 'Deny',
        'agent.toolPermission.button.run': 'Run',
        'agent.toolPermission.waiting': 'Waiting for tool permission decision...',
        'agent.toolPermission.executionModel.notice': 'Plan execution model: {{model}}',
        'agent.toolPermission.executionModel.unavailable': '{{model}} cannot be used here',
        'message.processing': 'Processing',
        'message.tools.activity.checking': 'Checking',
        'message.tools.activity.projectChecks': 'project checks',
        'message.tools.activity.relatedContent': 'related content',
        'message.tools.activity.searching': 'Searching',
        'message.tools.activity.usingExtension': 'Bringing in an extension',
        'message.tools.labels.mcpServerTool': 'MCP Server Tool',
        'message.tools.labels.tool': 'Tool',
        'message.tools.sections.input': 'Input'
      }
      const value = table[key] ?? key
      return options ? value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options[name] ?? '')) : value
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

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [{ id: 'anthropic', name: 'Anthropic' }] })
}))

const planExecutionPreference = vi.hoisted(() => ({ modelId: null as string | null }))
const modelByIdFixture = vi.hoisted(() => ({
  model: undefined as { id: string; name: string; providerId: string } | undefined
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) =>
    key === 'chat.plan_execution.model_id' ? [planExecutionPreference.modelId, vi.fn()] : [undefined, vi.fn()]
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: (uniqueModelId: unknown) => ({ model: uniqueModelId ? modelByIdFixture.model : undefined })
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

function makePlanRequest(): PermissionRequestComposerRequest {
  return makeRequest({
    title: 'ExitPlanMode',
    toolResponse: {
      id: 'exit-plan-call-1',
      toolCallId: 'exit-plan-call-1',
      status: 'pending',
      arguments: { plan: '# Plan' },
      tool: { id: 'ExitPlanMode', name: 'ExitPlanMode', type: 'builtin' }
    }
  })
}

/** An MCP tool that merely shares the plan-exit name — it carries no plan semantics. */
function makeCollidingMcpRequest(): PermissionRequestComposerRequest {
  return makeRequest({
    title: 'exit_plan_mode',
    toolResponse: {
      id: 'mcp-plan-call-1',
      toolCallId: 'mcp-plan-call-1',
      status: 'pending',
      arguments: { plan: '# Plan' },
      tool: { id: 'exit_plan_mode', name: 'exit_plan_mode', type: 'mcp', serverName: 'plans' }
    } as NormalToolResponse
  })
}

function configurePlanExecutionModel(overrides: Partial<{ id: string; name: string; providerId: string }> = {}) {
  const model = { id: 'anthropic::claude-opus-5', name: 'Claude Opus 5', providerId: 'anthropic', ...overrides }
  planExecutionPreference.modelId = model.id
  modelByIdFixture.model = model
  return model
}

describe('PermissionRequestComposer', () => {
  beforeEach(() => {
    planExecutionPreference.modelId = null
    modelByIdFixture.model = undefined
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

    expect(screen.getByRole('heading', { name: 'Processing' })).toBeInTheDocument()
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

  it('trims and submits user feedback without changing the denial decision', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

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

    expect(screen.getByRole('heading', { name: 'Bringing in an extension' })).toBeInTheDocument()
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

  it('names the configured plan-execution model only on a plan approval', () => {
    configurePlanExecutionModel()
    const { rerender } = render(
      <PermissionRequestComposer request={makePlanRequest()} onRespond={vi.fn()} planExecution={{}} />
    )

    expect(screen.getByTestId('plan-execution-model')).toHaveTextContent('Plan execution model: Claude Opus 5')

    rerender(<PermissionRequestComposer request={makeRequest()} onRespond={vi.fn()} planExecution={{}} />)
    expect(screen.queryByTestId('plan-execution-model')).not.toBeInTheDocument()
  })

  it('says nothing when no plan-execution model is configured', () => {
    const { rerender } = render(<PermissionRequestComposer request={makePlanRequest()} onRespond={vi.fn()} />)

    expect(screen.queryByTestId('plan-execution-model')).not.toBeInTheDocument()

    rerender(<PermissionRequestComposer request={makePlanRequest()} onRespond={vi.fn()} planExecution={{}} />)
    expect(screen.queryByTestId('plan-execution-model')).not.toBeInTheDocument()
  })

  it('warns when the agent runtime cannot run the configured plan-execution model', () => {
    configurePlanExecutionModel()
    render(
      <PermissionRequestComposer
        request={makePlanRequest()}
        onRespond={vi.fn()}
        planExecution={{ modelFilter: (model) => model.id !== 'anthropic::claude-opus-5' }}
      />
    )

    expect(screen.getByTestId('plan-execution-model')).toHaveTextContent('Claude Opus 5 cannot be used here')
  })

  it('warns when the availability gate rejects the configured plan-execution model', () => {
    configurePlanExecutionModel()
    render(
      <PermissionRequestComposer
        request={makePlanRequest()}
        onRespond={vi.fn()}
        planExecution={{ isModelDisabled: (model) => model.id === 'anthropic::claude-opus-5' }}
      />
    )

    expect(screen.getByTestId('plan-execution-model')).toHaveTextContent('Claude Opus 5 cannot be used here')
  })

  // Runtime compatibility predicates are provider-aware and fail closed without one, so the gates
  // must see the configured model's Provider or every pi/dsh model looks unusable.
  it('evaluates the gates against the configured model with its provider', () => {
    configurePlanExecutionModel()
    const seen: Array<{ modelId: string; providerId: string | undefined }> = []
    render(
      <PermissionRequestComposer
        request={makePlanRequest()}
        onRespond={vi.fn()}
        planExecution={{
          modelFilter: (model, provider) => {
            seen.push({ modelId: model.id, providerId: provider?.id })
            return true
          }
        }}
      />
    )

    expect(seen).toEqual([{ modelId: 'anthropic::claude-opus-5', providerId: 'anthropic' }])
    expect(screen.getByTestId('plan-execution-model')).toHaveTextContent('Plan execution model: Claude Opus 5')
  })

  it('never hands off for an MCP tool that merely shares the plan-exit name', async () => {
    configurePlanExecutionModel()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeCollidingMcpRequest()} onRespond={onRespond} planExecution={{}} />)

    expect(screen.queryByTestId('plan-execution-model')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({ match: makeCollidingMcpRequest().match, approved: true })
  })

  it('approves a plan without a configured model exactly as before', async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const planRequest = makePlanRequest()
    render(<PermissionRequestComposer request={planRequest} onRespond={onRespond} planExecution={{}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({ match: planRequest.match, approved: true })
  })

  it('approves a plan with the configured execution model for the fresh-turn restart', async () => {
    configurePlanExecutionModel()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const planRequest = makePlanRequest()
    render(<PermissionRequestComposer request={planRequest} onRespond={onRespond} planExecution={{}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: planRequest.match,
      approved: true,
      executionModelId: 'anthropic::claude-opus-5'
    })
  })

  // A malformed handoff id would stop the approved turn without a usable execution follow-up —
  // the approval must go through without it rather than sending an id Main cannot resolve.
  it('approves a plan without the handoff when the configured model id is malformed', async () => {
    configurePlanExecutionModel({ id: 'not-a-model-id' })
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const planRequest = makePlanRequest()
    render(<PermissionRequestComposer request={planRequest} onRespond={onRespond} planExecution={{}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({ match: planRequest.match, approved: true })
  })

  // A configured model the gates refuse must not reach Main as a requested handoff.
  it('drops a configured plan-execution model the gates would not offer', async () => {
    configurePlanExecutionModel()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const planRequest = makePlanRequest()
    render(
      <PermissionRequestComposer
        request={planRequest}
        onRespond={onRespond}
        planExecution={{ modelFilter: (model) => model.id !== 'anthropic::claude-opus-5' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({ match: planRequest.match, approved: true })
  })

  // Main refuses a handoff that is not a plan approval — but only after the approval has already
  // been dispatched, so a non-plan tool must never carry one in the first place.
  it('never requests an execution-model handoff for a non-plan tool approval', async () => {
    configurePlanExecutionModel()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} planExecution={{}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({ match: makeRequest().match, approved: true })
  })

  // Home has no agent whose model a handoff could switch, and its IPC layer drops the id anyway.
  it('requests no handoff without an agent context', async () => {
    configurePlanExecutionModel()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const planRequest = makePlanRequest()
    render(<PermissionRequestComposer request={planRequest} onRespond={onRespond} />)

    expect(screen.queryByTestId('plan-execution-model')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({ match: planRequest.match, approved: true })
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

  it('uses the streaming tool icon and semantic title for the approval header', () => {
    render(
      <PermissionRequestComposer
        request={makeRequest({
          title: 'Bash',
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

    const heading = screen.getByRole('heading', { name: 'Checking project checks' })
    expect(heading.querySelector('.lucide-square-terminal')).toBeInTheDocument()
    expect(screen.queryByText('Allow tool call?')).not.toBeInTheDocument()
  })

  it('hides the request subtitle when it only repeats the tool name', () => {
    render(<PermissionRequestComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Processing' })).toBeInTheDocument()
    expect(screen.getAllByText('CustomTool')).toHaveLength(1)
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
      approved: false,
      reason: 'User denied permission for this tool.'
    })
  })

  it('denies with the typed reason when Enter is pressed inside the rejection reason', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

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

    const reason = screen.getByRole('textbox', { name: 'Reason for rejection (optional)' })
    await user.click(reason)
    await user.keyboard('{Escape}')

    expect(onRespond).not.toHaveBeenCalled()
  })

  it('keeps Shift+Enter as a newline inside the rejection reason', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

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

    await user.type(screen.getByRole('textbox', { name: 'Reason for rejection (optional)' }), 'use a copy instead')
    fireEvent.keyDown(document, { key: 'Enter' })

    await waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1))
    expect(onRespond).toHaveBeenCalledWith({
      match: makeRequest().match,
      approved: false,
      reason: 'use a copy instead'
    })
  })

  it('moves the Enter hint onto Deny once a rejection reason is typed', async () => {
    const user = userEvent.setup()
    render(<PermissionRequestComposer request={makeRequest()} onRespond={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Allow/ })).toHaveTextContent('Enter')
    expect(screen.getByRole('button', { name: /Deny/ })).toHaveTextContent('Esc')

    await user.type(screen.getByRole('textbox', { name: 'Reason for rejection (optional)' }), 'use a copy instead')

    expect(screen.getByRole('button', { name: /Allow/ })).not.toHaveTextContent('Enter')
    expect(screen.getByRole('button', { name: /Deny/ })).toHaveTextContent('Enter')
  })

  it('does not carry a rejection reason into the next approval request', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<PermissionRequestComposer request={makeRequest()} onRespond={onRespond} />)

    await user.type(screen.getByRole('textbox', { name: 'Reason for rejection (optional)' }), 'use a copy instead')

    rerender(
      <PermissionRequestComposer
        request={makeRequest({ approvalId: 'approval-2', match: { ...makeRequest().match, approvalId: 'approval-2' } })}
        onRespond={onRespond}
      />
    )

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
