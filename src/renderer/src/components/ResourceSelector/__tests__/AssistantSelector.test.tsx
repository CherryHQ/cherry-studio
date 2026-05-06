import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { openTabMock, refetchPinsMock, togglePinMock, usePinsMock, useQueryMock } = vi.hoisted(() => ({
  openTabMock: vi.fn(),
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

vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({
    openTab: openTabMock
  })
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) =>
        ({
          'selector.assistant.create_new': 'Create assistant',
          'selector.assistant.empty_text': 'No assistants',
          'selector.assistant.multi_hint': 'Select multiple assistants',
          'selector.assistant.multi_label': 'Multiple',
          'selector.assistant.search_placeholder': 'Search assistants',
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

import { AssistantSelector } from '../AssistantSelector'

const ALPHA_ASSISTANT_ID = '11111111-1111-4111-8111-111111111111'
const BETA_ASSISTANT_ID = '22222222-2222-4222-8222-222222222222'

const ASSISTANTS_RESPONSE = {
  items: [
    {
      id: ALPHA_ASSISTANT_ID,
      name: 'Alpha Assistant',
      emoji: 'A',
      description: 'First test assistant',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z'
    },
    {
      id: BETA_ASSISTANT_ID,
      name: 'Beta Assistant',
      emoji: 'B',
      description: 'Second test assistant',
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
    data: ASSISTANTS_RESPONSE,
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

function renderSelector() {
  render(<AssistantSelector trigger={<button type="button">Open</button>} value={null} onChange={vi.fn()} />)
}

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
}

describe('AssistantSelector library navigation', () => {
  it('navigates to the resource library assistant editor from the row edit action', async () => {
    renderSelector()
    openPopover()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])

    await waitFor(() =>
      expect(openTabMock).toHaveBeenCalledWith(
        `/app/library?resourceType=assistant&action=edit&id=${BETA_ASSISTANT_ID}`,
        { forceNew: true }
      )
    )
  })

  it('navigates to the resource library assistant create flow from the footer action', async () => {
    renderSelector()
    openPopover()

    fireEvent.click(screen.getByRole('button', { name: 'Create assistant' }))

    await waitFor(() =>
      expect(openTabMock).toHaveBeenCalledWith('/app/library?resourceType=assistant&action=create', { forceNew: true })
    )
  })
})
