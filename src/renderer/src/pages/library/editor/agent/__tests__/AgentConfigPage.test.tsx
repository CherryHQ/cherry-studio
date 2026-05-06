import type { AgentDetail } from '@shared/data/types/agent'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentConfigPage from '../AgentConfigPage'

const { createAgentMock, ensureTagsMock, updateAgentMock } = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
  ensureTagsMock: vi.fn(),
  updateAgentMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('../../../adapters/agentAdapter', () => ({
  useAgentMutations: () => ({
    createAgent: createAgentMock
  }),
  useAgentMutationsById: () => ({
    updateAgent: updateAgentMock
  })
}))

vi.mock('../../../adapters/tagAdapter', () => ({
  useEnsureTags: () => ({
    ensureTags: ensureTagsMock
  }),
  useTagList: () => ({
    tags: []
  })
}))

vi.mock('../../ConfigEditorShell', () => ({
  ConfigEditorShell: ({
    children,
    onSave,
    onSectionChange
  }: {
    children: ReactNode
    onSave: () => Promise<void>
    onSectionChange: (section: 'advanced') => void
  }) => (
    <div>
      <button type="button" onClick={() => onSectionChange('advanced')}>
        advanced
      </button>
      <button type="button" onClick={() => void onSave()}>
        save
      </button>
      {children}
    </div>
  )
}))

vi.mock('../sections/AdvancedSection', () => ({
  default: ({ onChange }: { onChange: (patch: Partial<{ avatar: string; maxTurns: number }>) => void }) => (
    <div>
      <button type="button" onClick={() => onChange({ avatar: 'new-avatar' })}>
        set avatar
      </button>
      <button type="button" onClick={() => onChange({ maxTurns: 5 })}>
        set max turns
      </button>
    </div>
  )
}))

vi.mock('../sections/BasicSection', () => ({
  default: () => null
}))

vi.mock('../sections/PermissionSection', () => ({
  default: () => null
}))

vi.mock('../sections/PromptSection', () => ({
  default: () => null
}))

vi.mock('../sections/ToolsSection', () => ({
  default: () => null
}))

function createAgent(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Agent',
    description: '',
    model: 'claude-sonnet-4-5',
    modelName: null,
    accessiblePaths: [],
    instructions: '',
    mcps: [],
    allowedTools: [],
    configuration: {
      avatar: 'old-avatar',
      plugin_state: 'keep-me'
    },
    tags: [],
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    ...overrides
  }
}

describe('AgentConfigPage', () => {
  beforeEach(() => {
    createAgentMock.mockReset()
    ensureTagsMock.mockReset()
    updateAgentMock.mockReset()
    ensureTagsMock.mockResolvedValue([])
  })

  it('uses the latest saved agent configuration as the next merge base', async () => {
    const user = userEvent.setup()
    const agent = createAgent()
    updateAgentMock
      .mockResolvedValueOnce(
        createAgent({
          configuration: {
            avatar: 'new-avatar',
            plugin_state: 'keep-me'
          }
        })
      )
      .mockResolvedValueOnce(
        createAgent({
          configuration: {
            avatar: 'new-avatar',
            plugin_state: 'keep-me',
            max_turns: 5
          }
        })
      )

    render(<AgentConfigPage agent={agent} onBack={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'advanced' }))
    await user.click(screen.getByRole('button', { name: 'set avatar' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(1))
    expect(updateAgentMock).toHaveBeenNthCalledWith(1, {
      configuration: {
        avatar: 'new-avatar',
        plugin_state: 'keep-me'
      }
    })

    await user.click(screen.getByRole('button', { name: 'set max turns' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalledTimes(2))
    expect(updateAgentMock).toHaveBeenNthCalledWith(2, {
      configuration: {
        avatar: 'new-avatar',
        plugin_state: 'keep-me',
        max_turns: 5
      }
    })
  })
})
