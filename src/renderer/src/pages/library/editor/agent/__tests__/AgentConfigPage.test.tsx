import type { AgentDetail } from '@shared/data/types/agent'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentConfigPage from '../AgentConfigPage'

const { createAgentMock, updateAgentMock } = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
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

vi.mock('@renderer/hooks/agents/useAgentTools', () => ({
  useAgentTools: () => ({
    tools: [{ id: 'Read', name: 'Read', type: 'builtin', requirePermissions: false }],
    isLoading: false,
    error: undefined
  })
}))

vi.mock('../../ConfigEditorShell', () => ({
  ConfigEditorShell: ({
    children,
    onSave,
    onSectionChange,
    sections
  }: {
    children: ReactNode
    onSave: () => Promise<void>
    onSectionChange: (section: 'basic' | 'prompt' | 'advanced' | 'tools' | 'permission') => void
    sections: Array<{ id: 'basic' | 'prompt' | 'advanced' | 'tools' | 'permission' }>
  }) => (
    <div>
      {sections.map((section) => (
        <button key={section.id} type="button" onClick={() => onSectionChange(section.id)}>
          {section.id}
        </button>
      ))}
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
  default: ({
    onChange
  }: {
    onChange: (patch: Partial<{ name: string; model: string; soulEnabled: boolean }>) => void
  }) => (
    <div>
      <button type="button" onClick={() => onChange({ name: 'Created Agent', model: 'anthropic::claude-sonnet-4-5' })}>
        set basic
      </button>
      <button type="button" onClick={() => onChange({ soulEnabled: true })}>
        enable autonomous
      </button>
    </div>
  )
}))

vi.mock('../sections/PermissionSection', () => ({
  default: () => null
}))

vi.mock('../sections/PromptSection', () => ({
  default: () => null
}))

vi.mock('../sections/ToolsSection', () => ({
  default: ({ onChange }: { onChange: (patch: Partial<{ allowedTools: string[]; mcps: string[] }>) => void }) => (
    <button type="button" onClick={() => onChange({ allowedTools: ['Read'], mcps: ['mcp-1'] })}>
      set tools
    </button>
  )
}))

function createAgent(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Agent',
    description: '',
    model: 'anthropic::claude-sonnet-4-5',
    modelName: null,
    instructions: '',
    mcps: [],
    allowedTools: [],
    configuration: {
      avatar: 'old-avatar',
      plugin_state: 'keep-me'
    },
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    ...overrides
  }
}

describe('AgentConfigPage', () => {
  beforeEach(() => {
    createAgentMock.mockReset()
    updateAgentMock.mockReset()
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

  it('creates an agent with the configured tool and MCP bindings', async () => {
    const user = userEvent.setup()
    createAgentMock.mockResolvedValueOnce(createAgent({ id: 'created-1', name: 'Created Agent' }))

    render(<AgentConfigPage onBack={vi.fn()} onCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'set basic' }))
    await user.click(screen.getByRole('button', { name: 'tools' }))
    await user.click(screen.getByRole('button', { name: 'set tools' }))
    await user.click(screen.getByRole('button', { name: 'save' }))

    await waitFor(() => expect(createAgentMock).toHaveBeenCalledTimes(1))
    expect(createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Created Agent',
        model: 'anthropic::claude-sonnet-4-5',
        allowedTools: ['Read'],
        mcps: ['mcp-1']
      })
    )
  })

  it('hides the permission section when autonomous mode is enabled', async () => {
    const user = userEvent.setup()

    render(<AgentConfigPage agent={createAgent()} onBack={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'permission' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'enable autonomous' }))

    expect(screen.queryByRole('button', { name: 'permission' })).not.toBeInTheDocument()
  })
})
