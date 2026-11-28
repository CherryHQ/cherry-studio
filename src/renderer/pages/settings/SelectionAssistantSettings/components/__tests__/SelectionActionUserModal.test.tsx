import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { CustomSelectionAction } from '@shared/types/selection'

import SelectionActionUserModal from '../SelectionActionUserModal'

// Persistence is owned by the modal; picker interactions are covered with real UI in its own suite.
vi.mock('../SelectionActionIconPicker', async () => {
  const { useEffect, useRef } = await import('react')
  const useMountedFlag = () => {
    const mounted = useRef(true)
    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])
    return mounted
  }
  return {
    default: function MockSelectionActionIconPicker({
      value,
      onChange,
      onRoll
    }: {
      value: string
      onChange: (icon: string) => void
      onRoll?: (roll: Promise<string | null>) => void
    }) {
      const mounted = useMountedFlag()
      return (
        <div>
          <output data-testid="saved-icon">{value}</output>
          <button
            onClick={() =>
              onRoll?.(
                new Promise<string | null>((resolve) => {
                  ;(globalThis as { __releaseRoll?: () => void }).__releaseRoll = () => {
                    if (mounted.current) onChange('dice-icon')
                    resolve('dice-icon')
                  }
                })
              )
            }>
            start slow roll
          </button>
          <button onClick={() => onChange('heart-pulse')}>pick heart-pulse</button>
          <button onClick={() => onChange('')}>use default icon</button>
        </div>
      )
    }
  }
})

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => null
}))

vi.mock('@renderer/components/CopyButton', () => ({
  default: () => null
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AgentSelector: ({ onChange, trigger }: { onChange: (id: string) => void; trigger: ReactNode }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('agent-2')}>
        select agent 2
      </button>
    </div>
  ),
  WorkspaceSelector: ({ onChange, trigger }: { onChange: (id: string) => void; trigger: ReactNode }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('workspace-1')}>
        select workspace 1
      </button>
    </div>
  )
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: () => ({
    agents: [
      { id: 'agent-2', name: 'Researcher', model: 'openai::gpt-5', modelName: 'GPT-5', configuration: { avatar: '🔬' } }
    ],
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: () => ({
    assistants: [
      { id: 'assistant-1', name: 'Writer' },
      { id: 'assistant-2', name: 'Editor' }
    ]
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: undefined })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const WORKSPACE: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Docs',
  path: '/work/docs',
  type: 'user',
  orderKey: 'a0',
  createdAt: '2026-10-28T00:00:00.000Z',
  updatedAt: '2026-10-28T00:00:00.000Z'
}

describe('SelectionActionUserModal', () => {
  beforeEach(() => {
    MockUseDataApiUtils.mockQueryData('/agent-workspaces', [WORKSPACE])
  })

  it('saves a selected then cleared icon and reopens with the default still unset', async () => {
    const action: CustomSelectionAction = {
      id: 'user-icon',
      name: 'Translate',
      enabled: true,
      isBuiltIn: false,
      runner: 'default'
    }
    const onOk = vi.fn()
    const { rerender } = render(
      <SelectionActionUserModal isModalOpen editingAction={action} onOk={onOk} onCancel={vi.fn()} />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'pick heart-pulse' }))
    expect(screen.getByTestId('saved-icon')).toHaveTextContent('heart-pulse')
    fireEvent.click(screen.getByRole('button', { name: 'use default icon' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(onOk).toHaveBeenCalledWith(expect.objectContaining({ icon: '' }))
    const saved: CustomSelectionAction = onOk.mock.calls[0][0]
    rerender(<SelectionActionUserModal isModalOpen={false} editingAction={saved} onOk={onOk} onCancel={vi.fn()} />)
    rerender(<SelectionActionUserModal isModalOpen editingAction={saved} onOk={onOk} onCancel={vi.fn()} />)
    expect(await screen.findByTestId('saved-icon')).toBeEmptyDOMElement()
  })

  it('waits for a dice roll that is still loading before saving', async () => {
    const onOk = vi.fn()
    render(<SelectionActionUserModal isModalOpen editingAction={null} onOk={onOk} onCancel={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Roll' } })
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'prompt' } })
    fireEvent.click(screen.getByText('start slow roll'))
    fireEvent.click(screen.getByText('common.confirm'))
    expect(onOk).not.toHaveBeenCalled()

    ;(globalThis as { __releaseRoll?: () => void }).__releaseRoll?.()
    await waitFor(() => expect(onOk).toHaveBeenCalledTimes(1))
    expect(onOk.mock.calls[0][0]).toMatchObject({ icon: 'dice-icon' })
  })

  it('does not write after Cancel while a roll is pending, and writes once for repeated Confirm', async () => {
    const onOk = vi.fn()
    const onCancel = vi.fn()
    const { unmount } = render(
      <SelectionActionUserModal isModalOpen editingAction={null} onOk={onOk} onCancel={onCancel} />
    )
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Roll' } })
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'prompt' } })
    fireEvent.click(screen.getByText('start slow roll'))
    fireEvent.click(screen.getByText('common.confirm'))
    fireEvent.click(screen.getByText('common.confirm'))
    fireEvent.click(screen.getByText('common.cancel'))
    ;(globalThis as { __releaseRoll?: () => void }).__releaseRoll?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onCancel).toHaveBeenCalled()
    expect(onOk).not.toHaveBeenCalled()
    unmount()
  })

  it('writes once when Confirm is repeated during a pending roll', async () => {
    const onOk = vi.fn()
    render(<SelectionActionUserModal isModalOpen editingAction={null} onOk={onOk} onCancel={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Roll' } })
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'prompt' } })
    fireEvent.click(screen.getByText('start slow roll'))
    fireEvent.click(screen.getByText('common.confirm'))
    fireEvent.click(screen.getByText('common.confirm'))
    ;(globalThis as { __releaseRoll?: () => void }).__releaseRoll?.()
    await waitFor(() => expect(onOk).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onOk).toHaveBeenCalledTimes(1)
  })

  it('saves a later default choice after a resolved roll', async () => {
    const onOk = vi.fn()
    render(<SelectionActionUserModal isModalOpen editingAction={null} onOk={onOk} onCancel={vi.fn()} />)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Roll' } })
    fireEvent.change(screen.getAllByRole('textbox').at(-1)!, { target: { value: 'prompt' } })
    fireEvent.click(screen.getByText('start slow roll'))
    ;(globalThis as { __releaseRoll?: () => void }).__releaseRoll?.()
    await waitFor(() => expect(screen.getByTestId('saved-icon')).toHaveTextContent('dice-icon'))
    fireEvent.click(screen.getByText('use default icon'))
    fireEvent.click(screen.getByText('common.confirm'))
    await waitFor(() => expect(onOk).toHaveBeenCalledTimes(1))
    expect(onOk.mock.calls[0][0].icon).toBe('')
  })

  it('does not carry a roll from a cancelled editor into the next one', async () => {
    const onOk = vi.fn()
    const actionA = { id: 'a', name: 'A', prompt: 'pa', icon: '', enabled: true, isBuiltIn: false } as never
    const actionB = { id: 'b', name: 'B', prompt: 'pb', icon: 'heart', enabled: true, isBuiltIn: false } as never
    const { rerender } = render(
      <SelectionActionUserModal isModalOpen editingAction={actionA} onOk={onOk} onCancel={vi.fn()} />
    )
    fireEvent.click(screen.getByText('start slow roll'))
    fireEvent.click(screen.getByText('common.confirm'))
    fireEvent.click(screen.getByText('common.cancel'))
    rerender(<SelectionActionUserModal isModalOpen={false} editingAction={actionA} onOk={onOk} onCancel={vi.fn()} />)
    rerender(<SelectionActionUserModal isModalOpen editingAction={actionB} onOk={onOk} onCancel={vi.fn()} />)
    ;(globalThis as { __releaseRoll?: () => void }).__releaseRoll?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    fireEvent.click(screen.getByText('common.confirm'))
    await waitFor(() => expect(onOk).toHaveBeenCalledTimes(1))
    expect(onOk.mock.calls[0][0]).toMatchObject({ id: 'b', icon: 'heart' })
  })

  it('submits the complete long prompt', () => {
    const longPrompt = 'Keep the prompt inside the dialog.\n'.repeat(200)
    const onOk = vi.fn()
    const editingAction: CustomSelectionAction = {
      id: 'user-long-prompt',
      name: 'Long prompt',
      enabled: true,
      isBuiltIn: false,
      runner: 'default',
      prompt: longPrompt
    }

    render(<SelectionActionUserModal isModalOpen editingAction={editingAction} onOk={onOk} onCancel={vi.fn()} />)

    const prompt = screen.getByPlaceholderText('selection.settings.user_modal.prompt.placeholder')

    expect(prompt).toHaveValue(longPrompt)

    const confirmButton = screen.getByRole('button', { name: 'common.confirm' })
    expect(confirmButton).toBeVisible()

    fireEvent.click(confirmButton)

    expect(onOk).toHaveBeenCalledWith(editingAction)
  })

  it('requires an agent before saving an agent-backed action', () => {
    const onOk = vi.fn()
    render(<SelectionActionUserModal isModalOpen editingAction={null} onOk={onOk} onCancel={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('selection.settings.user_modal.name.hint'), {
      target: { value: 'Research' }
    })
    fireEvent.click(screen.getByRole('radio', { name: 'selection.settings.user_modal.model.agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(onOk).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'selection.settings.user_modal.agent.hint' })).toHaveAttribute(
      'aria-invalid',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: 'select agent 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(onOk).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Research', runner: 'agent', agentId: 'agent-2' })
    )
  })

  it('saves the chosen work directory with the agent', () => {
    const onOk = vi.fn()
    const editingAction: CustomSelectionAction = {
      id: 'user-agent',
      name: 'Research',
      enabled: true,
      isBuiltIn: false,
      runner: 'agent',
      agentId: 'agent-2'
    }
    render(<SelectionActionUserModal isModalOpen editingAction={editingAction} onOk={onOk} onCancel={vi.fn()} />)

    expect(screen.getByText('Researcher')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'select workspace 1' }))
    expect(screen.getByText('Docs')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(onOk).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-2', agentWorkspace: { type: 'user', workspaceId: 'workspace-1' } })
    )
  })

  it('restores the previous assistant after switching to another runner and back', () => {
    const onOk = vi.fn()
    const editingAction: CustomSelectionAction = {
      id: 'user-assistant',
      name: 'Polish',
      enabled: true,
      isBuiltIn: false,
      runner: 'assistant',
      assistantId: 'assistant-2'
    }
    render(<SelectionActionUserModal isModalOpen editingAction={editingAction} onOk={onOk} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: 'selection.settings.user_modal.model.default' }))
    fireEvent.click(screen.getByRole('radio', { name: 'selection.settings.user_modal.model.assistant' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(onOk).toHaveBeenCalledWith(expect.objectContaining({ runner: 'assistant', assistantId: 'assistant-2' }))
  })

  it("keeps every runner's choice when the action switches to the default model", () => {
    const onOk = vi.fn()
    const editingAction: CustomSelectionAction = {
      id: 'user-agent',
      name: 'Research',
      enabled: true,
      isBuiltIn: false,
      runner: 'agent',
      assistantId: 'assistant-2',
      agentId: 'agent-2',
      agentWorkspace: { type: 'user', workspaceId: 'workspace-1' }
    }
    render(<SelectionActionUserModal isModalOpen editingAction={editingAction} onOk={onOk} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: 'selection.settings.user_modal.model.default' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(onOk).toHaveBeenCalledWith({ ...editingAction, runner: 'default' })
  })

  it('warns when the bound agent no longer exists', () => {
    const editingAction: CustomSelectionAction = {
      id: 'user-agent',
      name: 'Research',
      enabled: true,
      isBuiltIn: false,
      runner: 'agent',
      agentId: 'deleted-agent'
    }
    render(<SelectionActionUserModal isModalOpen editingAction={editingAction} onOk={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText('selection.settings.agent_issue.agent_unavailable')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'select agent 2' }))

    expect(screen.queryByText('selection.settings.agent_issue.agent_unavailable')).not.toBeInTheDocument()
  })
})
