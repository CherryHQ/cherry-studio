import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createAssistantMock,
  refetchAssistantsMock,
  refetchPinsMock,
  togglePinMock,
  useMutationMock,
  usePinsMock,
  useQueryMock
} = vi.hoisted(() => ({
  createAssistantMock: vi.fn(),
  refetchAssistantsMock: vi.fn(),
  refetchPinsMock: vi.fn(),
  togglePinMock: vi.fn(),
  useMutationMock: vi.fn(),
  usePinsMock: vi.fn(),
  useQueryMock: vi.fn()
}))

const MODEL = vi.hoisted(
  () =>
    ({
      id: 'provider::chat-model',
      providerId: 'provider',
      name: 'Chat Model',
      capabilities: [],
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
          'selector.assistant.create_new': 'Create assistant',
          'selector.assistant.empty_text': 'No assistants',
          'selector.assistant.multi_hint': 'Select multiple assistants',
          'selector.assistant.multi_label': 'Multiple',
          'selector.assistant.search_placeholder': 'Search assistants',
          'selector.common.pin': 'Pin',
          'selector.common.pinned_title': 'Pinned',
          'selector.common.unpin': 'Unpin',
          'selector.create_dialog.avatar_aria': 'Pick avatar',
          'selector.create_dialog.assistant_title': 'New Assistant',
          'selector.create_dialog.create': 'Create',
          'selector.create_dialog.dialog_description': 'Create a lightweight resource from the selector.',
          'selector.create_dialog.description_placeholder': 'Describe this resource',
          'selector.create_dialog.model_placeholder': 'Select a model',
          'selector.create_dialog.model_required': 'Please select a model',
          'selector.create_dialog.name_placeholder': 'Name this resource',
          'selector.create_dialog.name_required': 'Please enter a name',
          'selector.create_dialog.submit_failed': 'Create failed'
        })[key] ?? key
    })
  }
})

import { AssistantSelector } from '../resource/AssistantSelector'

const ALPHA_ASSISTANT_ID = '11111111-1111-4111-8111-111111111111'
const BETA_ASSISTANT_ID = '22222222-2222-4222-8222-222222222222'
const TAG_TIMESTAMP = '2024-01-01T00:00:00.000Z'

const ASSISTANTS_RESPONSE = {
  items: [
    {
      id: ALPHA_ASSISTANT_ID,
      name: 'Alpha Assistant',
      emoji: 'A',
      description: 'First test assistant',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      tags: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'work',
          color: '#8b5cf6',
          createdAt: TAG_TIMESTAMP,
          updatedAt: TAG_TIMESTAMP
        }
      ]
    },
    {
      id: BETA_ASSISTANT_ID,
      name: 'Beta Assistant',
      emoji: 'B',
      description: 'Second test assistant',
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      tags: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'personal',
          color: '#10b981',
          createdAt: TAG_TIMESTAMP,
          updatedAt: TAG_TIMESTAMP
        }
      ]
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
    refetch: refetchAssistantsMock,
    mutate: vi.fn()
  })
  useMutationMock.mockReturnValue({
    trigger: createAssistantMock,
    isLoading: false,
    error: undefined
  })
  createAssistantMock.mockResolvedValue({
    id: 'created-assistant',
    name: 'Created Assistant',
    emoji: '💬',
    description: 'Created from selector',
    tags: []
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

async function openCreateDialog() {
  openPopover()
  fireEvent.click(screen.getByRole('button', { name: 'Create assistant' }))
  await screen.findByRole('dialog')
}

describe('AssistantSelector', () => {
  it('renders rows in DataApi order and shows tag filters without sort controls', () => {
    renderSelector()
    openPopover()

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Alpha Assistant')
    expect(options[1]).toHaveTextContent('Beta Assistant')
    expect(screen.getByRole('button', { name: 'work' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Newest' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Oldest' })).not.toBeInTheDocument()
  })

  it('renders assistant tag chips and filters rows by selected tag', () => {
    renderSelector()
    openPopover()

    fireEvent.click(screen.getByRole('button', { name: 'work' }))

    expect(screen.getByRole('option', { name: /Alpha Assistant/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Beta Assistant/ })).not.toBeInTheDocument()
  })

  it('opens the lightweight create dialog from the create action', async () => {
    renderSelector()
    await openCreateDialog()

    expect(screen.getByRole('heading', { name: 'New Assistant' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Name this resource')).toBeInTheDocument()
    expect(screen.getByText('Select a model')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Describe this resource')).toBeInTheDocument()
  })

  it('creates an assistant, refreshes, reopens the selector, and does not auto-select', async () => {
    const onChange = vi.fn()
    render(<AssistantSelector trigger={<button type="button">Open</button>} value={null} onChange={onChange} />)
    await openCreateDialog()

    fireEvent.change(screen.getByPlaceholderText('Name this resource'), { target: { value: 'Created Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.change(screen.getByPlaceholderText('Describe this resource'), {
      target: { value: 'Created from selector' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(createAssistantMock).toHaveBeenCalledWith({
        body: {
          name: 'Created Assistant',
          emoji: '💬',
          modelId: MODEL.id,
          description: 'Created from selector'
        }
      })
    )
    await waitFor(() => expect(refetchAssistantsMock).toHaveBeenCalledTimes(1))
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByPlaceholderText('Search assistants')).toBeInTheDocument())
  })
})
