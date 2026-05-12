import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { navigateMock, openTabMock, refetchPinsMock, tabsContextMock, togglePinMock, usePinsMock, useQueryMock } =
  vi.hoisted(() => ({
    navigateMock: vi.fn(),
    openTabMock: vi.fn(),
    refetchPinsMock: vi.fn(),
    tabsContextMock: vi.fn(),
    togglePinMock: vi.fn(),
    usePinsMock: vi.fn(),
    useQueryMock: vi.fn()
  }))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useQuery: useQueryMock
}))

vi.mock('@renderer/hooks/usePins', () => ({
  usePins: usePinsMock
}))

vi.mock('@renderer/context/TabsContext', () => ({
  useOptionalTabsContext: tabsContextMock
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
        ({
          'selector.agent.create_new': 'Create agent',
          'selector.agent.empty_text': 'No agents',
          'selector.agent.search_placeholder': 'Search agents',
          'selector.common.pin': 'Pin',
          'selector.common.pinned_title': 'Pinned',
          'selector.common.unpin': 'Unpin'
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
})

beforeEach(() => {
  window.navigate = navigateMock as typeof window.navigate
  tabsContextMock.mockReturnValue({
    openTab: openTabMock
  })
  useQueryMock.mockReturnValue({
    data: AGENTS_RESPONSE,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: vi.fn(),
    mutate: vi.fn()
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

  it('renders without tab context and opens the agent create flow through global navigation', async () => {
    tabsContextMock.mockReturnValue(null)

    renderSelector()
    openPopover()

    expect(screen.getByRole('option', { name: /Alpha Agent/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/app/library',
        search: { resourceType: 'agent', action: 'create' }
      })
    )
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

  it('navigates to the resource library agent create flow from the footer action', async () => {
    renderSelector()
    openPopover()

    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    await waitFor(() =>
      expect(openTabMock).toHaveBeenCalledWith('/app/library?resourceType=agent&action=create', { forceNew: true })
    )
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
