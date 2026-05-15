import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createAgentMock,
  refetchAgentsMock,
  refetchPinsMock,
  togglePinMock,
  useMutationMock,
  usePinsMock,
  useProvidersMock,
  useQueryMock
} = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
  refetchAgentsMock: vi.fn(),
  refetchPinsMock: vi.fn(),
  togglePinMock: vi.fn(),
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

vi.mock('../model', () => ({
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

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviders: useProvidersMock
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
          'selector.agent.create_new': 'Create agent',
          'selector.agent.empty_text': 'No agents',
          'selector.agent.search_placeholder': 'Search agents',
          'selector.common.pin': 'Pin',
          'selector.common.pinned_title': 'Pinned',
          'selector.common.unpin': 'Unpin',
          'selector.create_dialog.agent_title': 'New Agent',
          'selector.create_dialog.avatar_aria': 'Pick avatar',
          'selector.create_dialog.create': 'Create',
          'selector.create_dialog.dialog_description': 'Create a lightweight resource from the selector.',
          'selector.create_dialog.description_placeholder': 'Describe this resource',
          'selector.create_dialog.model_placeholder': 'Select a model',
          'selector.create_dialog.model_required': 'Please select a model',
          'selector.create_dialog.name_placeholder': 'Name this resource',
          'selector.create_dialog.name_required': 'Please enter a name',
          'selector.create_dialog.refresh_failed': 'Created, but refresh failed',
          'selector.create_dialog.submit_failed': 'Create failed'
        })[key] ?? key
    })
  }
})

import { AgentSelector, type AgentSelectorItem } from '../resource/AgentSelector'

const ALPHA_AGENT_ID = '44444444-4444-4444-8444-444444444444'
const BETA_AGENT_ID = '55555555-5555-4555-8555-555555555555'

const AGENTS_RESPONSE = {
  items: [
    {
      id: ALPHA_AGENT_ID,
      type: 'claude-code',
      name: 'Alpha Agent',
      description: 'First test agent',
      model: 'claude-3-5-sonnet',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    {
      id: BETA_AGENT_ID,
      type: 'claude-code',
      name: 'Beta Agent',
      description: 'Second test agent',
      model: 'claude-3-5-sonnet',
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
  window.toast = { error: toastErrorMock } as typeof window.toast
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
  useMutationMock.mockReturnValue({
    trigger: createAgentMock,
    isLoading: false,
    error: undefined
  })
  createAgentMock.mockResolvedValue({
    id: 'created-agent',
    type: 'claude-code',
    name: 'Created Agent',
    description: 'Created from selector',
    accessiblePaths: [],
    model: MODEL.id
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
      description: 'First test agent'
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

  it('creates an agent, refreshes, reopens the selector, and does not auto-select', async () => {
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
          description: 'Created from selector',
          configuration: { avatar: '🤖' }
        }
      })
    )
    await waitFor(() => expect(refetchAgentsMock).toHaveBeenCalledTimes(1))
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByPlaceholderText('Search agents')).toBeInTheDocument())
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

    expect(screen.queryByText('No agents')).not.toBeInTheDocument()
  })
})
