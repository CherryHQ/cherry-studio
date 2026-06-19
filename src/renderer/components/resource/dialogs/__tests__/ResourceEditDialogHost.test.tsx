import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@renderer/hooks/agents/useAgent', () => ({
  useAgent: mocks.useAgent
}))

vi.mock('@renderer/hooks/agents/useAgentModelFilter', () => ({
  useAgentModelFilter: () => vi.fn(() => true)
}))

vi.mock('../edit/AssistantEditDialog', () => ({
  AssistantEditDialog: ({
    onOpenChange,
    onSaved,
    resource
  }: {
    onOpenChange: (open: boolean) => void
    onSaved: () => Promise<void>
    resource: { id: string } | null
  }) =>
    resource ? (
      <div data-testid="assistant-edit-dialog">
        <button type="button" onClick={() => void onSaved()}>
          save
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null
}))

vi.mock('../edit/AgentEditDialog', () => ({
  AgentEditDialog: ({
    onOpenChange,
    onSaved,
    resource
  }: {
    onOpenChange: (open: boolean) => void
    onSaved: () => Promise<void>
    resource: { id: string } | null
  }) =>
    resource ? (
      <div data-testid="agent-edit-dialog">
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

  it('renders nothing without a target', () => {
    render(<ResourceEditDialogHost target={null} onOpenChange={mocks.onOpenChange} />)

    expect(screen.queryByTestId('assistant-edit-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-edit-dialog')).not.toBeInTheDocument()
  })
})
