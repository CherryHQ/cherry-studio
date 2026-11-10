import './editDialogFixture'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentDetail } from '@renderer/types/resourceCatalog'
import type { Assistant } from '@shared/data/types/assistant'

import { AgentEditDialog } from '../AgentEditDialog'
import { AssistantEditDialog } from '../AssistantEditDialog'
import {
  fetchGenerateMock,
  installedSkillsState,
  ipcRequestMock,
  knowledgeBasesState,
  openSettingsTabMock,
  settingsNavigateMock,
  skillCatalogPickerMock,
  updateAgentMock,
  updateAssistantMock,
  ASSISTANT,
  AGENT,
  PI_AGENT,
  selectTab,
  expectHelpTrigger,
  expectVariablesHelpOnOpen,
  mockDeferredAnimationFrames
} from './editDialogFixture'

describe('edit dialogs', () => {
  it('submits assistant knowledge, MCP, and model parameter changes', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Knowledge' })).toBeInTheDocument()

    selectTab('Knowledge')
    await waitFor(() => expect(screen.getByText('Linked knowledge')).toBeVisible())
    expectHelpTrigger('Linked knowledge', 'Choose knowledge bases.')
    const addKnowledgeButton = screen.getByRole('button', { name: 'Add knowledge base' })
    fireEvent.click(addKnowledgeButton)
    expect(screen.getByText('Knowledge One')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Knowledge One'))

    selectTab('MCP')
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'MCP Mode' })).toBeVisible())
    expect(screen.queryByRole('button', { name: 'Add MCP server' })).not.toBeInTheDocument()
    const mcpModeGroup = screen.getByRole('radiogroup', { name: 'MCP Mode' })
    expect(within(mcpModeGroup).getByRole('radio', { name: 'Disabled' })).toHaveAttribute('aria-checked', 'false')
    expect(within(mcpModeGroup).getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(mcpModeGroup).getByRole('radio', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('switch', { name: 'MCP One' }))

    selectTab('Model')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Temperature Help' })).toBeVisible())
    expectHelpTrigger('Temperature', 'Controls randomness.')
    expectHelpTrigger('Top-P', 'Controls nucleus sampling.')
    expectHelpTrigger('Max tokens', 'Caps response length.')
    expectHelpTrigger('Stream output', 'Stream responses.')
    expectHelpTrigger('Max tool call rounds', 'Caps tool-call rounds at 100.')
    expectHelpTrigger('Custom parameters', 'Extra provider parameters.')
    fireEvent.click(screen.getByRole('switch', { name: 'Temperature' }))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          knowledgeBaseIds: ['kb-1'],
          mcpServerIds: ['mcp-1'],
          settings: expect.objectContaining({
            enableTemperature: true,
            mcpMode: 'manual'
          })
        })
      })
    )
  })

  it('names custom parameter value inputs for screen-reader users', async () => {
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: {
            ...ASSISTANT.settings,
            customParameters: [
              { name: 'stop', type: 'string', value: 'END' },
              { name: '', type: 'number', value: 0 }
            ]
          }
        }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('Model')

    expect(await screen.findByRole('textbox', { name: 'Parameter value: stop' })).toHaveValue('END')
    expect(screen.getByRole('spinbutton', { name: 'Parameter value' })).toHaveValue('0')
  })

  // `-` and `1e` are viable prefixes the field holds without reporting them, so the
  // last thing the live callback saw was the clear that preceded them. Abandoning
  // such an edit has to settle back to what it started from, not keep that clear.
  it('restores a custom numeric parameter abandoned mid-keystroke', async () => {
    const user = userEvent.setup()
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: {
            ...ASSISTANT.settings,
            customParameters: [{ name: 'temperature', type: 'number', value: 5 }]
          }
        }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('Model')

    const input = await screen.findByRole('spinbutton', { name: 'Parameter value: temperature' })
    await user.clear(input)
    await user.type(input, '-')
    await user.tab()

    expect(input).toHaveValue('5')
  })

  it('names the context override for what it does and states what is inherited while off', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Model')

    // The switch overrides the globals — it does not turn context management
    // off, so it must not be named after the feature.
    const overrideSwitch = await screen.findByRole('switch', { name: 'Customize context management' })
    expect(overrideSwitch).not.toBeChecked()
    expect(screen.getByText('Following the global settings')).toBeVisible()
    // Offload/compression fields belong to the override and stay hidden…
    expect(screen.queryByLabelText('Tool-output truncation threshold')).not.toBeInTheDocument()

    fireEvent.click(overrideSwitch)

    expect(await screen.findByLabelText('Tool-output truncation threshold')).toBeInTheDocument()
    expect(screen.queryByText('Following the global settings')).not.toBeInTheDocument()
  })

  // The compression trigger is a three-state override: empty means inherit, and the
  // unit is a standing label on the field rather than part of any value.
  it('offers the compression trigger as an inheritable field carrying its unit', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Model')

    fireEvent.click(await screen.findByRole('switch', { name: 'Customize context management' }))
    const compress = await screen.findByRole('switch', { name: 'Compress the context when it fills up' })
    if (compress.getAttribute('aria-checked') !== 'true') fireEvent.click(compress)

    const threshold = await screen.findByRole('spinbutton', { name: 'Compression trigger threshold' })
    expect(threshold).toHaveValue('')
    expect(threshold).toHaveAttribute('aria-valuemin', '20')
    expect(threshold).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByText('%')).toBeVisible()
  })

  it('keeps the message limit outside the override, since scope is not an overflow policy', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Model')

    // …while the scope control is reachable with the override off.
    const overrideSwitch = await screen.findByRole('switch', { name: 'Customize context management' })
    expect(overrideSwitch).not.toBeChecked()
    expect(screen.getByLabelText('Recent messages kept')).toBeInTheDocument()
  })

  it('expresses "no message limit" as an empty named field rather than a second switch', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Model')

    const input = await screen.findByLabelText('Recent messages kept')
    // No stored override → unlimited, shown as an empty field with a placeholder.
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'Unlimited')
    // The limit is one control, not a switch plus a number.
    expect(screen.queryByRole('switch', { name: 'Recent messages kept' })).not.toBeInTheDocument()

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('5')
  })

  it('repairs invalid legacy max tokens when enabling the limit', async () => {
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: { ...ASSISTANT.settings, maxTokens: 0, enableMaxTokens: false }
        }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('Model')
    fireEvent.click(await screen.findByRole('switch', { name: 'Max tokens' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: {
          settings: {
            maxTokens: 4096,
            enableMaxTokens: true
          }
        }
      })
    )
  })

  it('normalizes unsafe max tokens before auto-save persistence', async () => {
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: { ...ASSISTANT.settings, enableMaxTokens: true }
        }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('Model')
    const maxTokensInput = await screen.findByRole('spinbutton', { name: 'Max tokens' })

    fireEvent.focus(maxTokensInput)
    fireEvent.change(maxTokensInput, { target: { value: String(Number.MAX_SAFE_INTEGER + 1) } })
    fireEvent.blur(maxTokensInput)

    expect(maxTokensInput).toHaveValue(String(Number.MAX_SAFE_INTEGER))
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: { settings: { maxTokens: Number.MAX_SAFE_INTEGER } }
      })
    )
  })

  it('shows the default tool-call cap and clamps custom rounds at 1000', async () => {
    render(
      <AssistantEditDialog
        open
        resource={{
          ...ASSISTANT,
          settings: {
            ...ASSISTANT.settings,
            enableMaxToolCalls: false
          }
        }}
        onOpenChange={vi.fn()}
      />
    )

    selectTab('Model')
    const maxToolCallsSwitch = await screen.findByRole('switch', { name: 'Max tool call rounds' })

    expect(maxToolCallsSwitch).not.toBeChecked()
    expect(screen.getByText('Default (100 rounds)')).toBeVisible()

    fireEvent.click(maxToolCallsSwitch)
    const maxToolCallsInput = await screen.findByDisplayValue('20')

    fireEvent.focus(maxToolCallsInput)
    fireEvent.change(maxToolCallsInput, { target: { value: '0' } })
    fireEvent.blur(maxToolCallsInput)
    expect(maxToolCallsInput).toHaveValue('1')

    fireEvent.focus(maxToolCallsInput)
    fireEvent.change(maxToolCallsInput, { target: { value: '1001' } })
    fireEvent.blur(maxToolCallsInput)

    expect(maxToolCallsInput).toHaveValue('1000')
    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          settings: expect.objectContaining({
            enableMaxToolCalls: true,
            maxToolCalls: 1000
          })
        })
      })
    )
  })

  it('polishes and restores assistant prompts through the shared action', async () => {
    fetchGenerateMock.mockResolvedValueOnce('Polished assistant prompt')
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('System Prompt')
    await expectVariablesHelpOnOpen()
    const polishButton = screen.getByRole('button', { name: 'Polish prompt' })
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('0')
    fireEvent.click(polishButton)

    await waitFor(() => expect(screen.getByLabelText('Prompt editor')).toHaveValue('Polished assistant prompt'))
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.stringContaining('Improve the supplied system prompt without changing its intent or authority.'),
      content: 'Original prompt',
      throwOnError: true,
      signal: expect.any(AbortSignal)
    })
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('1')

    const undoButton = screen.getByRole('button', { name: 'Undo' })
    fireEvent.click(undoButton)

    expect(screen.getByLabelText('Prompt editor')).toHaveValue('Original prompt')
    expect(screen.getByTestId('prompt-preview-reset-key')).toHaveTextContent('2')
  })

  it('generates an assistant prompt from its name when the prompt is blank', async () => {
    render(<AssistantEditDialog open resource={{ ...ASSISTANT, prompt: '' }} onOpenChange={vi.fn()} />)

    selectTab('System Prompt')
    const generateButton = screen.getByRole('button', { name: 'Generate prompt' })
    fireEvent.click(generateButton)

    await waitFor(() => expect(screen.getByLabelText('Prompt editor')).toHaveValue('Generated prompt'))
    expect(fetchGenerateMock).toHaveBeenCalledWith({
      prompt: expect.stringContaining('You are a Prompt Generator.'),
      content: 'Alpha Assistant',
      throwOnError: true,
      signal: expect.any(AbortSignal)
    })
    expect(fetchGenerateMock.mock.calls[0][0].prompt).not.toContain(
      'Create a useful system prompt from the supplied name or title.'
    )
    expect(screen.getByRole('button', { name: 'Polish prompt' })).toBeInTheDocument()
  })

  it('allows closing and tab navigation while an assistant prompt action is in flight', async () => {
    fetchGenerateMock.mockReturnValueOnce(new Promise<string>(() => undefined))
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    selectTab('System Prompt')
    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    selectTab('Basic')

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(screen.getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true')
  })

  it('submits agent permission defaults and advanced changes', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'Permission' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('combobox', { name: 'Permission mode' }))
    // Name matches loosely: each option renders its title and its description.
    fireEvent.click(await screen.findByRole('option', { name: /Plan Only/ }))

    selectTab('Advanced')
    expectHelpTrigger('Environment variables', 'One KEY=VALUE per line')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'FOO=bar' } })

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalled())
    const body = vi.mocked(updateAgentMock).mock.calls[0][0].body
    expect(body).not.toHaveProperty('allowedTools')
    expect(body.configuration).toEqual(
      expect.objectContaining({
        env_vars: { FOO: 'bar' },
        permission_mode: 'plan'
      })
    )
  })

  it('shows agent tool categories directly in the left tab list', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Built-in tools' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('No built-in tools enabled')).not.toBeInTheDocument()

    selectTab('Built-in tools')
    expect(screen.getByRole('tab', { name: 'Built-in tools' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Read')).toBeInTheDocument()

    selectTab('MCP')
    expect(screen.getByText('MCP One')).toBeInTheDocument()

    selectTab('技能')
    expect(screen.getByText('Skill One')).toBeInTheDocument()
  })

  it('projects pi capabilities without exposing Claude-only fields', async () => {
    render(<AgentEditDialog open resource={PI_AGENT} onOpenChange={vi.fn()} />)

    expect(screen.queryByText('Plan model')).not.toBeInTheDocument()
    expect(screen.queryByText('Small model')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Knowledge' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '技能' })).toBeInTheDocument()

    selectTab('Built-in tools')
    expect(screen.getByRole('switch', { name: 'Read files' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Run shell commands' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({ body: expect.objectContaining({ disabledTools: ['bash'] }) })
    )
  })

  it('keeps old MCP restrictions until the user explicitly removes them, preserving file restrictions', async () => {
    const user = userEvent.setup()
    render(
      <AgentEditDialog
        open
        resource={{ ...PI_AGENT, disabledTools: ['read', 'legacy-dsh:mcp__unknown__tool'] }}
        onOpenChange={vi.fn()}
      />
    )
    await user.click(screen.getByRole('tab', { name: 'MCP' }))
    expect(screen.getByText('mcp__unknown__tool')).toBeVisible()
    expect(updateAgentMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'library.config.tools.legacy_restrictions.remove' }))
    await waitFor(() => expect(screen.queryByText('mcp__unknown__tool')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({ body: expect.objectContaining({ disabledTools: ['read'] }) })
    )
  })

  it('lets users enable Code Mode when its legacy tool was disabled', async () => {
    const user = userEvent.setup()
    render(<AgentEditDialog open resource={{ ...PI_AGENT, disabledTools: ['tool_exec'] }} onOpenChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Built-in tools' }))
    const toggle = screen.getByRole('switch', { name: 'Code Mode' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(updateAgentMock).not.toHaveBeenCalled()
    await user.click(toggle)
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({ body: expect.objectContaining({ disabledTools: [] }) })
    )
  })

  it('removes deleted knowledge bases from an open agent form', async () => {
    const boundAgent = { ...AGENT, knowledgeBaseIds: ['kb-1'] }
    const { rerender } = render(<AgentEditDialog open resource={boundAgent} onOpenChange={vi.fn()} />)

    selectTab('Built-in tools')
    expect(screen.getByText('Knowledge Search')).toBeInTheDocument()

    knowledgeBasesState.current = []
    rerender(<AgentEditDialog open resource={{ ...boundAgent, knowledgeBaseIds: [] }} onOpenChange={vi.fn()} />)

    await waitFor(() => expect(screen.queryByText('Knowledge Search')).not.toBeInTheDocument())
    expect(updateAgentMock).not.toHaveBeenCalled()
  })

  it('preserves a knowledge-base re-selection made while its removal is saving', async () => {
    let resolveFirstSave: (() => void) | undefined
    updateAgentMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = () => resolve({ ...AGENT, knowledgeBaseIds: [] })
        })
    )
    const boundAgent = { ...AGENT, knowledgeBaseIds: ['kb-1'] }
    const props = { open: true, onOpenChange: vi.fn(), initialTab: 'tools.knowledge' }
    const { rerender } = render(<AgentEditDialog {...props} resource={boundAgent} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove knowledge base' }))
    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Add knowledge base' }))
    fireEvent.click(screen.getByText('Knowledge One'))
    rerender(<AgentEditDialog {...props} resource={{ ...boundAgent, knowledgeBaseIds: [] }} />)

    selectTab('Built-in tools')
    expect(screen.getByText('Knowledge Search')).toBeInTheDocument()

    resolveFirstSave?.()
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenLastCalledWith({
        body: expect.objectContaining({ knowledgeBaseIds: ['kb-1'] })
      })
    )
  })

  it('opens the agent edit dialog directly on the requested initial tab', () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="tools.skills" />)

    expect(screen.getByRole('tab', { name: '技能' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Skill One')).toBeInTheDocument()
  })

  it('opens Skill settings in an app tab without closing the agent edit dialog', () => {
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    selectTab('技能')

    const manageSkillsButton = screen.getByRole('button', { name: 'Manage Skills' })

    fireEvent.click(manageSkillsButton)

    expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/skills')
    expect(ipcRequestMock).not.toHaveBeenCalledWith('tab.detach', expect.anything())
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('reuses the shared skill catalog in the agent edit dialog', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="tools.skills" />)

    await waitFor(() =>
      expect(skillCatalogPickerMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mode: 'edit',
          skills: installedSkillsState.current.skills,
          loading: false,
          selectedIds: [],
          disabled: false
        })
      )
    )
    expect(screen.getByTestId('skill-catalog-picker')).toHaveAttribute('data-mode', 'edit')
  })

  it('waits for background skill refresh before initializing the editable baseline', async () => {
    installedSkillsState.current = {
      ...installedSkillsState.current,
      refreshing: true
    }
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} initialTab="tools.skills" />
    )

    expect(screen.getByText('Skill One')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Skill One' })).toBeDisabled()

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: installedSkillsState.current.skills.map((skill) => ({ ...skill, isEnabled: true })),
      refreshing: false
    }
    rerender(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} initialTab="tools.skills" />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Skill One' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Skill One' })).toBeEnabled()
    })
    expect(updateAgentMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('switch', { name: 'Skill One' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          skillUpdates: [{ skillId: 'skill-1', isEnabled: false }]
        })
      })
    )
  })

  it('restores a globally re-enabled persisted skill without overwriting local or hidden selections', async () => {
    const hiddenSkill = {
      id: 'skill-hidden',
      name: 'Hidden Skill',
      description: 'Hidden while globally disabled',
      isEnabled: true
    }
    const localSkill = {
      id: 'skill-local',
      name: 'Local Edit Skill',
      description: 'Changed in this dialog',
      isEnabled: false
    }
    const reenabledSkill = {
      id: 'skill-reenabled',
      name: 'Re-enabled Skill',
      description: 'Disabled when the dialog opened',
      isEnabled: true
    }
    installedSkillsState.current = {
      skills: [hiddenSkill, localSkill],
      loading: false,
      refreshing: false
    }
    const props = { open: true, resource: AGENT, onOpenChange: vi.fn(), initialTab: 'tools.skills' as const }
    const { rerender } = render(<AgentEditDialog {...props} />)

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Hidden Skill' })).toBeChecked())

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: [localSkill]
    }
    rerender(<AgentEditDialog {...props} />)
    expect(screen.queryByRole('switch', { name: 'Hidden Skill' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Local Edit Skill' }))

    installedSkillsState.current = {
      ...installedSkillsState.current,
      skills: [hiddenSkill, localSkill, reenabledSkill]
    }
    rerender(<AgentEditDialog {...props} />)

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Hidden Skill' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Local Edit Skill' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Re-enabled Skill' })).toBeChecked()
    })
    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenNthCalledWith(1, {
        body: { skillUpdates: [{ skillId: 'skill-local', isEnabled: true }] }
      })
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Re-enabled Skill' }))

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenNthCalledWith(2, {
        body: { skillUpdates: [{ skillId: 'skill-reenabled', isEnabled: false }] }
      })
    )
  })

  it('opens the assistant edit dialog directly on the requested initial tab', () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} initialTab="tools.mcp" />)

    expect(screen.getByRole('tab', { name: 'MCP' })).toHaveAttribute('aria-selected', 'true')
  })

  it('auto-saves agent skill toggles after a debounce', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('技能')

    fireEvent.click(screen.getByRole('switch', { name: 'Skill One' }))
    // Not persisted synchronously — the debounce is still pending.
    expect(updateAgentMock).not.toHaveBeenCalled()

    await waitFor(() =>
      expect(updateAgentMock).toHaveBeenCalledWith({
        body: expect.objectContaining({
          skillUpdates: [{ skillId: 'skill-1', isEnabled: true }]
        })
      })
    )
  })

  it('uses the same MCP server list presentation in assistant and agent editing', async () => {
    const onAssistantOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onAssistantOpenChange} />)

    selectTab('MCP')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'MCP Mode' })).getByRole('radio', { name: 'Manual' }))

    expect(screen.getByText('MCP services')).toBeInTheDocument()
    expect(screen.getByText('MCP One')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MCP services Settings' }))
    expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/mcp/servers')
    expect(onAssistantOpenChange).not.toHaveBeenCalled()

    cleanup()
    openSettingsTabMock.mockClear()
    const onAgentOpenChange = vi.fn()

    render(<AgentEditDialog open resource={AGENT} onOpenChange={onAgentOpenChange} />)

    selectTab('MCP')

    expect(screen.getByText('MCP services')).toBeInTheDocument()
    expect(screen.getByText('MCP One')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MCP services Settings' }))
    expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/mcp/servers')
    expect(onAgentOpenChange).not.toHaveBeenCalled()
  })

  it('closes the assistant edit dialog before running model settings navigation on the next frame', async () => {
    function Host() {
      const [open, setOpen] = useState(true)
      const [target, setTarget] = useState<Assistant | null>(ASSISTANT)

      const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen)
        if (!nextOpen) setTarget(null)
      }

      return <AssistantEditDialog open={open} resource={target} onOpenChange={handleOpenChange} />
    }

    render(<Host />)
    const frames = mockDeferredAnimationFrames()

    fireEvent.click(screen.getByRole('button', { name: 'Open model settings' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(settingsNavigateMock).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })
    expect(frames.pendingCount()).toBeGreaterThan(0)
    frames.flushAllFrames()

    expect(settingsNavigateMock).toHaveBeenCalledTimes(1)
    frames.restore()
  })

  it('closes the agent edit dialog before running model settings navigation on the next frame', async () => {
    function Host() {
      const [open, setOpen] = useState(true)
      const [target, setTarget] = useState<AgentDetail | null>(AGENT)

      const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen)
        if (!nextOpen) setTarget(null)
      }

      return <AgentEditDialog open={open} resource={target} onOpenChange={handleOpenChange} />
    }

    render(<Host />)
    const frames = mockDeferredAnimationFrames()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open model settings' })[0])

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(settingsNavigateMock).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })
    expect(frames.pendingCount()).toBeGreaterThan(0)
    frames.flushAllFrames()

    expect(settingsNavigateMock).toHaveBeenCalledTimes(1)
    frames.restore()
  })

  it('keeps popover content inside the dialog container', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(screen.getByLabelText('Pick avatar'))

    expect(dialog).toContainElement(screen.getByRole('button', { name: 'Choose emoji' }))
  })

  it('keeps edited values while switching tabs before save', async () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Avatar and name'), { target: { value: 'Draft Agent' } })
    selectTab('System Prompt')
    selectTab('Basic')

    expect(screen.getByLabelText('Avatar and name')).toHaveValue('Draft Agent')
  })

  it('shows the immutable runtime guidance without requiring hover or focus', () => {
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    expect(screen.getByText('Cannot be changed after creation')).toBeVisible()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
