import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentDetail } from '@renderer/types/resourceCatalog'

const mocks = vi.hoisted(() => ({
  openRoute: vi.fn(),
  tasks: [] as unknown[],
  skills: [] as Array<{ id: string; isEnabled: boolean }>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key)
  })
}))

vi.mock('@renderer/hooks/agent/useTasks', () => ({ useTasks: () => ({ tasks: mocks.tasks }) }))
vi.mock('@renderer/hooks/useSkills', () => ({ useInstalledSkills: () => ({ skills: mocks.skills }) }))
vi.mock('@renderer/hooks/useModel', () => ({ useModelById: () => ({ model: undefined }) }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openRoute: mocks.openRoute }))

import { AgentProfileDialog } from '../AgentProfileDialog'

const AGENT = {
  id: 'agent-1',
  type: 'pi',
  name: 'Slide Expert',
  description: 'Turns meeting notes into report decks.',
  model: 'provider::model',
  modelName: 'Claude Sonnet 4.5',
  disabledTools: [],
  configuration: { avatar: '📊' }
} as unknown as AgentDetail

const TASK = {
  id: 'task-1',
  agentId: 'agent-1',
  name: 'Weekly report deck',
  prompt: 'Build the weekly deck',
  trigger: { kind: 'interval', ms: 3_600_000 },
  status: 'paused',
  nextRun: null
}

function renderProfile(agent: AgentDetail | null = AGENT) {
  const onOpenChange = vi.fn()
  const onOpenSettings = vi.fn()
  render(<AgentProfileDialog open agent={agent} onOpenChange={onOpenChange} onOpenSettings={onOpenSettings} />)
  return { onOpenChange, onOpenSettings }
}

beforeEach(() => {
  mocks.openRoute.mockReset()
  mocks.tasks = []
  mocks.skills = [
    { id: 'pdf', isEnabled: true },
    { id: 'pptx', isEnabled: true },
    { id: 'xlsx', isEnabled: false }
  ]
})

afterEach(cleanup)

describe('AgentProfileDialog', () => {
  it('leads with who the Agent is: avatar, name, model, enabled skills, and description', () => {
    renderProfile()

    expect(screen.getByRole('heading', { name: 'Slide Expert' })).toBeInTheDocument()
    expect(screen.getByText('📊')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument()
    expect(screen.getByText(/library\.config\.agent\.profile\.capabilities .*"skills":2/)).toBeInTheDocument()
    expect(screen.getByText('Turns meeting notes into report decks.')).toBeInTheDocument()
  })

  it('falls back to the builtin description when the stored one is empty', () => {
    renderProfile({
      ...AGENT,
      description: '',
      configuration: { avatar: '🧰', builtin_role: 'support' }
    } as unknown as AgentDetail)

    expect(screen.getByText('agent.builtin.cherry_support.description')).toBeInTheDocument()
    expect(screen.queryByText('library.config.agent.profile.no_description')).not.toBeInTheDocument()
  })

  it('leaves the model out instead of showing an empty slot when the Agent has none', () => {
    renderProfile({ ...AGENT, model: '', modelName: null } as unknown as AgentDetail)

    expect(screen.queryByText('·')).not.toBeInTheDocument()
    expect(screen.getByText(/library\.config\.agent\.profile\.capabilities/)).toBeInTheDocument()
  })

  it('shows an empty state when the Agent has no scheduled tasks', () => {
    renderProfile()

    expect(screen.getByText('library.config.agent.profile.no_tasks')).toBeInTheDocument()
  })

  it('lists the Agent’s scheduled tasks with their status', () => {
    mocks.tasks = [TASK]
    renderProfile()

    expect(screen.getByText('Weekly report deck')).toBeInTheDocument()
    expect(screen.getByText('agent.tasks.status.paused')).toBeInTheDocument()
    expect(screen.queryByText('library.config.agent.profile.no_tasks')).not.toBeInTheDocument()
  })

  it('starts a chat with the Agent and closes the card', () => {
    const { onOpenChange } = renderProfile()

    fireEvent.click(screen.getByRole('button', { name: 'library.config.agent.profile.start_chat' }))

    expect(mocks.openRoute).toHaveBeenCalledWith('/app/agents', { agentId: 'agent-1' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens the settings from "More settings"', () => {
    const { onOpenSettings } = renderProfile()

    fireEvent.click(screen.getByRole('button', { name: 'library.config.agent.profile.more_settings' }))

    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('renders nothing until the Agent has loaded', () => {
    renderProfile(null)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
