import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

import SelectionActionAskAgentModal from '../SelectionActionAskAgentModal'

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  AgentSelector: ({ onChange, trigger }: { onChange: (id: string) => void; trigger: ReactNode }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange('agent-2')}>
        select agent 2
      </button>
    </div>
  ),
  WorkspaceSelector: ({ onChange, trigger }: { onChange: (id: string | null) => void; trigger: ReactNode }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onChange(null)}>
        clear workspace
      </button>
    </div>
  )
}))

vi.mock('@renderer/hooks/agent/useAgent', () => ({
  useAgents: () => ({
    agents: [
      { id: 'builtin-uuid', name: 'Cherry Assistant', configuration: { avatar: '🍒', builtin_role: 'assistant' } },
      { id: 'agent-2', name: 'Researcher', configuration: { avatar: '🔬' } }
    ]
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const ASK_AGENT: SelectionActionItem = {
  id: 'ask-agent',
  name: 'selection.action.builtin.ask_agent',
  enabled: true,
  isBuiltIn: true,
  icon: 'bot'
}

describe('SelectionActionAskAgentModal', () => {
  beforeEach(() => {
    MockUseDataApiUtils.mockQueryData('/agent-workspaces', [])
  })

  it('keeps the built-in assistant as an unpinned default', () => {
    const onOk = vi.fn()
    render(<SelectionActionAskAgentModal isModalOpen currentAction={ASK_AGENT} onOk={onOk} onCancel={vi.fn()} />)

    expect(screen.getByText('Cherry Assistant')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(onOk).toHaveBeenCalledWith({ agentId: undefined, agentWorkspace: { type: 'system' } })
  })

  it('saves a chosen agent and work directory as the new defaults', () => {
    const onOk = vi.fn()
    render(
      <SelectionActionAskAgentModal
        isModalOpen
        currentAction={{ ...ASK_AGENT, agentWorkspace: { type: 'user', workspaceId: 'workspace-1' } }}
        onOk={onOk}
        onCancel={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'select agent 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'clear workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }))

    expect(screen.getByText('Researcher')).toBeInTheDocument()
    expect(onOk).toHaveBeenCalledWith({ agentId: 'agent-2', agentWorkspace: { type: 'system' } })
  })
})
