import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Use the real Popover/MenuList/MenuItem (renderer.setup stubs them globally) so the filter
// popover actually opens/closes.
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

const mocks = vi.hoisted(() => ({
  createAssistant: vi.fn(),
  pickerProps: undefined as any,
  createDialogProps: undefined as any
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }
}))

vi.mock('@renderer/components/EmojiIcon', () => ({ default: () => null }))

vi.mock('@renderer/components/resource', () => ({
  ConversationPickerDialog: (props: any) => {
    mocks.pickerProps = props
    return (
      <div data-testid="picker" data-open={String(props.open)}>
        {props.toolbar}
        <span data-testid="create-action-icon">{props.createAction?.icon}</span>
        <button type="button" onClick={() => props.createAction?.onSelect()}>
          create-new
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/components/resource/dialogs/ResourceCreateDialog', () => ({
  ResourceCreateDialog: (props: any) => {
    mocks.createDialogProps = props
    return (
      <div data-testid="create-dialog" data-open={String(props.open)} data-kind={props.kind}>
        <button
          type="button"
          onClick={() => props.onSubmit({ avatar: '🤖', name: 'New', modelId: 'p::m', description: 'desc' })}>
          submit-create
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/components/resource/dialogs/form/assistantModelFilter', () => ({
  isSelectableAssistantModel: () => true
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: () => ({ trigger: mocks.createAssistant, isLoading: false })
}))

vi.mock('@renderer/hooks/useAssistantCatalogPresets', () => ({
  useAssistantCatalogPresets: () => ({ presets: [{ id: 'preset-1', name: 'Preset One' }], isLoading: false })
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { AssistantConversationPickerDialog } from '../AssistantConversationPickerDialog'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
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

describe('AssistantConversationPickerDialog', () => {
  it('exposes a create action that closes the picker and opens the assistant create dialog', () => {
    const onOpenChange = vi.fn()

    render(<AssistantConversationPickerDialog open onOpenChange={onOpenChange} assistants={[]} onSelect={vi.fn()} />)

    expect(mocks.pickerProps.createAction.label).toBe('selector.assistant.create_new')
    expect(screen.getByTestId('create-action-icon').querySelector('svg')).toHaveClass('lucide-message-square-plus')
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByText('create-new'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-kind', 'assistant')
  })

  it('creates the assistant and starts a conversation with it on submit', async () => {
    mocks.createAssistant.mockResolvedValue({ id: 'assistant-new' })
    const onSelect = vi.fn()

    render(<AssistantConversationPickerDialog open onOpenChange={vi.fn()} assistants={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('create-new'))
    fireEvent.click(screen.getByText('submit-create'))

    await waitFor(() =>
      expect(mocks.createAssistant).toHaveBeenCalledWith({
        body: { name: 'New', emoji: '🤖', modelId: 'p::m', description: 'desc' }
      })
    )
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'assistant', assistantId: 'assistant-new' }))
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
