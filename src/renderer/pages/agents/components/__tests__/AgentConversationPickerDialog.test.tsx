import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
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
      <div data-testid="picker" data-open={String(props.open)}>
        {props.toolbar}
        <button type="button" onClick={() => props.createAction?.onSelect('')}>
          create-new
        </button>
        <button type="button" onClick={() => props.onSelect(props.items[0])}>
          select-first
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/components/resourceCatalog/dialogs/create', () => ({
  getResourceCreateDefaultAvatar: () => '🤖',
  ResourceCreateWizard: (props: any) => {
    mocks.createDialogProps = props
    return (
      <div data-testid="create-dialog" data-open={String(props.open)} data-kind={props.kind}>
        <button
          type="button"
          onClick={() =>
            props.onSubmit({
              avatar: '🤖',
              name: 'New Agent',
              modelId: 'p::m',
              description: '',
              prompt: '',
              knowledgeBaseIds: [],
              skillIds: [],
              agentType: 'claude-code',
              permissionMode: 'auto'
            })
          }>
          submit-create
        </button>
      </div>
    )
  }
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  useAgentMutations: () => ({ createAgent: mocks.createAgent, isCreatingAgent: false })
}))

vi.mock('@renderer/hooks/useAssistantCatalogPresets', () => ({
  useAssistantCatalogPresets: () => ({ presets: [{ id: 'preset-1', name: 'Preset One' }], isLoading: false })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import {
  AgentConversationPickerDialog,
  resolveAgentIdFromConversationSelection
} from '../AgentConversationPickerDialog'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
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

describe('AgentConversationPickerDialog', () => {
  it('opens the agent create wizard from the create row', () => {
    const onOpenChange = vi.fn()

    render(<AgentConversationPickerDialog open onOpenChange={onOpenChange} agents={[]} onSelect={vi.fn()} />)

    fireEvent.click(screen.getByText('create-new'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('create-dialog')).toHaveAttribute('data-kind', 'agent')
  })

  it('creates an agent and selects it on wizard submit', async () => {
    mocks.createAgent.mockResolvedValue({ id: 'agent-new' })
    const onSelect = vi.fn()

    render(<AgentConversationPickerDialog open onOpenChange={vi.fn()} agents={[]} onSelect={onSelect} />)

    fireEvent.click(screen.getByText('create-new'))
    fireEvent.click(screen.getByText('submit-create'))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'agent', agentId: 'agent-new' }))
  })

  it('defaults to the combined agents and preset catalog list', () => {
    const agents = [{ id: 'a1', name: 'My Agent', configuration: {} }] as any

    render(<AgentConversationPickerDialog open onOpenChange={vi.fn()} agents={agents} onSelect={vi.fn()} />)

    expect(mocks.pickerProps.items).toHaveLength(2)
    expect(mocks.pickerProps.createAction).toBeTruthy()
    expect(mocks.pickerProps.pageSize).toBe(50)
  })
})

describe('resolveAgentIdFromConversationSelection', () => {
  it('reuses an existing agent with the same name as the preset', async () => {
    const agents = [{ id: 'existing', name: 'Preset One' }] as any
    const createAgent = vi.fn()

    const id = await resolveAgentIdFromConversationSelection(
      { type: 'catalog', preset: { id: 'preset-1', name: 'Preset One' } },
      agents,
      { defaultModelId: 'openai::gpt-4o', createAgent }
    )

    expect(id).toBe('existing')
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('returns null when a preset has no resolvable model', async () => {
    const onMissingModel = vi.fn()
    const id = await resolveAgentIdFromConversationSelection(
      { type: 'catalog', preset: { id: 'preset-1', name: 'New Preset' } },
      [],
      { defaultModelId: null, createAgent: vi.fn(), onMissingModel }
    )

    expect(id).toBeNull()
    expect(onMissingModel).toHaveBeenCalled()
  })

  it('waits for model context before materializing a catalog preset', async () => {
    const onPresetModelContextLoading = vi.fn()
    const createAgent = vi.fn()

    const id = await resolveAgentIdFromConversationSelection(
      { type: 'catalog', preset: { id: 'preset-1', name: 'New Preset' } },
      [],
      {
        defaultModelId: 'openai::gpt-4o',
        createAgent,
        isPresetModelContextReady: false,
        onPresetModelContextLoading
      }
    )

    expect(id).toBeNull()
    expect(onPresetModelContextLoading).toHaveBeenCalled()
    expect(createAgent).not.toHaveBeenCalled()
  })
})
