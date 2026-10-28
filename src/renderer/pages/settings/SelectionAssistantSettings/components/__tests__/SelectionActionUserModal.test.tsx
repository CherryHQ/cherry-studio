import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import SelectionActionUserModal from '../SelectionActionUserModal'

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
  useAgents: () => ({ agents: [{ id: 'agent-2', name: 'Researcher', configuration: { avatar: '🔬' } }] })
}))

vi.mock('@renderer/hooks/useAssistant', () => ({
  useAssistants: () => ({ assistants: [] })
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

  it('keeps the footer accessible when editing a long prompt', () => {
    const longPrompt = 'Keep the prompt inside the dialog.\n'.repeat(200)
    const onOk = vi.fn()
    const editingAction: SelectionActionItem = {
      id: 'user-long-prompt',
      name: 'Long prompt',
      enabled: true,
      isBuiltIn: false,
      prompt: longPrompt
    }

    render(<SelectionActionUserModal isModalOpen editingAction={editingAction} onOk={onOk} onCancel={vi.fn()} />)

    const prompt = screen.getByPlaceholderText('selection.settings.user_modal.prompt.placeholder')
    const dialogContent = screen.getByTestId('dialog-content')
    const scrollableBody = dialogContent.children[1]

    expect(prompt).toHaveValue(longPrompt)
    // These layout utilities are the viewport/scroll contract that prevents issue #19358.
    expect(dialogContent).toHaveClass(
      'max-h-[calc(100vh-2rem)]',
      'grid-rows-[auto_minmax(0,1fr)_auto]',
      'overflow-hidden'
    )
    expect(scrollableBody).toHaveClass('min-h-0', 'overflow-y-auto')
    expect(prompt).toHaveClass('max-h-40', 'overflow-y-auto', 'resize-none')
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
      expect.objectContaining({ name: 'Research', agentId: 'agent-2', agentWorkspace: { type: 'system' } })
    )
    expect(onOk.mock.calls[0][0].assistantId).toBeUndefined()
  })

  it('saves the chosen work directory with the agent', () => {
    const onOk = vi.fn()
    const editingAction: SelectionActionItem = {
      id: 'user-agent',
      name: 'Research',
      enabled: true,
      isBuiltIn: false,
      agentId: 'agent-2',
      agentWorkspace: { type: 'system' }
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

  it('drops the agent binding when the action switches back to the default model', () => {
    const onOk = vi.fn()
    const editingAction: SelectionActionItem = {
      id: 'user-agent',
      name: 'Research',
      enabled: true,
      isBuiltIn: false,
      agentId: 'agent-2',
      agentWorkspace: { type: 'user', workspaceId: 'workspace-1' }
    }
    render(<SelectionActionUserModal isModalOpen editingAction={editingAction} onOk={onOk} onCancel={vi.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: 'selection.settings.user_modal.model.default' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    const saved = onOk.mock.calls[0][0] as SelectionActionItem
    expect(saved.agentId).toBeUndefined()
    expect(saved.agentWorkspace).toBeUndefined()
    expect(saved.assistantId).toBeUndefined()
  })
})
