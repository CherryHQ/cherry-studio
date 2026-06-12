import type * as CherryUiModule from '@cherrystudio/ui'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentFormState } from '../descriptor'
import ToolsSection from '../sections/ToolsSection'

const toggleSkillMock = vi.hoisted(() => vi.fn())

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryUiModule>()
  return actual
})

vi.mock('@data/hooks/useDataApi', () => ({
  useQuery: () => ({
    data: { items: [] },
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    skills: [
      {
        id: 'skill-1',
        name: 'Skill One',
        description: 'Demo skill',
        isEnabled: false
      }
    ],
    loading: false,
    toggle: toggleSkillMock
  })
}))

vi.mock('../../components/CatalogPicker', () => ({
  AddCatalogPopover: ({
    triggerLabel,
    disabled,
    items,
    enabledIds,
    onAdd
  }: {
    triggerLabel: string
    disabled?: boolean
    items: Array<{ id: string; name: string }>
    enabledIds: ReadonlySet<string>
    onAdd: (id: string) => void
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        const next = items.find((item) => !enabledIds.has(item.id))
        if (next) onAdd(next.id)
      }}>
      {triggerLabel}
    </button>
  ),
  BoundCatalogList: ({
    items,
    emptyLabel,
    onDisable
  }: {
    items: Array<{ id: string; name: string; disableToggle?: boolean; statusBadge?: ReactNode }>
    emptyLabel: ReactNode
    onDisable: (id: string) => void
  }) => (
    <div>
      {items.length === 0
        ? emptyLabel
        : items.map((item) => (
            <div key={item.id}>
              <span>{item.name}</span>
              {item.statusBadge ? <span>{item.statusBadge}</span> : null}
              <button type="button" disabled={item.disableToggle} onClick={() => onDisable(item.id)}>
                toggle {item.name}
              </button>
            </div>
          ))}
    </div>
  )
}))

function createForm(overrides: Partial<AgentFormState> = {}): AgentFormState {
  return {
    name: 'Agent',
    description: '',
    model: 'anthropic::claude-sonnet-4-5',
    planModel: '',
    smallModel: '',
    instructions: '',
    mcps: [],
    disabledTools: [],
    avatar: '',
    permissionMode: '',
    maxTurns: 0,
    envVarsText: '',
    soulEnabled: false,
    heartbeatEnabled: false,
    heartbeatInterval: 0,
    ...overrides
  }
}

describe('ToolsSection', () => {
  const tools = [
    {
      id: 'Read',
      name: 'Read',
      origin: 'builtin' as const,
      approval: 'auto' as const
    },
    {
      id: 'Glob',
      name: 'Glob',
      origin: 'builtin' as const,
      approval: 'auto' as const
    },
    {
      id: 'Bash',
      name: 'Bash',
      origin: 'builtin' as const,
      approval: 'prompt' as const
    }
  ]

  it('shows built-in tools when disabledTools is empty', () => {
    render(
      <ToolsSection
        agent={{
          id: 'agent-1',
          type: 'claude-code',
          name: 'Agent',
          model: 'anthropic::claude-sonnet-4-5',
          modelName: null,
          createdAt: '',
          updatedAt: '',
          orderKey: 'k'
        }}
        tools={tools}
        form={createForm({ permissionMode: 'default', disabledTools: [] })}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Glob')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  it('disables a built-in tool by adding it to disabledTools', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ToolsSection
        agent={{
          id: 'agent-1',
          type: 'claude-code',
          name: 'Agent',
          model: 'anthropic::claude-sonnet-4-5',
          modelName: null,
          createdAt: '',
          updatedAt: '',
          orderKey: 'k'
        }}
        tools={tools}
        form={createForm({ permissionMode: 'default', disabledTools: [] })}
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'toggle Read' }))

    expect(onChange).toHaveBeenCalledWith({
      disabledTools: ['Read']
    })
  })

  it('re-enables a disabled built-in tool', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ToolsSection
        agent={{
          id: 'agent-1',
          type: 'claude-code',
          name: 'Agent',
          model: 'anthropic::claude-sonnet-4-5',
          modelName: null,
          createdAt: '',
          updatedAt: '',
          orderKey: 'k'
        }}
        tools={tools}
        form={createForm({ permissionMode: 'default', disabledTools: ['Bash'] })}
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'library.config.agent.section.tools.add' }))

    expect(onChange).toHaveBeenCalledWith({
      disabledTools: []
    })
  })

  it('disables skill enablement before the agent has been created', async () => {
    const user = userEvent.setup()

    render(
      <ToolsSection
        agent={{
          id: '',
          type: 'claude-code',
          name: '',
          model: null,
          modelName: null,
          createdAt: '',
          updatedAt: '',
          orderKey: '',
          tools: []
        }}
        tools={[]}
        form={createForm()}
        onChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('tab', { name: /library\.config\.agent\.section\.tools\.tab\.skills/i }))

    expect(screen.getByRole('button', { name: 'library.config.agent.section.tools.add' })).toBeDisabled()
    expect(screen.getByText('library.config.agent.section.tools.skills_require_save')).toBeInTheDocument()
  })
})
