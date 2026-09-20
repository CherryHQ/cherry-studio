import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

// Use the real Popover/MenuList/MenuItem (renderer.setup stubs them globally) so the filter
// popover actually opens/closes.
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

const mocks = vi.hoisted(() => ({
  createAssistant: vi.fn(),
  createFromPreset: vi.fn(),
  refetchCreationDependencies: vi.fn(),
  creationDependencies: {
    error: undefined as Error | undefined,
    isLoading: false
  },
  pickerProps: undefined as any,
  createDialogProps: undefined as any
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))

vi.mock('@renderer/components/resourceCatalog/selectors', () => ({
  ConversationPickerDialog: (props: any) => {
    mocks.pickerProps = props
    return (
      <div data-testid="picker" data-open={String(props.open)} data-loading={String(props.isLoading)}>
        {props.toolbar}
        {props.notice}
        <button type="button" onClick={() => props.onOpenChange(false)}>
          dismiss-picker
        </button>
        <span data-testid="create-action-icon">{props.createAction?.row('').icon}</span>
        <button type="button" onClick={() => props.createAction?.onSelect('')}>
          create-new
        </button>
        <button type="button" onClick={() => props.createAction?.onSelect('测试助手')}>
          create-new-from-query
        </button>
        <button
          type="button"
          onClick={() => props.onSelect(props.items.find((item: any) => item.id.startsWith('assistant:')))}>
          select-assistant
        </button>
        <button
          type="button"
          onClick={() => props.onSelect(props.items.find((item: any) => item.id.startsWith('catalog:')))}>
          select-catalog
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/create', () => ({
  getResourceCreateDefaultAvatar: () => '💬',
  ResourceCreateWizard: (props: any) => {
    mocks.createDialogProps = props
    return (
      <div data-testid="create-dialog" data-open={String(props.open)} data-kind={props.kind}>
        <button
          type="button"
          onClick={() =>
            props.onSubmit({
              avatar: '🤖',
              name: 'New',
              modelId: 'p::m',
              description: 'desc',
              prompt: 'Use the knowledge base',
              knowledgeBaseIds: ['kb-1'],
              skillIds: []
            })
          }>
          submit-create
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: () => ({ trigger: mocks.createAssistant, isLoading: false })
}))

vi.mock('@renderer/hooks/useAssistantCatalogPresets', () => ({
  useAssistantCatalogPresets: () => ({
    presets: [{ id: 'preset-1', name: 'Claude', officialVendor: 'anthropic' }],
    isLoading: false
  })
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAssistantPresetCreation: () => ({
    createFromPreset: mocks.createFromPreset,
    error: mocks.creationDependencies.error,
    isLoading: mocks.creationDependencies.isLoading,
    refetch: mocks.refetchCreationDependencies
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { AssistantConversationPickerDialog } from '../AssistantConversationPickerDialog'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // Radix Popover needs these in jsdom to open.
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {}
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.pickerProps = undefined
  mocks.createDialogProps = undefined
})

beforeEach(() => {
  mocks.creationDependencies.error = undefined
  mocks.creationDependencies.isLoading = false
  mocks.createFromPreset.mockResolvedValue({
    status: 'created',
    assistant: { id: 'assistant-from-preset', name: 'Claude' }
  })
  mocks.refetchCreationDependencies.mockResolvedValue(undefined)
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('AssistantConversationPickerDialog', () => {
  it('exposes a create action that closes the picker and opens the assistant create dialog', () => {
    const onOpenChange = vi.fn()

    render(<AssistantConversationPickerDialog open onOpenChange={onOpenChange} assistants={[]} onSelect={vi.fn()} />)

    expect(mocks.pickerProps.createAction.row('').title).toBe('selector.assistant.create_new')
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByText('create-new'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-kind', 'assistant')
    expect(mocks.createDialogProps.initialName).toBe('')
  })

  it('names the create row after the search query and seeds it into the create dialog', () => {
    render(<AssistantConversationPickerDialog open onOpenChange={vi.fn()} assistants={[]} onSelect={vi.fn()} />)

    // The row that used to disappear while searching now previews the assistant it would create.
    const namedRow = mocks.pickerProps.createAction.row('测试助手')
    expect(namedRow.title).toBe('测试助手')
    expect(namedRow.tag).toBe('selector.assistant.create_tag')
    expect(namedRow.icon).toBeTruthy()

    fireEvent.click(screen.getByText('create-new-from-query'))

    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(mocks.createDialogProps.initialName).toBe('测试助手')
  })

  it('creates the assistant and starts a conversation with it on submit', async () => {
    mocks.createAssistant.mockResolvedValue({ id: 'assistant-new' })
    const onSelect = vi.fn()

    render(<AssistantConversationPickerDialog open onOpenChange={vi.fn()} assistants={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('create-new'))
    fireEvent.click(screen.getByText('submit-create'))

    await waitFor(() =>
      expect(mocks.createAssistant).toHaveBeenCalledWith({
        body: {
          name: 'New',
          emoji: '🤖',
          modelId: 'p::m',
          description: 'desc',
          prompt: 'Use the knowledge base',
          knowledgeBaseIds: ['kb-1']
        }
      })
    )
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'assistant', assistantId: 'assistant-new' }))
  })

  it('keeps the create dialog open and does not select when assistant creation fails', async () => {
    mocks.createAssistant.mockRejectedValue(new Error('create failed'))
    const onSelect = vi.fn()

    render(<AssistantConversationPickerDialog open onOpenChange={vi.fn()} assistants={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('create-new'))
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')

    // Submit re-throws so the wizard can surface the error; call it directly to capture the rejection.
    await expect(
      mocks.createDialogProps.onSubmit({
        avatar: '🤖',
        name: 'New',
        modelId: 'p::m',
        description: 'desc',
        prompt: '',
        knowledgeBaseIds: [],
        skillIds: []
      })
    ).rejects.toThrow('create failed')

    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('materializes a catalog preset before forwarding the persisted assistant', async () => {
    const onSelect = vi.fn()
    render(<AssistantConversationPickerDialog open onOpenChange={vi.fn()} assistants={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('select-catalog'))

    await waitFor(() =>
      expect(mocks.createFromPreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Claude' }))
    )
    expect(onSelect).toHaveBeenCalledWith({ type: 'assistant', assistantId: 'assistant-from-preset' })
  })

  it('keeps the picker open with inline guidance when the vendor is unavailable', async () => {
    mocks.createFromPreset.mockResolvedValueOnce({ status: 'configuration-required', providerId: 'anthropic' })
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()
    render(<AssistantConversationPickerDialog open onOpenChange={onOpenChange} assistants={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('select-catalog'))

    expect(await screen.findByText('library.assistant_catalog.provider_required_title')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('blocks competing picker actions until preset creation settles', async () => {
    const user = userEvent.setup()
    const creation = createDeferred<{
      status: 'created'
      assistant: { id: string; name: string }
    }>()
    mocks.createFromPreset.mockReturnValueOnce(creation.promise)
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    render(
      <AssistantConversationPickerDialog
        open
        onOpenChange={onOpenChange}
        assistants={[{ id: 'mine', name: 'Mine' }] as any}
        onSelect={onSelect}
      />
    )

    await user.click(screen.getByText('select-catalog'))
    await waitFor(() => expect(screen.getByTestId('picker')).toHaveAttribute('data-loading', 'true'))

    await user.click(screen.getByText('dismiss-picker'))
    await user.click(screen.getByText('select-assistant'))
    await user.click(screen.getByText('create-new'))

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'false')
    expect(screen.getByRole('button', { name: 'selector.assistant.filter' })).toBeDisabled()

    creation.resolve({ status: 'created', assistant: { id: 'created', name: 'Created' } })
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'assistant', assistantId: 'created' }))
    await waitFor(() => expect(screen.getByTestId('picker')).toHaveAttribute('data-loading', 'false'))

    await user.click(screen.getByText('select-assistant'))
    await user.click(screen.getByText('dismiss-picker'))
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'assistant', assistantId: 'mine' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows dependency errors without provider guidance and retries loading them', async () => {
    const user = userEvent.setup()
    mocks.creationDependencies.error = new Error('Could not load providers')
    mocks.creationDependencies.isLoading = true

    render(<AssistantConversationPickerDialog open onOpenChange={vi.fn()} assistants={[]} onSelect={vi.fn()} />)

    expect(screen.getByText('common.error')).toBeInTheDocument()
    expect(screen.getByText('Could not load providers')).toBeInTheDocument()
    expect(screen.queryByText('library.assistant_catalog.provider_required_title')).not.toBeInTheDocument()
    expect(screen.getByTestId('picker')).toHaveAttribute('data-loading', 'false')

    await user.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(mocks.refetchCreationDependencies).toHaveBeenCalledTimes(1)
  })

  it('defaults to the combined view and filters via the popover', async () => {
    const assistants = [{ id: 'a1', name: 'My Assistant' }] as any

    render(<AssistantConversationPickerDialog open onOpenChange={vi.fn()} assistants={assistants} onSelect={vi.fn()} />)

    // Default: no filter → combined 资源库 + 助手库 list, create row present, paging on.
    expect(mocks.pickerProps.items).toHaveLength(2)
    expect(mocks.pickerProps.createAction).toBeTruthy()
    expect(mocks.pickerProps.pageSize).toBe(50)

    const selectFilter = async (label: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'selector.assistant.filter' }))
      fireEvent.click(await screen.findByText(label))
    }

    // Filter to 助手库 (catalog only) → presets only, create row dropped.
    await selectFilter('assistants.presets.title')
    expect(mocks.pickerProps.items).toHaveLength(1)
    expect(mocks.pickerProps.items[0].id).toBe('catalog:preset-1')
    expect(mocks.pickerProps.createAction).toBeUndefined()

    // Back to 全部 → combined list with the create row.
    await selectFilter('common.all')
    expect(mocks.pickerProps.items).toHaveLength(2)
    expect(mocks.pickerProps.createAction).toBeTruthy()

    // Filter to 资源库 (mine only) → assistants only.
    await selectFilter('library.title')
    expect(mocks.pickerProps.items).toHaveLength(1)
    expect(mocks.pickerProps.items[0].id).toBe('assistant:a1')
  })
})
