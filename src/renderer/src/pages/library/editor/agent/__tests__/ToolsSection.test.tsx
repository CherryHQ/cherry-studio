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
    emptyLabel
  }: {
    items: Array<{ id: string; name: string; disableToggle?: boolean; statusBadge?: ReactNode }>
    emptyLabel: ReactNode
  }) => (
    <div>
      {items.length === 0
        ? emptyLabel
        : items.map((item) => (
            <div key={item.id}>
              <span>{item.name}</span>
              {item.statusBadge ? <span>{item.statusBadge}</span> : null}
              <button type="button" disabled={item.disableToggle}>
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
    model: 'claude-sonnet-4-5',
    planModel: '',
    smallModel: '',
    instructions: '',
    mcps: [],
    allowedTools: [],
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
    { id: 'Read', name: 'Read', type: 'builtin' as const, requirePermissions: false },
    { id: 'Glob', name: 'Glob', type: 'builtin' as const, requirePermissions: false },
    { id: 'Bash', name: 'Bash', type: 'builtin' as const, requirePermissions: true }
  ]

  it('shows permission-mode default tools even when allowedTools is empty', () => {
    render(
      <ToolsSection
        agent={{
          id: 'agent-1',
          type: 'claude-code',
          name: 'Agent',
          model: 'claude-sonnet-4-5',
          modelName: null,
          createdAt: '',
          updatedAt: ''
        }}
        tools={tools}
        form={createForm({ permissionMode: 'default', allowedTools: [] })}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Glob')).toBeInTheDocument()
  })

  it('locks permission-mode default tool switches', () => {
    render(
      <ToolsSection
        agent={{
          id: 'agent-1',
          type: 'claude-code',
          name: 'Agent',
          model: 'claude-sonnet-4-5',
          modelName: null,
          createdAt: '',
          updatedAt: ''
        }}
        tools={tools}
        form={createForm({ permissionMode: 'default', allowedTools: [] })}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'toggle Read' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'toggle Glob' })).toBeDisabled()
  })

  it('adds a built-in tool while preserving auto-approved defaults', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <ToolsSection
        agent={{
          id: 'agent-1',
          type: 'claude-code',
          name: 'Agent',
          model: 'claude-sonnet-4-5',
          modelName: null,
          createdAt: '',
          updatedAt: ''
        }}
        tools={tools}
        form={createForm({ permissionMode: 'default', allowedTools: [] })}
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'library.config.agent.section.tools.add' }))

    expect(onChange).toHaveBeenCalledWith({
      allowedTools: ['Read', 'Glob', 'Bash']
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
          model: '',
          modelName: null,
          createdAt: '',
          updatedAt: '',
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
