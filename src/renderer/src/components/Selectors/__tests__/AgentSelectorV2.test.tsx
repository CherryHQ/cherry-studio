import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { navigateMock, refetchPinsMock, togglePinMock, usePinsMock, useQueryMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  refetchPinsMock: vi.fn(),
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

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
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
          'selector.common.edit': 'Edit',
          'selector.common.pin': 'Pin',
          'selector.common.pinned_title': 'Pinned',
          'selector.common.sort.asc': 'Oldest',
          'selector.common.sort.desc': 'Newest',
          'selector.common.sort_label': 'Sort',
          'selector.common.unpin': 'Unpin'
        })[key] ?? key
    })
  }
})

import { AgentSelectorV2, type AgentSelectorV2Item } from '../AgentSelectorV2'

const AGENTS_RESPONSE = {
  items: [
    {
      id: 'agent-alpha',
      type: 'claude-code',
      name: 'Alpha Agent',
      description: 'First test agent',
      accessiblePaths: [],
      model: 'claude-3-5-sonnet',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    {
      id: 'agent-beta',
      type: 'claude-code',
      name: 'Beta Agent',
      description: 'Second test agent',
      accessiblePaths: [],
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
  render(<AgentSelectorV2 trigger={<button type="button">Open</button>} value={null} onChange={onChange} />)
  return { onChange }
}

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
}

describe('AgentSelectorV2', () => {
  it('fetches agents from DataApi and renders returned rows', () => {
    renderSelector()
    openPopover()

    expect(useQueryMock).toHaveBeenCalledWith('/agents', { query: { limit: 500 } })
    expect(screen.getByRole('option', { name: /Alpha Agent/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Beta Agent/ })).toBeInTheDocument()
  })

  it('fires onChange with the selected agent id', () => {
    const { onChange } = renderSelector()
    openPopover()

    fireEvent.click(screen.getByText('Beta Agent'))

    expect(onChange).toHaveBeenCalledWith('agent-beta')
  })

  it('fires onChange with the selected agent item when selectionType is item', () => {
    const onChange = vi.fn<(value: AgentSelectorV2Item | null) => void>()
    render(
      <AgentSelectorV2
        trigger={<button type="button">Open</button>}
        selectionType="item"
        value={null}
        onChange={onChange}
      />
    )
    openPopover()

    fireEvent.click(screen.getByText('Alpha Agent'))

    expect(onChange).toHaveBeenCalledWith({
      id: 'agent-alpha',
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
      pinnedIds: ['agent-alpha'],
      refetch: refetchPinsMock,
      togglePin: togglePinMock
    })

    renderSelector()
    openPopover()

    expect(usePinsMock).toHaveBeenCalledWith('agent')
    expect(screen.getByText('Pinned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }))
    expect(togglePinMock).toHaveBeenCalledWith('agent-alpha')
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
