import './editDialogFixture'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentDetail } from '@renderer/types/resourceCatalog'
import type { Assistant } from '@shared/data/types/assistant'

import { PromptBindingTab } from '../../components/PromptBindingTab'
import { AgentEditDialog } from '../AgentEditDialog'
import { AssistantEditDialog } from '../AssistantEditDialog'
import {
  bindPromptMock,
  createPromptMock,
  openSettingsTabMock,
  promptCatalogState,
  updateAgentMock,
  updateAssistantMock,
  unbindPromptMock,
  useQueryMock,
  ASSISTANT,
  AGENT,
  selectTab,
  mockDeferredAnimationFrames,
  createDeferred
} from './editDialogFixture'

describe('edit dialogs', () => {
  it.each(['agent', 'assistant'] as const)(
    'opens global prompt settings from an empty %s prompt panel',
    async (type) => {
      const user = userEvent.setup()
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} initialTab="prompts" />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} initialTab="prompts" />
        )
      }
      render(<Host />)
      const panel = screen.getByRole('tabpanel', { name: 'Prompts' })
      expect(within(panel).getByText(type === 'agent' ? 'Current Agent' : 'Current Assistant')).toBeVisible()
      expect(within(panel).getByText('No prompts linked')).toBeVisible()
      expect(
        within(panel).getByText('Global prompts are available in every conversation and managed in Settings.')
      ).toBeVisible()
      await user.click(within(panel).getByRole('button', { name: 'Manage Global Prompts' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/prompts'))
    }
  )

  it.each(['agent', 'assistant'] as const)(
    'waits for a pending %s save before navigating to global prompts',
    async (type) => {
      const user = userEvent.setup()
      const save = createDeferred<AgentDetail | Assistant>()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      update.mockImplementationOnce(() => save.promise)
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      await user.type(screen.getByLabelText(type === 'agent' ? 'Avatar and name' : 'Name'), ' edited')
      await user.click(screen.getByRole('tab', { name: 'Prompts' }))
      const frames = mockDeferredAnimationFrames()
      try {
        await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
        await waitFor(() => expect(update).toHaveBeenCalled())
        frames.flushAllFrames()
        expect(openSettingsTabMock).not.toHaveBeenCalled()
        expect(screen.getByRole('dialog')).toBeVisible()

        await act(async () => save.resolve(type === 'agent' ? AGENT : ASSISTANT))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        frames.flushAllFrames()
        expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/prompts')
      } finally {
        frames.restore()
      }
    }
  )

  it.each([
    ['agent', 'management', 'success'],
    ['assistant', 'management', 'success'],
    ['agent', 'autosave', 'success'],
    ['assistant', 'autosave', 'success'],
    ['agent', 'management', 'failure'],
    ['assistant', 'management', 'failure']
  ] as const)(
    'guards reverted %s edits while %s is pending and the reversion ends in %s',
    async (type, source, outcome) => {
      const user = userEvent.setup()
      const firstSave = createDeferred<AgentDetail | Assistant>()
      const revertSave = createDeferred<AgentDetail | Assistant>()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      const resource = type === 'agent' ? AGENT : ASSISTANT
      update.mockImplementationOnce(() => firstSave.promise).mockImplementationOnce(() => revertSave.promise)
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      await user.clear(screen.getByLabelText('Description'))
      await user.type(screen.getByLabelText('Description'), 'Temporary description')
      await user.click(screen.getByRole('tab', { name: 'Prompts' }))
      if (source === 'management') await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
      await waitFor(() => expect(update).toHaveBeenCalled())
      await user.click(screen.getByRole('tab', { name: 'Basic' }))
      await user.clear(screen.getByLabelText('Description'))
      if (resource.description) await user.type(screen.getByLabelText('Description'), resource.description)
      await user.click(screen.getByRole('tab', { name: 'Prompts' }))
      const frames = mockDeferredAnimationFrames()
      try {
        await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
        frames.flushAllFrames()
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(openSettingsTabMock).not.toHaveBeenCalled()

        await act(async () => firstSave.resolve({ ...resource, description: 'Temporary description' }))
        await waitFor(() =>
          expect(update).toHaveBeenLastCalledWith({
            body: expect.objectContaining({ description: resource.description })
          })
        )
        frames.flushAllFrames()
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(openSettingsTabMock).not.toHaveBeenCalled()

        if (outcome === 'failure') {
          await act(async () => revertSave.reject(new Error('Reversion failed')))
          frames.flushAllFrames()
          expect(screen.getByRole('dialog')).toBeVisible()
          expect(screen.getByText('Save failed')).toBeVisible()
          expect(openSettingsTabMock).not.toHaveBeenCalled()
          await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
          frames.flushAllFrames()
          expect(screen.getByRole('dialog')).toBeVisible()
          expect(openSettingsTabMock).not.toHaveBeenCalled()
          await user.click(screen.getByRole('tab', { name: 'Basic' }))
          expect(screen.getByLabelText('Description')).toHaveValue(resource.description)
          await user.clear(screen.getByLabelText('Description'))
          await user.type(screen.getByLabelText('Description'), 'Recovered description')
          await user.click(screen.getByRole('tab', { name: 'Prompts' }))
          await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
          expect(update).toHaveBeenLastCalledWith({
            body: expect.objectContaining({ description: 'Recovered description' })
          })
        } else {
          await act(async () => revertSave.resolve(resource))
        }
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        frames.flushAllFrames()
        expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/prompts')
      } finally {
        frames.restore()
      }
    }
  )

  it('persists reverted assistant custom parameters before leaving a pending save', async () => {
    const user = userEvent.setup()
    const firstSave = createDeferred<Assistant>()
    const revertSave = createDeferred<Assistant>()
    const resource = {
      ...ASSISTANT,
      settings: { ...ASSISTANT.settings, customParameters: [{ name: 'stop', type: 'string' as const, value: 'END' }] }
    }
    updateAssistantMock.mockImplementationOnce(() => firstSave.promise).mockImplementationOnce(() => revertSave.promise)
    function Host() {
      const [open, setOpen] = useState(true)
      return <AssistantEditDialog open={open} resource={resource} onOpenChange={setOpen} />
    }
    render(<Host />)
    await user.click(screen.getByRole('tab', { name: 'Model' }))
    await user.clear(screen.getByRole('textbox', { name: 'Parameter value: stop' }))
    await user.type(screen.getByRole('textbox', { name: 'Parameter value: stop' }), 'TEMP')
    await user.click(screen.getByRole('tab', { name: 'Prompts' }))
    await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalled())
    await user.click(screen.getByRole('tab', { name: 'Model' }))
    await user.clear(screen.getByRole('textbox', { name: 'Parameter value: stop' }))
    await user.type(screen.getByRole('textbox', { name: 'Parameter value: stop' }), 'END')
    await user.click(screen.getByRole('tab', { name: 'Prompts' }))
    const frames = mockDeferredAnimationFrames()
    try {
      await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
      frames.flushAllFrames()
      expect(screen.getByRole('dialog')).toBeVisible()
      expect(openSettingsTabMock).not.toHaveBeenCalled()
      await act(async () => firstSave.resolve(resource))
      await waitFor(() =>
        expect(updateAssistantMock).toHaveBeenLastCalledWith({
          body: { settings: { customParameters: resource.settings.customParameters } }
        })
      )
      frames.flushAllFrames()
      expect(screen.getByRole('dialog')).toBeVisible()
      expect(openSettingsTabMock).not.toHaveBeenCalled()
      await act(async () => revertSave.resolve(resource))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      frames.flushAllFrames()
      expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/prompts')
    } finally {
      frames.restore()
    }
  })

  it.each([
    ['agent', ''],
    ['assistant', ''],
    ['agent', 'New name'],
    ['assistant', 'New name']
  ] as const)(
    'preserves newer %s edits with name "%s" made while management navigation awaits a save',
    async (type, nextName) => {
      const user = userEvent.setup()
      const save = createDeferred<AgentDetail | Assistant>()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      update.mockImplementationOnce(() => save.promise)
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      await user.clear(screen.getByLabelText('Description'))
      await user.type(screen.getByLabelText('Description'), 'First description')
      await user.click(screen.getByRole('tab', { name: 'Prompts' }))
      const frames = mockDeferredAnimationFrames()
      try {
        await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
        await waitFor(() => expect(update).toHaveBeenCalled())
        await user.click(screen.getByRole('tab', { name: 'Basic' }))
        const nameInput = screen.getByLabelText(type === 'agent' ? 'Avatar and name' : 'Name')
        await user.clear(nameInput)
        if (nextName) await user.type(nameInput, nextName)
        await user.clear(screen.getByLabelText('Description'))
        await user.type(screen.getByLabelText('Description'), 'Newer description')

        await act(async () => save.resolve(type === 'agent' ? AGENT : ASSISTANT))
        frames.flushAllFrames()
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(nameInput).toHaveValue(nextName)
        expect(screen.getByLabelText('Description')).toHaveValue('Newer description')
        expect(openSettingsTabMock).not.toHaveBeenCalled()

        if (!nextName) await user.type(nameInput, 'Corrected name')
        await user.click(screen.getByRole('tab', { name: 'Prompts' }))
        await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        frames.flushAllFrames()
        expect(update).toHaveBeenLastCalledWith({
          body: expect.objectContaining({ name: nextName || 'Corrected name', description: 'Newer description' })
        })
        expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/prompts')
      } finally {
        frames.restore()
      }
    }
  )

  it.each(['agent', 'assistant'] as const)(
    'preserves failed %s edits across repeated management clicks until a corrected edit saves',
    async (type) => {
      const user = userEvent.setup()
      const save = createDeferred<AgentDetail | Assistant>()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      update.mockImplementationOnce(() => save.promise)
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      await user.type(screen.getByLabelText(type === 'agent' ? 'Avatar and name' : 'Name'), ' edited')
      await user.click(screen.getByRole('tab', { name: 'Prompts' }))
      const frames = mockDeferredAnimationFrames()
      try {
        await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
        await waitFor(() => expect(update).toHaveBeenCalled())
        await act(async () => save.reject(new Error('Network down')))
        expect(await screen.findByText('Save failed')).toBeVisible()
        frames.flushAllFrames()
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(openSettingsTabMock).not.toHaveBeenCalled()

        for (let attempt = 0; attempt < 2; attempt++) {
          await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
          frames.flushAllFrames()
          expect(screen.getByRole('dialog')).toBeVisible()
          expect(screen.getByText('Save failed')).toBeVisible()
          expect(openSettingsTabMock).not.toHaveBeenCalled()
        }

        await user.click(screen.getByRole('tab', { name: 'Basic' }))
        const nameInput = screen.getByLabelText(type === 'agent' ? 'Avatar and name' : 'Name')
        expect(nameInput).toHaveValue(`${type === 'agent' ? AGENT.name : ASSISTANT.name} edited`)
        await user.clear(nameInput)
        await user.type(nameInput, 'Corrected edit')
        await user.click(screen.getByRole('tab', { name: 'Prompts' }))
        await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        frames.flushAllFrames()
        expect(update).toHaveBeenLastCalledWith({ body: expect.objectContaining({ name: 'Corrected edit' }) })
        expect(openSettingsTabMock).toHaveBeenCalledWith('/settings/prompts')
      } finally {
        frames.restore()
      }
    }
  )

  it.each(['agent', 'assistant'] as const)(
    'preserves failed %s edits when the required name is cleared before management navigation',
    async (type) => {
      const user = userEvent.setup()
      const update = type === 'agent' ? updateAgentMock : updateAssistantMock
      update.mockRejectedValueOnce(new Error('Network down'))
      function Host() {
        const [open, setOpen] = useState(true)
        return type === 'agent' ? (
          <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
        ) : (
          <AssistantEditDialog open={open} resource={ASSISTANT} onOpenChange={setOpen} />
        )
      }
      render(<Host />)
      const descriptionInput = screen.getByLabelText('Description')
      await user.clear(descriptionInput)
      await user.type(descriptionInput, 'Unsaved description')
      await user.click(screen.getByRole('tab', { name: 'Prompts' }))
      await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
      expect(await screen.findByText('Save failed')).toBeVisible()

      await user.click(screen.getByRole('tab', { name: 'Basic' }))
      await user.clear(screen.getByLabelText(type === 'agent' ? 'Avatar and name' : 'Name'))
      await user.click(screen.getByRole('tab', { name: 'Prompts' }))
      const frames = mockDeferredAnimationFrames()
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          await user.click(screen.getByRole('button', { name: 'Manage Global Prompts' }))
          frames.flushAllFrames()
          expect(screen.getByRole('dialog')).toBeVisible()
          expect(screen.getByText('Save failed')).toBeVisible()
          expect(openSettingsTabMock).not.toHaveBeenCalled()
        }

        await user.click(screen.getByRole('tab', { name: 'Basic' }))
        expect(screen.getByLabelText('Description')).toHaveValue('Unsaved description')
        expect(screen.getByLabelText(type === 'agent' ? 'Avatar and name' : 'Name')).toHaveValue('')
        await user.click(screen.getByRole('button', { name: 'Close' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(openSettingsTabMock).not.toHaveBeenCalled()
      } finally {
        frames.restore()
      }
    }
  )

  it('keeps global prompt management available beside existing linked prompts', () => {
    promptCatalogState.current.bound = [...promptCatalogState.current.all]
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="prompts" />)
    const panel = screen.getByRole('tabpanel', { name: 'Prompts' })
    expect(within(panel).getByText('Reusable prompt')).toBeVisible()
    expect(within(panel).getByRole('button', { name: 'Manage Global Prompts' })).toBeEnabled()
  })

  it('binds a prompt to the assistant being edited', async () => {
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    expect(within(screen.getByRole('tabpanel', { name: 'Prompts' })).getByText('Prompts')).toBeInTheDocument()
    expect(useQueryMock).toHaveBeenCalledWith('/prompts', { enabled: true, query: { visibility: 'restricted' } })
    expect(useQueryMock).toHaveBeenCalledWith('/prompt-bindings/:targetType/:targetId', {
      enabled: true,
      params: { targetType: 'assistant', targetId: ASSISTANT.id }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Bind prompt' }))
    fireEvent.click(await screen.findByText('Reusable prompt'))

    await waitFor(() =>
      expect(bindPromptMock).toHaveBeenCalledWith({
        params: {
          id: '00000000-0000-4000-8000-000000000001',
          targetType: 'assistant',
          targetId: ASSISTANT.id
        }
      })
    )
    expect(unbindPromptMock).not.toHaveBeenCalled()
  })

  it('unbinds a prompt from the agent being edited', async () => {
    const user = userEvent.setup()
    promptCatalogState.current.bound = [...promptCatalogState.current.all]
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    expect(screen.getByText('Reusable prompt')).toBeInTheDocument()
    const removeButton = screen.getByRole('button', { name: 'Remove prompt Reusable prompt' })
    await user.hover(removeButton)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Remove prompt Reusable prompt')
    await user.click(removeButton)

    await waitFor(() =>
      expect(unbindPromptMock).toHaveBeenCalledWith({
        params: {
          id: '00000000-0000-4000-8000-000000000001',
          targetType: 'agent',
          targetId: AGENT.id
        }
      })
    )
    expect(bindPromptMock).not.toHaveBeenCalled()
  })

  it('keeps a new target binding locked when the previous target request settles', async () => {
    const previousBinding = createDeferred<void>()
    const currentBinding = createDeferred<void>()
    bindPromptMock.mockReturnValueOnce(previousBinding.promise).mockReturnValueOnce(currentBinding.promise)
    const { rerender } = render(
      <PromptBindingTab onManageGlobal={vi.fn()} enabled target={{ type: 'assistant', id: 'assistant-old' }} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bind prompt' }))
    fireEvent.click(await screen.findByText('Reusable prompt'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bind prompt' })).toBeDisabled())

    rerender(<PromptBindingTab onManageGlobal={vi.fn()} enabled target={{ type: 'assistant', id: 'assistant-new' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bind prompt' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Bind prompt' }))
    fireEvent.click(await screen.findByText('Reusable prompt'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bind prompt' })).toBeDisabled())

    await act(async () => {
      previousBinding.resolve(undefined)
      await previousBinding.promise
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'Bind prompt' })).toBeDisabled()

    await act(async () => {
      currentBinding.resolve(undefined)
      await currentBinding.promise
    })
  })

  it('creates a selected prompt and binds it to the assistant being edited', async () => {
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    const createDialog = screen.getByRole('dialog', { name: 'Add prompt' })
    await user.type(within(createDialog).getByLabelText('Title'), 'Created prompt')
    await user.type(within(createDialog).getByLabelText('Prompt editor'), 'Created prompt content')
    await user.click(within(createDialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(createPromptMock).toHaveBeenCalledWith({
        body: {
          title: 'Created prompt',
          content: 'Created prompt content',
          visibility: 'restricted',
          bindingTarget: { type: 'assistant', id: ASSISTANT.id }
        }
      })
    )
  })

  it('creates a global prompt without binding it to the assistant being edited', async () => {
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    const createDialog = screen.getByRole('dialog', { name: 'Add prompt' })
    await user.type(within(createDialog).getByLabelText('Title'), 'Global prompt')
    await user.type(within(createDialog).getByLabelText('Prompt editor'), 'Global prompt content')
    await user.click(within(createDialog).getByRole('switch', { name: 'Use globally' }))
    await user.click(within(createDialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(createPromptMock).toHaveBeenCalledWith({
        body: {
          title: 'Global prompt',
          content: 'Global prompt content',
          visibility: 'global'
        }
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add prompt' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Manage Global Prompts' })).toBeEnabled()
  })

  it('disables prompt visibility while a create request is pending', async () => {
    const user = userEvent.setup()
    const pendingCreate = createDeferred<void>()
    createPromptMock.mockReturnValueOnce(pendingCreate.promise)
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    selectTab('Prompts')
    await user.click(screen.getByRole('button', { name: 'Add prompt' }))
    const createDialog = screen.getByRole('dialog', { name: 'Add prompt' })
    await user.type(within(createDialog).getByLabelText('Title'), 'Pending prompt')
    await user.type(within(createDialog).getByLabelText('Prompt editor'), 'Pending prompt content')
    await user.click(within(createDialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(within(createDialog).getByRole('switch', { name: 'Use globally' })).toBeDisabled()
    })

    await act(async () => {
      pendingCreate.resolve(undefined)
      await pendingCreate.promise
    })
  })
})
