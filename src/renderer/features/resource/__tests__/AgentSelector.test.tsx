import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createAgentMock,
  refetchAgentsMock,
  refetchPinsMock,
  toggleSkillMock,
  togglePinMock,
  updateAgentMock,
  useMutationMock,
  usePinsMock,
  useProvidersMock,
  useQueryMock
} = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
  refetchAgentsMock: vi.fn(),
  refetchPinsMock: vi.fn(),
  toggleSkillMock: vi.fn(),
  togglePinMock: vi.fn(),
  updateAgentMock: vi.fn(),
  useMutationMock: vi.fn(),
  usePinsMock: vi.fn(),
  useProvidersMock: vi.fn(),
  useQueryMock: vi.fn()
}))

const MODEL = vi.hoisted(
  () =>
    ({
      id: 'provider::agent-model',
      providerId: 'provider',
      name: 'Agent Model',
      capabilities: [],
      endpointTypes: ['anthropic_messages'],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }) as const
)

vi.mock('@renderer/components/Selector/model', () => ({
  ModelSelector: ({
    trigger,
    onSelect
  }: {
    trigger: ReactNode
    onSelect: (model: typeof MODEL | undefined) => void
  }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect(MODEL)}>
        Pick model
      </button>
    </div>
  )
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: usePinsMock
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviderDisplayName: () => (providerId: string) => providerId,
  useProviders: useProvidersMock
}))

vi.mock('@renderer/hooks/agents/useAgentTools', () => ({
  useAgentTools: () => ({ tools: [], isLoading: false, error: undefined })
}))

vi.mock('@renderer/hooks/useMcpRuntimeStatus', () => ({
  useMcpRuntimeStatusMap: () => ({})
}))

vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    skills: [],
    loading: false,
    toggle: toggleSkillMock
  })
}))

vi.mock('@renderer/hooks/usePromptProcessor', () => ({
  usePromptProcessor: ({ prompt }: { prompt: string }) => prompt
}))

vi.mock('@renderer/services/ApiService', () => ({
  fetchGenerate: vi.fn()
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
        ({
          'common.cancel': 'Cancel',
          'common.description': 'Description',
          'common.model': 'Model',
          'common.name': 'Name',
          'common.required_field': 'Required',
          'common.save': 'Save',
          'agent.cherryClaw.heartbeat.enabledHelper': 'Send heartbeat messages.',
          'agent.cherryClaw.heartbeat.intervalHelper': 'Heartbeat interval.',
          'agent.edit.title': 'Edit agent',
          'library.config.agent.field.description.hint': 'Short agent summary.',
          'library.config.agent.field.description.label': 'Description',
          'library.config.agent.field.description.placeholder': 'Describe this agent',
          'library.config.agent.field.heartbeat_enabled.label': 'Heartbeat',
          'library.config.agent.field.heartbeat_interval.label': 'Heartbeat interval',
          'library.config.agent.field.instructions.label': 'Instructions',
          'library.config.agent.field.instructions.placeholder': 'Tell this agent how to work',
          'library.config.agent.field.model.hint': 'Primary agent model.',
          'library.config.agent.field.model.label': 'Model',
          'library.config.agent.field.name.hint': 'Shown in the selector.',
          'library.config.agent.field.name.label': 'Name',
          'library.config.agent.field.name.placeholder': 'Name this agent',
          'library.config.agent.field.plan_model.hint': 'Plan model.',
          'library.config.agent.field.plan_model.label': 'Plan model',
          'library.config.agent.field.small_model.hint': 'Small model.',
          'library.config.agent.field.small_model.label': 'Small model',
          'library.config.agent.field.soul_enabled.help': 'Use soul.md.',
          'library.config.agent.field.soul_enabled.label': 'Soul',
          'library.config.basic.model_clear': 'Clear',
          'library.config.basic.model_not_found': 'Model {{id}} is unavailable.',
          'library.config.basic.model_pick': 'Pick model',
          'selector.agent.create_new': 'Create agent',
          'selector.agent.empty_text': 'No agents yet. Create one first.',
          'selector.agent.search_placeholder': 'Search agents',
          'selector.common.pin': 'Pin',
          'selector.common.pinned_title': 'Pinned',
          'selector.common.unpin': 'Unpin',
          'library.config.dialogs.create.agent_title': 'New Agent',
          'library.config.dialogs.create.avatar_aria': 'Pick avatar',
          'library.config.dialogs.create.dialog_description': 'Create a lightweight resource from the selector.',
          'library.config.dialogs.create.description_placeholder': 'Describe this resource',
          'library.config.dialogs.create.model_placeholder': 'Select a model',
          'library.config.dialogs.create.model_required': 'Please select a model',
          'library.config.dialogs.create.name_placeholder': 'Name this resource',
          'library.config.dialogs.create.name_required': 'Please enter a name',
          'library.config.dialogs.create.submit': 'Create',
          'library.config.dialogs.create.submit_failed': 'Create failed',
          'library.config.dialogs.edit.agent_description': 'Edit the essentials for this agent.',
          'library.config.dialogs.edit.agent_title': 'Edit Agent',
          'library.config.dialogs.edit.basic_tab': 'Basic',
          'library.config.dialogs.edit.prompt_tab': 'Prompt',
          'library.config.dialogs.edit.save_failed': 'Save failed',
          'selector.create_dialog.refresh_failed': 'Created, but refresh failed',
          'selector.edit_dialog.refresh_failed': 'Saved, but refresh failed'
        })[key] ?? key
    })
  }
})

import { DEFAULT_SELECTOR_CONTENT_HEIGHT } from '@renderer/components/Selector/shell/SelectorShell'

import { AgentSelector, type AgentSelectorItem } from '../AgentSelector'

const ALPHA_AGENT_ID = '44444444-4444-4444-8444-444444444444'
const BETA_AGENT_ID = '55555555-5555-4555-8555-555555555555'

const AGENTS_RESPONSE = {
  items: [
    {
      id: ALPHA_AGENT_ID,
      type: 'claude-code',
      name: 'Alpha Agent',
      description: 'First test agent',
      instructions: 'Original alpha instructions',
      model: 'provider::old-model',
      planModel: null,
      smallModel: null,
      mcps: [],
      allowedTools: [],
      configuration: {
        avatar: '🤖',
        soul_enabled: false,
        heartbeat_enabled: true,
        heartbeat_interval: 30
      },
      orderKey: 'a0',
      modelName: 'Old Model',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    {
      id: BETA_AGENT_ID,
      type: 'claude-code',
      name: 'Beta Agent',
      description: 'Second test agent',
      instructions: 'Original beta instructions',
      model: 'provider::old-model',
      planModel: null,
      smallModel: null,
      mcps: [],
      allowedTools: [],
      configuration: {
        avatar: '🤖',
        soul_enabled: false,
        heartbeat_enabled: true,
        heartbeat_interval: 30
      },
      orderKey: 'a1',
      modelName: 'Old Model',
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z'
    }
  ],
  total: 2,
  page: 1
} as const

const toastErrorMock = vi.fn()

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  HTMLElement.prototype.scrollIntoView = () => {}
  window.toast = { error: toastErrorMock } as unknown as typeof window.toast
})

beforeEach(() => {
  useQueryMock.mockReturnValue({
    data: AGENTS_RESPONSE,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: refetchAgentsMock,
    mutate: vi.fn()
  })
  useMutationMock.mockImplementation((method: string, path: string) => {
    if (method === 'PATCH' && path.startsWith('/agents/')) {
      return {
        trigger: updateAgentMock,
        isLoading: false,
        error: undefined
      }
    }
    return {
      trigger: createAgentMock,
      isLoading: false,
      error: undefined
    }
  })
  createAgentMock.mockResolvedValue({
    id: 'created-agent',
    type: 'claude-code',
    name: 'Created Agent',
    description: 'Created from selector',
    accessiblePaths: [],
    model: MODEL.id
  })
  updateAgentMock.mockResolvedValue({
    ...AGENTS_RESPONSE.items[0],
    name: 'Renamed Agent'
  })
  usePinsMock.mockReturnValue({
    isLoading: false,
    isRefreshing: false,
    isMutating: false,
    error: undefined,
    pinnedIds: [],
    refetch: refetchPinsMock,
    togglePin: togglePinMock
  })
  useProvidersMock.mockReturnValue({
    providers: [{ id: 'provider', endpointConfigs: { 'anthropic-messages': {} } }]
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderSelector(onChange = vi.fn()) {
  render(<AgentSelector trigger={<button type="button">Open</button>} value={null} onChange={onChange} />)
  return { onChange }
}

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
}

async function openCreateDialog() {
  openPopover()
  fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
  await screen.findByRole('dialog')
}

describe('AgentSelector', () => {
  it('sets the default popover target height', () => {
    renderSelector()
    openPopover()

    expect(document.querySelector('[data-selector-shell-content]')).toHaveStyle({
      height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px`
    })
  })

  it('fetches agents from DataApi and renders returned rows', () => {
    renderSelector()
    openPopover()

    expect(useQueryMock).toHaveBeenCalledWith('/agents', { query: { limit: 500 } })
    expect(screen.getByRole('option', { name: /Alpha Agent/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Beta Agent/ })).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Alpha Agent')
    expect(options[1]).toHaveTextContent('Beta Agent')
    expect(screen.queryByRole('button', { pressed: false })).not.toBeInTheDocument()
  })

  it('renders the empty state prompt when no agents exist', () => {
    useQueryMock.mockReturnValue({
      data: { items: [], total: 0, page: 1 },
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: refetchAgentsMock,
      mutate: vi.fn()
    })

    renderSelector()
    openPopover()

    expect(screen.getByText('No agents yet. Create one first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create agent' })).toBeInTheDocument()
  })

  it('falls back to the default agent avatar for blank stored avatars', () => {
    useQueryMock.mockReturnValue({
      data: {
        items: [
          {
            ...AGENTS_RESPONSE.items[0],
            configuration: {
              ...AGENTS_RESPONSE.items[0].configuration,
              avatar: '   '
            }
          }
        ],
        total: 1,
        page: 1
      },
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: refetchAgentsMock,
      mutate: vi.fn()
    })

    renderSelector()
    openPopover()

    expect(screen.getByRole('option', { name: /Alpha Agent/ })).toHaveTextContent('🤖')
  })

  it('fires onChange with the selected agent id', () => {
    const { onChange } = renderSelector()
    openPopover()

    fireEvent.click(screen.getByText('Beta Agent'))

    expect(onChange).toHaveBeenCalledWith(BETA_AGENT_ID)
  })

  it('fires onChange with the selected agent item when selectionType is item', () => {
    const onChange = vi.fn<(value: AgentSelectorItem | null) => void>()
    render(
      <AgentSelector
        trigger={<button type="button">Open</button>}
        selectionType="item"
        value={null}
        onChange={onChange}
      />
    )
    openPopover()

    fireEvent.click(screen.getByText('Alpha Agent'))

    expect(onChange).toHaveBeenCalledWith({
      id: ALPHA_AGENT_ID,
      name: 'Alpha Agent',
      description: 'First test agent',
      emoji: '🤖'
    })
  })

  it('uses the agent pin hook and renders pinned agents in the pinned section', () => {
    usePinsMock.mockReturnValue({
      isLoading: false,
      isRefreshing: false,
      isMutating: false,
      error: undefined,
      pinnedIds: [ALPHA_AGENT_ID],
      refetch: refetchPinsMock,
      togglePin: togglePinMock
    })

    renderSelector()
    openPopover()

    expect(usePinsMock).toHaveBeenCalledWith('agent')
    expect(screen.getByText('Pinned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }))
    expect(togglePinMock).toHaveBeenCalledWith(ALPHA_AGENT_ID)
  })

  it('opens the lightweight create dialog from the create action', async () => {
    renderSelector()
    await openCreateDialog()

    expect(screen.getByRole('heading', { name: 'New Agent' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Name this resource')).toBeInTheDocument()
    expect(screen.getByText('Select a model')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Describe this resource')).toBeInTheDocument()
  })

  it('creates an agent, refreshes, reopens the selector, and does not auto-select by default', async () => {
    const { onChange } = renderSelector()
    await openCreateDialog()

    fireEvent.change(screen.getByPlaceholderText('Name this resource'), { target: { value: 'Created Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.change(screen.getByPlaceholderText('Describe this resource'), {
      target: { value: 'Created from selector' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(createAgentMock).toHaveBeenCalledWith({
        body: {
          type: 'claude-code',
          name: 'Created Agent',
          model: MODEL.id,
          planModel: MODEL.id,
          smallModel: MODEL.id,
          description: 'Created from selector',
          configuration: {
            avatar: '🤖',
            permission_mode: 'bypassPermissions',
            soul_enabled: true
          }
        }
      })
    )
    await waitFor(() => expect(refetchAgentsMock).toHaveBeenCalledTimes(1))
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByPlaceholderText('Search agents')).toBeInTheDocument())
  })

  it('auto-selects the created agent when enabled', async () => {
    const onChange = vi.fn()
    render(
      <AgentSelector
        trigger={<button type="button">Open</button>}
        value={null}
        onChange={onChange}
        autoSelectOnCreate
      />
    )
    await openCreateDialog()

    fireEvent.change(screen.getByPlaceholderText('Name this resource'), { target: { value: 'Created Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(refetchAgentsMock).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenCalledWith('created-agent')
  })

  it('notifies when created agent cannot be refreshed into the selector', async () => {
    refetchAgentsMock.mockRejectedValueOnce(new Error('Refresh failed'))
    renderSelector()
    await openCreateDialog()

    fireEvent.change(screen.getByPlaceholderText('Name this resource'), { target: { value: 'Created Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(refetchAgentsMock).toHaveBeenCalledTimes(1))

    expect(toastErrorMock).toHaveBeenCalledWith('Created, but refresh failed')
    await waitFor(() => expect(screen.getByPlaceholderText('Search agents')).toBeInTheDocument())
  })

  it('keeps the selector closed after editing an agent from a row action', async () => {
    renderSelector()
    openPopover()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit agent' })[0])

    expect(await screen.findByRole('heading', { name: 'Edit Agent' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed Agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAgentMock).toHaveBeenCalled())
    await waitFor(() => expect(refetchAgentsMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByPlaceholderText('Search agents')).not.toBeInTheDocument()
  })

  it('does not show the empty state while the agents query is loading', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn(),
      mutate: vi.fn()
    })

    renderSelector()
    openPopover()

    expect(screen.queryByText('No agents yet. Create one first.')).not.toBeInTheDocument()
  })
})
