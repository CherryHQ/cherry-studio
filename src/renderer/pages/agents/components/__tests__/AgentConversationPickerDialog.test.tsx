import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  pickerProps: undefined as any,
  createDialogProps: undefined as any
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))

vi.mock('@renderer/components/EmojiIcon', () => ({ default: () => null }))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  ConversationPickerDialog: (props: any) => {
    mocks.pickerProps = props
    return (
      <div data-testid="picker" data-open={String(props.open)}>
        <span data-testid="create-action-icon">{props.createAction?.icon}</span>
        <button type="button" onClick={() => props.createAction?.onSelect()}>
          create-new
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/create', () => ({
  ResourceCreateWizard: (props: any) => {
    mocks.createDialogProps = props
    return (
      <div data-testid="create-dialog" data-open={String(props.open)} data-kind={props.kind}>
        <button
          type="button"
          onClick={() => props.onSubmit({ avatar: '🤖', name: 'New', modelId: 'p::m', description: 'desc' })}>
          submit-create
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: () => ({ trigger: mocks.createAgent, isLoading: false })
}))

vi.mock('@renderer/hooks/agent/useAgentModelFilter', () => ({ useAgentModelFilter: () => () => true }))

vi.mock('@renderer/utils/agent', () => ({ getAgentAvatarFromConfiguration: () => '🤖' }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { AgentConversationPickerDialog } from '../AgentConversationPickerDialog'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.pickerProps = undefined
})

describe('AgentConversationPickerDialog', () => {
  it('exposes a create action that closes the picker and opens the agent create dialog', () => {
    const onOpenChange = vi.fn()

    render(<AgentConversationPickerDialog open onOpenChange={onOpenChange} agents={[]} onSelect={vi.fn()} />)

    expect(mocks.pickerProps.createAction.label).toBe('selector.agent.create_new')
    expect(screen.getByTestId('create-action-icon').querySelector('svg')).toHaveClass('lucide-plus')
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByText('create-new'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-kind', 'agent')
  })

  it('creates the agent and starts a session with it on submit', async () => {
    mocks.createAgent.mockResolvedValue({ id: 'agent-new' })
    const onSelect = vi.fn()

    render(<AgentConversationPickerDialog open onOpenChange={vi.fn()} agents={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('create-new'))
    fireEvent.click(screen.getByText('submit-create'))

    await waitFor(() =>
      expect(mocks.createAgent).toHaveBeenCalledWith({
        body: {
          type: 'claude-code',
          name: 'New',
          model: 'p::m',
          planModel: 'p::m',
          smallModel: 'p::m',
          description: 'desc',
          configuration: { avatar: '🤖', permission_mode: 'bypassPermissions', soul_enabled: true }
        }
      })
    )
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('agent-new'))
  })

  it('maps a selected picker row to its agent id', () => {
    const onSelect = vi.fn()

    render(
      <AgentConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        agents={[{ id: 'agent-x', name: 'Agent X', configuration: {} } as any]}
        onSelect={onSelect}
      />
    )

    const item = mocks.pickerProps.items.find((entry: any) => entry.agentId === 'agent-x')
    expect(item).toBeTruthy()
    mocks.pickerProps.onSelect(item)
    expect(onSelect).toHaveBeenCalledWith('agent-x')
  })

  it('keeps the create dialog open and does not select when agent creation fails', async () => {
    mocks.createAgent.mockRejectedValue(new Error('create failed'))
    const onSelect = vi.fn()

    render(<AgentConversationPickerDialog open onOpenChange={vi.fn()} agents={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('create-new'))
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')

    // Submit re-throws so the wizard can surface the error; call it directly to capture the rejection.
    await expect(
      mocks.createDialogProps.onSubmit({ avatar: '🤖', name: 'New', modelId: 'p::m', description: 'desc' })
    ).rejects.toThrow('create failed')

    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
