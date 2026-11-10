import './editDialogFixture'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AgentEditDialog } from '../AgentEditDialog'
import { AssistantEditDialog } from '../AssistantEditDialog'
import {
  createGroupMock,
  fetchGenerateMock,
  installedSkillsState,
  mcpStatusState,
  promptProcessorMock,
  updateAgentMock,
  updateAssistantMock,
  useQueryMock,
  MODEL,
  ASSISTANT,
  AGENT,
  selectTab,
  expectHelpTrigger,
  openGroupSelect
} from './editDialogFixture'

describe('edit dialogs', () => {
  it('submits assistant name, description, and model changes as a PATCH', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Assistant' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated assistant description' } })
    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    expect(modelTrigger).toHaveTextContent('Old Model')
    expect(modelTrigger).not.toHaveTextContent('Provider')
    fireEvent.click(modelTrigger)
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          name: 'Updated Assistant',
          description: 'Updated assistant description',
          modelId: MODEL.id
        })
      })
    )
  })

  it('shows the clear model affordance beside the chevron and clears the selected model', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const modelTrigger = screen.getByRole('button', { name: 'Model' })
    const clearButton = screen.getByRole('button', { name: 'Model Clear' })

    expect(modelTrigger).toBeInTheDocument()

    fireEvent.click(clearButton)
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          modelId: null
        })
      })
    )
  })

  it('submits assistant group changes directly', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    openGroupSelect()
    fireEvent.click(await screen.findByRole('option', { name: 'personal' }))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          groupId: 'group-personal'
        })
      })
    )
  })

  it('creates and selects an assistant group from the group field', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    openGroupSelect()
    fireEvent.click(await screen.findByRole('option', { name: 'New Group' }))

    const createDialog = screen.getByRole('dialog', { name: 'New Group' })
    fireEvent.change(within(createDialog).getByLabelText('Name'), { target: { value: '  created  ' } })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(createGroupMock).toHaveBeenCalledWith('created'))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          groupId: 'group-created'
        })
      })
    )
  })

  it('clears the assistant group from the single-select group field', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const clearButton = screen.getByRole('button', { name: 'Group Clear' })
    fireEvent.click(clearButton)
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          groupId: null
        })
      })
    )
  })

  it('keeps assistant grouping single-select while exposing the shared create action', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    openGroupSelect()
    expect(screen.queryByPlaceholderText('Search groups')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'No group' })).not.toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'New Group' })).toBeInTheDocument()
  })

  it('closes the group selector without closing the assistant edit dialog when clicking elsewhere inside it', async () => {
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    openGroupSelect()
    await screen.findByRole('option', { name: 'personal' })
    fireEvent.pointerDown(screen.getByLabelText('Name'))
    fireEvent.click(screen.getByLabelText('Name'))

    await waitFor(() => expect(screen.queryByRole('option', { name: 'personal' })).not.toBeInTheDocument())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('submits agent instructions and model changes as a PATCH', async () => {
    promptProcessorMock.mockImplementation(({ prompt, modelName }: { prompt: string; modelName?: string }) =>
      prompt.replaceAll('{{model_name}}', modelName ?? '')
    )
    render(
      <AgentEditDialog
        open
        resource={{ ...AGENT, instructions: 'Original instructions {{model_name}}' }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('System Prompt')
    expect(screen.getByRole('button', { name: 'System variables' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('tabpanel', { name: 'System Prompt' })).getByText('System Prompt')
    ).toBeInTheDocument()
    const instructionsInput = screen.getByLabelText('Prompt editor')
    expect(instructionsInput).toHaveAttribute('placeholder', 'Tell this assistant how to respond')
    expect(screen.getByLabelText('Prompt preview')).toHaveTextContent('Original instructions Old Model')
    expect(promptProcessorMock).toHaveBeenLastCalledWith({
      prompt: 'Original instructions {{model_name}}',
      modelName: 'Old Model'
    })
    fireEvent.change(instructionsInput, { target: { value: 'Updated instructions {{model_name}}' } })
    selectTab('Basic')
    // The trigger is named by its visible label, which is Claude Code's opus slot on this agent.
    const modelTrigger = screen.getByRole('button', { name: 'Model (Opus)' })
    expect(modelTrigger).toHaveTextContent('Old Model')
    expect(modelTrigger).not.toHaveTextContent('Provider')
    fireEvent.click(modelTrigger)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick model' })[0])
    selectTab('System Prompt')
    await waitFor(() =>
      expect(screen.getByLabelText('Prompt preview')).toHaveTextContent('Updated instructions Updated Model')
    )
    expect(promptProcessorMock).toHaveBeenLastCalledWith({
      prompt: 'Updated instructions {{model_name}}',
      modelName: 'Updated Model'
    })
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          model: MODEL.id,
          instructions: 'Updated instructions {{model_name}}'
        })
      })
    )
  })

  // The three model tiers pin Claude Code's opus / sonnet / haiku aliases rather than
  // being three parallel work tiers, and the sonnet slot has nothing to do with Plan mode.
  // Each label therefore carries a help trigger naming the variable it becomes.
  it('explains what each agent model slot is wired to', () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('Basic')
    expectHelpTrigger('Model (Opus)', 'Pins the opus alias (ANTHROPIC_MODEL).')
    expectHelpTrigger('Plan model', 'Plan model.')
    expectHelpTrigger('Small model', 'Small model.')
  })

  // Only Claude Code reads ANTHROPIC_DEFAULT_*_MODEL, so a Pi agent must not be told
  // that its primary model pins an `opus` alias it does not have.
  it('names no Claude Code alias on a runtime that has no model tiers', () => {
    render(<AgentEditDialog open resource={{ ...AGENT, type: 'pi' }} onOpenChange={vi.fn()} />)

    selectTab('Basic')
    expectHelpTrigger('Model', 'Primary agent model.')
    expect(screen.queryByRole('button', { name: 'Model (Opus) Help' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plan model Help' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Small model Help' })).not.toBeInTheDocument()
  })

  it('persists a heartbeat timeout edit independently of the interval', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)
    const field = screen.getByLabelText('Maximum Execution Time (minutes)')
    expect(field).toHaveValue('2')

    await user.clear(field)
    await user.type(field, '10')
    await user.tab()

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: { configuration: { heartbeat_timeout_minutes: 10 } }
      })
    )
  })

  // The heartbeat is turned off by its switch, so an emptied interval is a retype,
  // not a value — a persisted 0 would be a heartbeat interval of zero minutes.
  it('does not persist a zero heartbeat interval when the field is cleared', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    const field = screen.getByLabelText('Heartbeat interval')
    await user.clear(field)
    await user.tab()

    expect(field).toHaveValue('30')
    expect(updateAgentMock).not.toHaveBeenCalled()
  })

  it('cancels Full Access on authoritative editor refresh without losing other edits (inv_787184d14a5afca7)', async () => {
    const user = userEvent.setup()
    const agent = { ...AGENT, configuration: { ...AGENT.configuration, permission_mode: 'auto' as const } }
    const props = { open: true, onOpenChange: vi.fn() }
    const { rerender } = render(<AgentEditDialog {...props} resource={agent} />)
    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'Local name' } })
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalled())
    updateAgentMock.mockClear()
    await user.click(screen.getByRole('combobox', { name: 'Permission mode' }))
    await user.click(screen.getByRole('option', { name: /Full Access/ }))
    expect(screen.getByText('Enable Full Access?')).toBeInTheDocument()
    rerender(
      <AgentEditDialog
        {...props}
        resource={{ ...agent, configuration: { ...agent.configuration, permission_mode: 'plan' } }}
      />
    )
    await waitFor(() => expect(screen.queryByText('Enable Full Access?')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Avatar and name')).toHaveValue('Local name')
    expect(updateAgentMock).not.toHaveBeenCalled()
  })

  it('does not turn externally refreshed agent fields into stale PATCH values', async () => {
    const props = { open: true, onOpenChange: vi.fn() }
    const { rerender } = render(<AgentEditDialog {...props} resource={AGENT} />)

    rerender(
      <AgentEditDialog
        {...props}
        resource={{
          ...AGENT,
          configuration: { ...AGENT.configuration, permission_mode: 'plan' }
        }}
      />
    )
    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'Locally renamed' } })

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: { name: 'Locally renamed' }
      })
    )
  })

  it('advances the agent form baseline before a queued follow-up save', async () => {
    let resolveFirstSave: (() => void) | undefined
    updateAgentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = () => resolve({ ...AGENT, name: 'First edit' })
        })
    )
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'First edit' } })
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Second edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    resolveFirstSave?.()

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(2))
    expect(updateAgentMock.mock.calls[1][0]).toEqual({
      body: { description: 'Second edit' }
    })
  })

  it('preserves skill baseline initialization while an unrelated save is pending', async () => {
    installedSkillsState.current = {
      ...installedSkillsState.current,
      refreshing: true
    }
    let resolveFirstSave: (() => void) | undefined
    updateAgentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = () => resolve({ ...AGENT, name: 'First edit' })
        })
    )
    const props = { open: true, resource: AGENT, onOpenChange: vi.fn() }
    const { rerender } = render(<AgentEditDialog {...props} />)

    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'First edit' } })
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: installedSkillsState.current.skills.map((skill) => ({ ...skill, isEnabled: true })),
      refreshing: false
    }
    rerender(<AgentEditDialog {...props} />)
    selectTab('技能')
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Skill One' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Skill One' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Skill One' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    resolveFirstSave?.()

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(2))
    expect(updateAgentMock.mock.calls[1][0]).toEqual({
      body: { skillUpdates: [{ skillId: 'skill-1', isEnabled: false }] }
    })
  })

  it('polishes agent instructions and auto-saves the polished value', async () => {
    fetchGenerateMock.mockResolvedValue('Polished agent instructions')
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('System Prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))

    await waitFor(() => expect(screen.getByLabelText('Prompt editor')).toHaveValue('Polished agent instructions'))
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.stringContaining('Improve the supplied system prompt without changing its intent or authority.'),
      content: 'Original instructions',
      throwOnError: true,
      signal: expect.any(AbortSignal)
    })

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({ instructions: 'Polished agent instructions' })
      })
    )
  })

  it('generates agent instructions from the agent name when instructions are blank', async () => {
    fetchGenerateMock.mockResolvedValue('Generated agent instructions')
    render(<AgentEditDialog open resource={{ ...AGENT, instructions: '' }} onOpenChange={vi.fn()} />)

    selectTab('System Prompt')
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('0')
    const generateButton = screen.getByRole('button', { name: 'Generate prompt' })
    expect(generateButton).toBeEnabled()
    fireEvent.click(generateButton)

    await waitFor(() =>
      expect(fetchGenerateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('You are a Prompt Generator.'),
          content: 'Alpha Agent',
          throwOnError: true
        })
      )
    )
    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Generated agent instructions')
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('1')
  })

  it('allows closing and tab navigation while an agent prompt action is in flight', async () => {
    fetchGenerateMock.mockReturnValueOnce(new Promise<string>(() => undefined))
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    selectTab('System Prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    selectTab('Basic')

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps MCP catalog rows compact without detail text', async () => {
    mcpStatusState.current = {
      'mcp-command-only': { state: 'connected', lastCheckedAt: 1 }
    }
    useQueryMock.mockImplementation((path: string) => {
      if (path === '/mcp-servers') {
        return {
          data: {
            items: [
              {
                id: 'mcp-command-only',
                name: '@cherry/mcp-auto-install',
                description: 'Installs MCP servers automatically',
                baseUrl: 'https://mcp.example.com',
                command: 'npx',
                isActive: true
              }
            ]
          },
          isLoading: false
        }
      }
      if (path === '/prompts' || path.startsWith('/prompt-bindings/')) {
        return { data: [], isLoading: false, refetch: vi.fn() }
      }
      return { data: { items: [] }, isLoading: false }
    })

    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('MCP')

    expect(await screen.findByText('@cherry/mcp-auto-install')).toBeInTheDocument()
    expect(screen.queryByText('Installs MCP servers automatically')).not.toBeInTheDocument()
    expect(screen.queryByText('https://mcp.example.com')).not.toBeInTheDocument()
    expect(screen.queryByText('npx')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '@cherry/mcp-auto-install' })).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })
})
