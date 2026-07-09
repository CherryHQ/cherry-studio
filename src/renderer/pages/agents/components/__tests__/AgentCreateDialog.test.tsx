import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  createDialogProps: undefined as any
}))

const wizardValues = {
  avatar: '🤖',
  name: 'New',
  modelId: 'p::m',
  description: 'desc',
  prompt: 'Agent instructions',
  knowledgeBaseIds: [],
  skillIds: ['skill-a', 'skill-b']
}

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/create', () => ({
  ResourceCreateWizard: (props: any) => {
    mocks.createDialogProps = props
    return (
      <div data-testid="create-dialog" data-open={String(props.open)} data-kind={props.kind}>
        <button type="button" onClick={() => props.onSubmit(wizardValues)}>
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

import { AgentCreateDialog } from '../AgentCreateDialog'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.createDialogProps = undefined
})

describe('AgentCreateDialog', () => {
  it('creates the agent with wizard values and reports the created id', async () => {
    mocks.createAgent.mockResolvedValue({ id: 'agent-new' })
    const onCreated = vi.fn()

    render(<AgentCreateDialog open onOpenChange={vi.fn()} onCreated={onCreated} />)

    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-kind', 'agent')

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
          instructions: 'Agent instructions',
          skillIds: ['skill-a', 'skill-b'],
          configuration: { avatar: '🤖', permission_mode: 'bypassPermissions', soul_enabled: true }
        }
      })
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('agent-new'))
  })

  it('keeps the dialog open and does not report an agent when creation fails', async () => {
    mocks.createAgent.mockRejectedValue(new Error('create failed'))
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()

    render(<AgentCreateDialog open onOpenChange={onOpenChange} onCreated={onCreated} />)

    await expect(mocks.createDialogProps.onSubmit(wizardValues)).rejects.toThrow('create failed')

    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(onCreated).not.toHaveBeenCalled()
  })
})
