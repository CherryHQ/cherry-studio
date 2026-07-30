import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResourceEditDialogHost } from '../ResourceEditDialogHost'

const mocks = vi.hoisted(() => ({
  onOpenChange: vi.fn(),
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
    resource
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    resource: { id: string } | null
  }) =>
    resource ? (
      <div data-testid="assistant-edit-dialog" data-open={open}>
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
    resource
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    resource: { id: string } | null
  }) =>
    resource ? (
      <div data-testid="agent-edit-dialog" data-open={open}>
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
    mocks.onOpenChange.mockReset()
    mocks.useAssistantApiById.mockReset()
    mocks.useAssistantApiById.mockReturnValue({
      assistant: { id: 'assistant-1' },
      error: undefined
    })
    mocks.useAgent.mockReset()
    mocks.useAgent.mockReturnValue({
      agent: { id: 'agent-1' },
      error: undefined
    })
  })

  it('loads an assistant edit target by key', () => {
    render(
      <ResourceEditDialogHost target={{ kind: 'assistant', id: 'assistant-1' }} onOpenChange={mocks.onOpenChange} />
    )

    expect(mocks.useAssistantApiById).toHaveBeenCalledWith('assistant-1')
    expect(screen.getByTestId('assistant-edit-dialog')).toHaveAttribute('data-open', 'true')
  })

  it('loads an agent edit target by key', () => {
    render(<ResourceEditDialogHost target={{ kind: 'agent', id: 'agent-1' }} onOpenChange={mocks.onOpenChange} />)

    expect(mocks.useAgent).toHaveBeenCalledWith('agent-1')
    expect(screen.getByTestId('agent-edit-dialog')).toHaveAttribute('data-open', 'true')
  })

  it('keeps the target mounted until the shared unmount delay expires', async () => {
    vi.useFakeTimers()

    render(<ResourceEditDialogHost target={{ kind: 'agent', id: 'agent-1' }} onOpenChange={mocks.onOpenChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(screen.getByTestId('agent-edit-dialog')).toHaveAttribute('data-open', 'false')
    expect(mocks.onOpenChange).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS - 1))
    expect(mocks.onOpenChange).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTime(1))
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reopens the same logical target and cancels its pending close', async () => {
    vi.useFakeTimers()

    const { rerender } = render(
      <ResourceEditDialogHost target={{ kind: 'agent', id: 'agent-1' }} onOpenChange={mocks.onOpenChange} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.getByTestId('agent-edit-dialog')).toHaveAttribute('data-open', 'false')

    await act(() => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS - 1))
    rerender(<ResourceEditDialogHost target={{ kind: 'agent', id: 'agent-1' }} onOpenChange={mocks.onOpenChange} />)

    expect(screen.getByTestId('agent-edit-dialog')).toHaveAttribute('data-open', 'true')

    await act(() => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS))
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
  })

  it('renders nothing without a target', () => {
    render(<ResourceEditDialogHost target={null} onOpenChange={mocks.onOpenChange} />)

    expect(screen.queryByTestId('assistant-edit-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-edit-dialog')).not.toBeInTheDocument()
  })
})
