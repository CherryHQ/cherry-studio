import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  it('defaults to the combined view and toggles the 助手库-only filter', () => {
    const assistants = [{ id: 'a1', name: 'My Assistant' }] as any

    render(<AssistantConversationPickerDialog open onOpenChange={vi.fn()} assistants={assistants} onSelect={vi.fn()} />)

    // Default: neither filter selected → combined 资源库 + 助手库 list, create row present, paging on.
    expect(mocks.pickerProps.items).toHaveLength(2)
    expect(mocks.pickerProps.createAction).toBeTruthy()
    expect(mocks.pickerProps.pageSize).toBe(50)

    // Filter to 助手库 (catalog only) → presets only, create row dropped.
    fireEvent.click(screen.getByText('assistants.presets.title'))
    expect(mocks.pickerProps.items).toHaveLength(1)
    expect(mocks.pickerProps.items[0].id).toBe('catalog:preset-1')
    expect(mocks.pickerProps.createAction).toBeUndefined()

    // Re-click clears the filter → back to the combined list with the create row.
    fireEvent.click(screen.getByText('assistants.presets.title'))
    expect(mocks.pickerProps.items).toHaveLength(2)
    expect(mocks.pickerProps.createAction).toBeTruthy()

    // Filter to 资源库 (mine only) → assistants only.
    fireEvent.click(screen.getByText('library.title'))
    expect(mocks.pickerProps.items).toHaveLength(1)
    expect(mocks.pickerProps.items[0].id).toBe('assistant:a1')
  })
})
