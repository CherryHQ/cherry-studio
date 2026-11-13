import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  createDialogProps: undefined as any
}))

const wizardValues = {
  avatar: '🤖',
  name: 'New',
  agentType: 'claude-code' as const,
  permissionMode: 'auto' as const,
  modelId: 'p::m',
  description: 'desc',
  prompt: 'Agent instructions',
  knowledgeBaseIds: ['kb-1'],
  skillIds: ['skill-a', 'skill-b']
}

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/create', () => ({
  ResourceCreateWizard: (props: any) => {
    mocks.createDialogProps = props
    return <div data-testid="create-dialog" data-open={String(props.open)} data-kind={props.kind} />
  }
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAgentMutations: () => ({ createAgent: mocks.createAgent, isCreatingAgent: false })
}))

import { AgentCreateDialog } from '../AgentCreateDialog'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.createDialogProps = undefined
})

describe('AgentCreateDialog', () => {
  it('creates the agent with wizard values and hands the created id to the result page', async () => {
    mocks.createAgent.mockResolvedValue({ id: 'agent-new' })
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()

    render(<AgentCreateDialog open onOpenChange={onOpenChange} onCreated={onCreated} />)

    await expect(mocks.createDialogProps.onSubmit(wizardValues)).resolves.toBe('agent-new')

    await waitFor(() =>
      expect(mocks.createAgent).toHaveBeenCalledWith({
        type: 'claude-code',
        name: 'New',
        model: 'p::m',
        planModel: 'p::m',
        smallModel: 'p::m',
        description: 'desc',
        instructions: 'Agent instructions',
        knowledgeBaseIds: ['kb-1'],
        skillIds: ['skill-a', 'skill-b'],
        configuration: { avatar: '🤖', permission_mode: 'auto' }
      })
    )
    // Creating alone neither closes nor opens the conversation; the result page decides.
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
  })

  it("opens the new agent's conversation from the result page's start action", () => {
    const onCreated = vi.fn()
    render(<AgentCreateDialog open onOpenChange={vi.fn()} onCreated={onCreated} />)

    mocks.createDialogProps.onStartConversation('agent-new')

    expect(onCreated).toHaveBeenCalledExactlyOnceWith('agent-new')
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
