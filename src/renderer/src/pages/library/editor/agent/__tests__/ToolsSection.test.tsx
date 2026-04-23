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

vi.mock('../sections/catalogComponents', () => ({
  AddCatalogPopover: ({ triggerLabel, disabled }: { triggerLabel: string; disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      {triggerLabel}
    </button>
  ),
  BoundCatalogList: ({ items, emptyLabel }: { items: Array<{ id: string }>; emptyLabel: ReactNode }) => (
    <div>{items.length === 0 ? emptyLabel : 'has-items'}</div>
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
    accessiblePaths: [],
    mcps: [],
    allowedTools: [],
    slashCommands: [],
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
  it('disables skill enablement before the agent has been created', async () => {
    const user = userEvent.setup()

    render(
      <ToolsSection
        agent={{
          id: '',
          type: 'claude-code',
          accessible_paths: [],
          model: '',
          created_at: '',
          updated_at: '',
          tools: []
        }}
        form={createForm()}
        onChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /Skills/i }))

    expect(screen.getByRole('button', { name: 'library.config.agent.section.tools.add' })).toBeDisabled()
    expect(screen.getByText('library.config.agent.section.tools.skills_require_save')).toBeInTheDocument()
  })
})
