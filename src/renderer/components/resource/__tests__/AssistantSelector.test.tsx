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
  updateAssistantMock,
  useMutationMock,
  usePinsMock,
  useQueryMock
} = vi.hoisted(() => ({
  createAssistantMock: vi.fn(),
  refetchAssistantsMock: vi.fn(),
  refetchPinsMock: vi.fn(),
  togglePinMock: vi.fn(),
  updateAssistantMock: vi.fn(),
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
          'assistants.edit.title': 'Edit assistant',
          'library.config.basic.field.description.hint': 'Short assistant summary.',
          'library.config.basic.field.description.placeholder': 'Describe this assistant',
          'library.config.basic.field.model.hint': 'Default chat model.',
          'library.config.basic.field.name.hint': 'Shown in the selector.',
          'library.config.basic.field.name.placeholder': 'Name this assistant',
          'library.config.basic.field.tags.hint': 'Group related assistants.',
          'library.config.basic.model_clear': 'Clear',
          'library.config.basic.model_pick': 'Pick model',
          'library.config.basic.model_not_found': 'Model {{id}} is unavailable.',
          'library.config.basic.tag_empty': 'No tags',
          'library.config.basic.tag_placeholder': 'Select tags',
          'library.config.basic.tag_search': 'Search tags',
          'library.config.prompt.label': 'Prompt',
          'library.config.prompt.placeholder': 'Tell this assistant how to respond',
          'selector.assistant.create_new': 'Create assistant',
          'selector.assistant.empty_text': 'No assistants yet. Create one first.',
          'selector.assistant.multi_hint': 'Select multiple assistants',
          'selector.assistant.multi_label': 'Multiple',
          'selector.assistant.search_placeholder': 'Search assistants',
          'selector.common.pin': 'Pin',
          'selector.common.pinned_title': 'Pinned',
          'selector.common.unpin': 'Unpin',
          'library.config.dialogs.create.assistant_title': 'New Assistant',
          'library.config.dialogs.create.avatar_aria': 'Pick avatar',
          'library.config.dialogs.create.dialog_description': 'Create a lightweight resource from the selector.',
          'library.config.dialogs.create.description_placeholder': 'Describe this resource',
          'library.config.dialogs.create.model_placeholder': 'Select a model',
          'library.config.dialogs.create.model_required': 'Please select a model',
          'library.config.dialogs.create.name_placeholder': 'Name this resource',
          'library.config.dialogs.create.name_required': 'Please enter a name',
          'library.config.dialogs.create.submit': 'Create',
          'library.config.dialogs.create.submit_failed': 'Create failed',
          'library.config.dialogs.edit.assistant_description': 'Edit the essentials for this assistant.',
          'library.config.dialogs.edit.assistant_title': 'Edit Assistant',
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

import { AssistantSelector } from '../AssistantSelector'

const ALPHA_ASSISTANT_ID = '11111111-1111-4111-8111-111111111111'
const BETA_ASSISTANT_ID = '22222222-2222-4222-8222-222222222222'
const TAG_TIMESTAMP = '2024-01-01T00:00:00.000Z'

const ASSISTANTS_RESPONSE = {
  items: [
    {
      id: ALPHA_ASSISTANT_ID,
      name: 'Alpha Assistant',
      prompt: 'Original alpha prompt',
      emoji: 'A',
      description: 'First test assistant',
      settings: {
        temperature: 1,
        enableTemperature: false,
        topP: 1,
        enableTopP: false,
        maxTokens: 4096,
        enableMaxTokens: false,
        streamOutput: true,
        reasoning_effort: 'default',
        mcpMode: 'auto',
        maxToolCalls: 20,
        enableMaxToolCalls: true,
        enableWebSearch: false,
        customParameters: []
      },
      modelId: 'provider::old-model',
      orderKey: 'a0',
      mcpServerIds: [],
      knowledgeBaseIds: [],
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
      ],
      modelName: 'Old Model'
    },
    {
      id: BETA_ASSISTANT_ID,
      name: 'Beta Assistant',
      prompt: 'Original beta prompt',
      emoji: 'B',
      description: 'Second test assistant',
      settings: {
        temperature: 1,
        enableTemperature: false,
        topP: 1,
        enableTopP: false,
        maxTokens: 4096,
        enableMaxTokens: false,
        streamOutput: true,
        reasoning_effort: 'default',
        mcpMode: 'auto',
        maxToolCalls: 20,
        enableMaxToolCalls: true,
        enableWebSearch: false,
        customParameters: []
      },
      modelId: 'provider::old-model',
      orderKey: 'a1',
      mcpServerIds: [],
      knowledgeBaseIds: [],
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
      ],
      modelName: 'Old Model'
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
    data: ASSISTANTS_RESPONSE,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch: refetchAssistantsMock,
    mutate: vi.fn()
  })
  useMutationMock.mockImplementation((method: string, path: string) => {
    if (method === 'PATCH' && path.startsWith('/assistants/')) {
      return {
        trigger: updateAssistantMock,
        isLoading: false,
        error: undefined
      }
    }
    return {
      trigger: createAssistantMock,
      isLoading: false,
      error: undefined
    }
  })
  createAssistantMock.mockResolvedValue({
    id: 'created-assistant',
    name: 'Created Assistant',
    emoji: '💬',
    description: 'Created from selector',
    tags: []
  })
  updateAssistantMock.mockResolvedValue({
    ...ASSISTANTS_RESPONSE.items[0],
    name: 'Renamed Assistant'
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
  render(
    <AssistantSelector trigger={<button type="button">Open</button>} multi={false} value={null} onChange={vi.fn()} />
  )
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
  it('sets the default popover target height', () => {
    renderSelector()
    openPopover()

    expect(document.querySelector('[data-selector-shell-content]')).toHaveStyle({
      height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px`
    })
  })

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

  it('renders the empty state prompt when no assistants exist', () => {
    useQueryMock.mockReturnValue({
      data: { items: [], total: 0, page: 1 },
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: refetchAssistantsMock,
      mutate: vi.fn()
    })

    renderSelector()
    openPopover()

    expect(screen.getByText('No assistants yet. Create one first.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create assistant' })).toBeInTheDocument()
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

  it('creates an assistant, refreshes, reopens the selector, and does not auto-select by default', async () => {
    const onChange = vi.fn()
    render(
      <AssistantSelector trigger={<button type="button">Open</button>} multi={false} value={null} onChange={onChange} />
    )
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

  it('auto-selects the created assistant when enabled', async () => {
    const onChange = vi.fn()
    render(
      <AssistantSelector
        trigger={<button type="button">Open</button>}
        multi={false}
        value={null}
        onChange={onChange}
        autoSelectOnCreate
      />
    )
    await openCreateDialog()

    fireEvent.change(screen.getByPlaceholderText('Name this resource'), { target: { value: 'Created Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(refetchAssistantsMock).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenCalledWith('created-assistant')
  })

  it('keeps the selector closed after editing an assistant from a row action', async () => {
    renderSelector()
    openPopover()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit assistant' })[0])

    expect(await screen.findByRole('heading', { name: 'Edit Assistant' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAssistantMock).toHaveBeenCalled())
    await waitFor(() => expect(refetchAssistantsMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByPlaceholderText('Search assistants')).not.toBeInTheDocument()
  })

  it('notifies when created assistant cannot be refreshed into the selector', async () => {
    refetchAssistantsMock.mockRejectedValueOnce(new Error('Refresh failed'))
    renderSelector()
    await openCreateDialog()

    fireEvent.change(screen.getByPlaceholderText('Name this resource'), { target: { value: 'Created Assistant' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pick model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(refetchAssistantsMock).toHaveBeenCalledTimes(1))

    expect(toastErrorMock).toHaveBeenCalledWith('Created, but refresh failed')
    await waitFor(() => expect(screen.getByPlaceholderText('Search assistants')).toBeInTheDocument())
  })
})
