import './editDialogFixture'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'

import { AgentEditDialog } from '../AgentEditDialog'
import { AssistantEditDialog } from '../AssistantEditDialog'
import { ipcRequestMock, updateAgentMock, updateAssistantMock, ASSISTANT, AGENT } from './editDialogFixture'

describe('edit dialogs', () => {
  it('shows an auto-save error and still allows the dialog to close', async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Broken Assistant')
    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Save failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open after a successful auto-save', async () => {
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saved Assistant' } })
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
  })

  it('flushes a pending change and closes when the dialog is closed', async () => {
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() =>
      expect(updateAssistantMock).toHaveBeenCalledWith({
        body: expect.objectContaining({ name: 'Updated Assistant' })
      })
    )
    // The close now awaits the flush and only closes once it settles.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('persists the latest edit made while an earlier save is still in flight', async () => {
    let resolveFirstSave: (() => void) | undefined
    updateAssistantMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstSave = () => resolve({ ...ASSISTANT, name: 'First Edit' })
        })
    )
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={vi.fn()} />)

    const nameInput = screen.getByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'First Edit' } })
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalledTimes(1))
    expect(updateAssistantMock).toHaveBeenNthCalledWith(1, {
      body: expect.objectContaining({ name: 'First Edit' })
    })

    // Keep editing while the first PATCH is still in flight.
    fireEvent.change(nameInput, { target: { value: 'Second Edit' } })
    // Let the debounce fire; the in-flight guard must queue — not drop — this edit.
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(updateAssistantMock).toHaveBeenCalledTimes(1)

    resolveFirstSave?.()
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalledTimes(2))
    expect(updateAssistantMock).toHaveBeenNthCalledWith(2, {
      body: expect.objectContaining({ name: 'Second Edit' })
    })
  })

  it('allows discarding an unchanged failed assistant save without retrying it', async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Closing Edit')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Save failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAssistantMock.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(updateAssistantMock).toHaveBeenCalledTimes(saveAttemptsAfterFailure)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('retries saving when the form changes after a failed close', async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'First Closing Edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await screen.findByText('Save failed', undefined, { timeout: 5000 })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAssistantMock.mock.calls.length

    fireEvent.change(nameInput, { target: { value: 'Retry Closing Edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(updateAssistantMock.mock.calls.length).toBeGreaterThan(saveAttemptsAfterFailure))
    expect(updateAssistantMock).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ name: 'Retry Closing Edit' })
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('clears the failed assistant save snapshot when reopened within the exit-animation window', async () => {
    // The host (useResourceCatalogController) keeps this dialog instance mounted for
    // DIALOG_EXIT_ANIMATION_MS after `open` goes false, so a reopen within that window
    // reuses the SAME component instance instead of remounting — simulate that with
    // `rerender` rather than a fresh `render`.
    updateAssistantMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    const { rerender } = render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Repro Edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await screen.findByText('Save failed', undefined, { timeout: 5000 })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    // Simulate an external close, then reopen on the same instance before it unmounts.
    rerender(<AssistantEditDialog open={false} resource={ASSISTANT} onOpenChange={onOpenChange} />)
    rerender(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)
    const saveAttemptsBeforeRetry = updateAssistantMock.mock.calls.length

    // Make the exact same edit again. The new editing session must not mistake it
    // for the prior session's failed snapshot and block the save.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Repro Edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(updateAssistantMock.mock.calls.length).toBeGreaterThan(saveAttemptsBeforeRetry)
    expect(updateAssistantMock).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ name: 'Repro Edit' })
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('reuses the in-flight save when closing mid-save instead of racing a second one', async () => {
    let resolveSave: (() => void) | undefined
    updateAssistantMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = () => resolve({ ...ASSISTANT, name: 'Mid Save' })
        })
    )
    const onOpenChange = vi.fn()
    render(<AssistantEditDialog open resource={ASSISTANT} onOpenChange={onOpenChange} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mid Save' } })
    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalledTimes(1))

    // Close while that save is still in flight: no second concurrent save, and the
    // dialog must not close until the in-flight save settles.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(updateAssistantMock).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    resolveSave?.()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(updateAssistantMock).toHaveBeenCalledTimes(1)
  })

  it('allows discarding an unchanged failed agent save without retrying it', async () => {
    updateAgentMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Avatar and name')
    fireEvent.change(nameInput, { target: { value: 'Closing Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(await screen.findByText('Save failed')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Save failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAgentMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(updateAgentMock).toHaveBeenCalledTimes(saveAttemptsAfterFailure)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('retries saving the agent when the form changes after a failed close', async () => {
    updateAgentMock.mockRejectedValueOnce(new Error('Network down'))
    const onOpenChange = vi.fn()
    render(<AgentEditDialog open resource={AGENT} onOpenChange={onOpenChange} />)

    const nameInput = screen.getByLabelText('Avatar and name')
    fireEvent.change(nameInput, { target: { value: 'Closing Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await screen.findByText('Save failed', undefined, { timeout: 5000 })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    const saveAttemptsAfterFailure = updateAgentMock.mock.calls.length

    fireEvent.change(nameInput, { target: { value: 'Retry Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(updateAgentMock.mock.calls.length).toBeGreaterThan(saveAttemptsAfterFailure))
    expect(updateAgentMock).toHaveBeenLastCalledWith({
      body: expect.objectContaining({ name: 'Retry Agent' })
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe('Agent configuration memory', () => {
  const files = [
    { key: 'soul', name: 'SOUL.md', content: 'Original persona' },
    { key: 'user', name: 'USER.md', content: 'User details' },
    { key: 'fact', name: 'FACT.md', content: 'Durable facts' },
    { key: 'journal', name: 'JOURNAL.jsonl', content: '{"event":"remembered"}' }
  ].map((file) => ({
    ...file,
    path: `/agents/agent-1/${file.name}`,
    exists: true,
    size: 20,
    updatedAt: null,
    version: 'v1',
    truncated: false
  }))

  beforeEach(() => {
    ipcRequestMock.mockImplementation(async (route: string, input: { key?: string; content?: string }) => {
      if (route === 'agent.memory.read') return { directory: '/agents/agent-1', files }
      if (route === 'agent.memory.write')
        return { ...files.find((file) => file.key === input.key), content: input.content, version: 'v2' }
      return undefined
    })
  })

  function Harness() {
    const [open, setOpen] = useState(true)
    return <AgentEditDialog open={open} resource={AGENT} onOpenChange={setOpen} />
  }

  // Catches accidental autosaving of memory drafts through the Agent config form.
  it('opens memory from configuration and saves only the explicitly submitted file revision', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('tab', { name: 'Memory' }))
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const editor = screen.getByRole('textbox', { name: 'Edit SOUL.md' })
    await user.clear(editor)
    await user.type(editor, 'Updated persona')
    expect(ipcRequestMock.mock.calls.filter(([route]) => route === 'agent.memory.write')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit SOUL.md' })).not.toBeInTheDocument())
    expect(ipcRequestMock).toHaveBeenCalledWith('agent.memory.write', {
      agentId: AGENT.id,
      key: 'soul',
      content: 'Updated persona',
      expectedVersion: 'v1'
    })
    expect(updateAgentMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Event log' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByText('{"event":"remembered"}')).toBeVisible()
  })

  it('keeps copy and folder actions available through the memory menu', async () => {
    const user = userEvent.setup()
    const writeClipboard = vi.spyOn(navigator.clipboard, 'writeText')
    render(<AgentEditDialog open resource={AGENT} onOpenChange={vi.fn()} initialTab="memory" />)
    await screen.findByRole('tab', { name: 'Persona' })
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copy content' }))
    expect(writeClipboard).toHaveBeenCalledWith('Original persona')
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open folder' }))
    expect(ipcRequestMock).toHaveBeenCalledWith('agent.memory.open_folder', { agentId: AGENT.id })
    writeClipboard.mockRestore()
  })

  // Catches losing an unsaved memory draft when switching files, changing tabs, or closing configuration.
  it.each(['file', 'tab', 'close'] as const)(
    'protects memory drafts on %s and leaves only after explicit discard',
    async (destination) => {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByRole('tab', { name: 'Memory' }))
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      await user.type(screen.getByRole('textbox', { name: 'Edit SOUL.md' }), ' unsaved')
      const leave = () =>
        destination === 'file'
          ? user.click(screen.getByRole('tab', { name: 'User profile' }))
          : destination === 'tab'
            ? user.click(screen.getByRole('tab', { name: 'Basic' }))
            : user.keyboard('{Escape}')
      await leave()
      const confirmation = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })
      await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('textbox', { name: 'Edit SOUL.md' })).toHaveValue('Original persona unsaved')
      await leave()
      await user.click(
        within(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).getByRole('button', {
          name: 'Discard changes'
        })
      )
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit SOUL.md' })).not.toBeInTheDocument())
      if (destination === 'tab')
        expect(screen.getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true')
      else if (destination === 'file')
        expect(screen.getByRole('tab', { name: 'User profile' })).toHaveAttribute('aria-selected', 'true')
      else expect(screen.queryByRole('dialog', { name: 'Edit Agent' })).not.toBeInTheDocument()
      expect(ipcRequestMock.mock.calls.filter(([route]) => route === 'agent.memory.write')).toEqual([])
    }
  )
})
