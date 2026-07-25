import { DIALOG_CLOSE_DURATION_MS, DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourceEditDialogHost } from '../ResourceEditDialogHost'

const mocks = vi.hoisted(() => ({
  assistantRefetch: vi.fn(),
  agentRevalidate: vi.fn(),
  onOpenChange: vi.fn(),
  onSaved: vi.fn(),
  useAgent: vi.fn(),
  useAssistantApiById: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistantApiById: mocks.useAssistantApiById
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgent: mocks.useAgent
}))

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({
  useAgentModelFilter: () => vi.fn(() => true)
}))

vi.mock('../AssistantEditDialog', () => ({
  AssistantEditDialog: ({
    open,
    onOpenChange,
    onSaved,
    resource
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved: () => Promise<void>
    resource: { id: string } | null
  }) =>
    resource ? (
      <div data-testid="assistant-edit-dialog" data-open={open}>
        <button type="button" onClick={() => void onSaved()}>
          save
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null
}))

vi.mock('../AgentEditDialog', () => ({
  AgentEditDialog: ({
    open,
    onOpenChange,
    onSaved,
    resource
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSaved: () => Promise<void>
    resource: { id: string } | null
  }) =>
    resource ? (
      <div data-testid="agent-edit-dialog" data-open={open}>
        <button type="button" onClick={() => void onSaved()}>
          save
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null
}))

describe('ResourceEditDialogHost', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    mocks.assistantRefetch.mockReset()
    mocks.assistantRefetch.mockResolvedValue(undefined)
    mocks.agentRevalidate.mockReset()
    mocks.agentRevalidate.mockResolvedValue(undefined)
    mocks.onOpenChange.mockReset()
    mocks.onSaved.mockReset()
    mocks.onSaved.mockResolvedValue(undefined)
    mocks.useAssistantApiById.mockReset()
    mocks.useAssistantApiById.mockReturnValue({
      assistant: { id: 'assistant-1' },
      error: undefined,
      refetch: mocks.assistantRefetch
    })
    mocks.useAgent.mockReset()
    mocks.useAgent.mockReturnValue({
      agent: { id: 'agent-1' },
      error: undefined,
      revalidate: mocks.agentRevalidate
    })
  })

  it('loads and saves an assistant edit target', async () => {
    const user = userEvent.setup()

    render(
      <ResourceEditDialogHost
        target={{ kind: 'assistant', id: 'assistant-1' }}
        onOpenChange={mocks.onOpenChange}
        onSaved={mocks.onSaved}
      />
    )

    expect(mocks.useAssistantApiById).toHaveBeenCalledWith('assistant-1')
    await user.click(screen.getByRole('button', { name: 'save' }))

    expect(mocks.assistantRefetch).toHaveBeenCalledTimes(1)
    expect(mocks.onSaved).toHaveBeenCalledWith({ kind: 'assistant', id: 'assistant-1' })
  })

  it('keeps assistant post-save refresh failures inside the host', async () => {
    const user = userEvent.setup()
    mocks.assistantRefetch.mockRejectedValueOnce(new Error('Refresh failed'))

    render(
      <ResourceEditDialogHost
        target={{ kind: 'assistant', id: 'assistant-1' }}
        onOpenChange={mocks.onOpenChange}
        onSaved={mocks.onSaved}
      />
    )

    await expect(user.click(screen.getByRole('button', { name: 'save' }))).resolves.toBeUndefined()

    expect(mocks.assistantRefetch).toHaveBeenCalledTimes(1)
    expect(mocks.onSaved).not.toHaveBeenCalled()
  })

  it('loads and saves an agent edit target', async () => {
    const user = userEvent.setup()

    render(
      <ResourceEditDialogHost
        target={{ kind: 'agent', id: 'agent-1' }}
        onOpenChange={mocks.onOpenChange}
        onSaved={mocks.onSaved}
      />
    )

    expect(mocks.useAgent).toHaveBeenCalledWith('agent-1')
    await user.click(screen.getByRole('button', { name: 'save' }))

    expect(mocks.agentRevalidate).toHaveBeenCalledTimes(1)
    expect(mocks.onSaved).toHaveBeenCalledWith({ kind: 'agent', id: 'agent-1' })
  })

  it('keeps agent post-save refresh failures inside the host', async () => {
    const user = userEvent.setup()
    mocks.agentRevalidate.mockRejectedValueOnce(new Error('Refresh failed'))

    render(
      <ResourceEditDialogHost
        target={{ kind: 'agent', id: 'agent-1' }}
        onOpenChange={mocks.onOpenChange}
        onSaved={mocks.onSaved}
      />
    )

    await expect(user.click(screen.getByRole('button', { name: 'save' }))).resolves.toBeUndefined()

    expect(mocks.agentRevalidate).toHaveBeenCalledTimes(1)
    expect(mocks.onSaved).not.toHaveBeenCalled()
  })

  it('keeps the target mounted until the shared close animation finishes', async () => {
    vi.useFakeTimers()

    render(<ResourceEditDialogHost target={{ kind: 'agent', id: 'agent-1' }} onOpenChange={mocks.onOpenChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(screen.getByTestId('agent-edit-dialog')).toHaveAttribute('data-open', 'false')
    expect(mocks.onOpenChange).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTime(DIALOG_CLOSE_DURATION_MS))
    expect(mocks.onOpenChange).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS - DIALOG_CLOSE_DURATION_MS))
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders nothing without a target', () => {
    render(<ResourceEditDialogHost target={null} onOpenChange={mocks.onOpenChange} />)

    expect(screen.queryByTestId('assistant-edit-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-edit-dialog')).not.toBeInTheDocument()
  })
})
