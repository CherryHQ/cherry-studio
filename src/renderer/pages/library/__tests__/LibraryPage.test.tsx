import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RESOURCE_TYPE_ORDER } from '../constants'
import LibraryPage from '../LibraryPage'

const {
  allResourcesMock,
  assistantCatalogMock,
  createAgentMock,
  createAssistantMock,
  createPromptMock,
  duplicateAssistantMock,
  navigateMock,
  openTabMock,
  refetchSpy,
  resourceLibraryOptionsMock,
  toastErrorMock,
  toastSuccessMock,
  updatePromptMock
} = vi.hoisted(() => ({
  allResourcesMock: [] as any[],
  assistantCatalogMock: {
    tabs: [{ id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 }] as Array<{
      id: string
      label: string
      count: number
    }>,
    presets: [] as any[]
  },
  createAgentMock: vi.fn(),
  createAssistantMock: vi.fn(),
  createPromptMock: vi.fn(),
  duplicateAssistantMock: vi.fn(),
  navigateMock: vi.fn(),
  openTabMock: vi.fn(),
  refetchSpy: vi.fn(),
  resourceLibraryOptionsMock: [] as any[],
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  updatePromptMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  }
}))

vi.mock('../adapters/assistantAdapter', () => ({
  useAssistantMutations: () => ({
    createAssistant: createAssistantMock,
    duplicateAssistant: duplicateAssistantMock
  })
}))

vi.mock('../adapters/agentAdapter', () => ({
  useAgentMutations: () => ({
    createAgent: createAgentMock
  })
}))

vi.mock('@renderer/hooks/agents/useAgentModelFilter', () => ({
  useAgentModelFilter: () => vi.fn(() => true)
}))

vi.mock('../adapters/promptAdapter', () => ({
  usePromptMutations: () => ({
    createPrompt: createPromptMock
  }),
  usePromptMutationsById: () => ({
    updatePrompt: updatePromptMock
  })
}))

vi.mock('@renderer/hooks/useTags', () => ({
  useEnsureTags: () => ({
    ensureTags: vi.fn()
  }),
  useTagList: () => ({
    tags: []
  })
}))

vi.mock('@renderer/context/TabsContext', () => ({
  useOptionalTabsContext: () => ({
    openTab: openTabMock
  })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('../list/useAssistantPresetCatalog', () => ({
  ASSISTANT_CATALOG_MY_TAB: '__mine__',
  getAssistantPresetCatalogKey: (preset: { id: string }) => preset.id,
  toCreateAssistantDtoFromCatalogPreset: (preset: { name: string }) => ({
    name: preset.name
  }),
  useAssistantPresetCatalog: () => assistantCatalogMock
}))

vi.mock('../list/useResourceLibrary', () => ({
  useResourceLibrary: (options: unknown) => {
    resourceLibraryOptionsMock.push(options)
    return {
      resources: allResourcesMock,
      allResources: allResourcesMock,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      typeCounts: {
        assistant: allResourcesMock.filter((resource) => resource.type === 'assistant').length,
        agent: allResourcesMock.filter((resource) => resource.type === 'agent').length,
        skill: allResourcesMock.filter((resource) => resource.type === 'skill').length,
        prompt: allResourcesMock.filter((resource) => resource.type === 'prompt').length
      },
      refetch: refetchSpy
    }
  }
}))

vi.mock('../list/LibrarySidebar', () => ({
  LibrarySidebar: ({ onFilterChange }: { onFilterChange: (filter: { resourceType: string }) => void }) => (
    <div data-testid="library-sidebar">
      <button type="button" onClick={() => onFilterChange({ resourceType: 'assistant' })}>
        select assistant type
      </button>
      <button type="button" onClick={() => onFilterChange({ resourceType: 'skill' })}>
        select skill type
      </button>
    </div>
  )
}))

vi.mock('../list/DeleteConfirmDialog', () => ({
  DeleteConfirmDialog: () => null
}))

vi.mock('../list/ImportAssistantDialog', () => ({
  ImportAssistantDialog: () => null
}))

vi.mock('../list/ImportSkillDialog', () => ({
  ImportSkillDialog: () => null
}))

vi.mock('../list/AssistantPresetPreviewDialog', () => ({
  AssistantPresetPreviewDialog: ({
    addedAssistantId,
    onAdd,
    onOpenChange,
    onOpenChat,
    open,
    preset
  }: {
    addedAssistantId?: string
    onAdd: () => Promise<void> | void
    onOpenChange: (open: boolean) => void
    onOpenChat: (assistantId: string) => void
    open: boolean
    preset: { id: string; name: string } | null
  }) =>
    open && preset ? (
      <div role="dialog" data-testid="assistant-preset-preview-dialog">
        <output data-testid="preview-added-assistant-id">{addedAssistantId ?? ''}</output>
        <button type="button" onClick={() => void onAdd()}>
          preview add preset
        </button>
        <button
          type="button"
          disabled={!addedAssistantId}
          onClick={() => {
            if (!addedAssistantId) return
            onOpenChat(addedAssistantId)
            onOpenChange(false)
          }}>
          preview go to chat
        </button>
      </div>
    ) : null
}))

vi.mock('@renderer/components/resource/dialogs/PromptEditDialog', () => ({
  default: ({
    open,
    prompt,
    onCancel,
    onSave
  }: {
    open: boolean
    prompt?: { id: string } | null
    onCancel: () => void
    onSave: (data: { title: string; content: string }) => Promise<void>
  }) =>
    open ? (
      <div role="dialog" data-testid={prompt ? 'prompt-edit-dialog' : 'prompt-create-dialog'}>
        <button type="button" onClick={() => void onSave({ title: 'Prompt title', content: 'Prompt content' })}>
          save prompt dialog
        </button>
        <button type="button" onClick={onCancel}>
          close prompt dialog
        </button>
      </div>
    ) : null
}))

vi.mock('@renderer/components/resource/dialogs', () => ({
  ResourceCreateDialog: ({
    kind,
    open,
    onSubmit,
    onOpenChange
  }: {
    kind: 'assistant' | 'agent'
    open: boolean
    onSubmit: (values: { avatar: string; name: string; modelId: string; description: string }) => Promise<void>
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div role="dialog" data-testid={`${kind}-create-dialog`}>
        <button
          type="button"
          onClick={() =>
            void onSubmit({
              avatar: kind === 'assistant' ? '💬' : '🤖',
              name: `${kind} name`,
              modelId: 'provider::model',
              description: `${kind} description`
            })
          }>
          finish {kind} create
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          close {kind} create
        </button>
      </div>
    ) : null,
  AgentEditDialog: ({
    open,
    resource,
    onSaved,
    onOpenChange
  }: {
    open: boolean
    resource: { id: string } | null
    onSaved: (resource: { id: string }) => Promise<void> | void
    onOpenChange: (open: boolean) => void
  }) =>
    resource ? (
      <div data-testid="agent-edit-dialog-host" data-open={open ? 'true' : 'false'}>
        {open ? (
          <div role="dialog" data-testid="agent-edit-dialog">
            <button type="button" onClick={() => void onSaved(resource)}>
              finish agent edit
            </button>
            <button type="button" onClick={() => onOpenChange(false)}>
              close agent edit
            </button>
          </div>
        ) : null}
      </div>
    ) : null,
  AssistantEditDialog: ({
    open,
    resource,
    onSaved,
    onOpenChange
  }: {
    open: boolean
    resource: { id: string } | null
    onSaved: (resource: { id: string }) => Promise<void> | void
    onOpenChange: (open: boolean) => void
  }) =>
    resource ? (
      <div data-testid="assistant-edit-dialog-host" data-open={open ? 'true' : 'false'}>
        {open ? (
          <div role="dialog" data-testid="assistant-edit-dialog">
            <button type="button" onClick={() => void onSaved(resource)}>
              finish assistant edit
            </button>
            <button type="button" onClick={() => onOpenChange(false)}>
              close assistant edit
            </button>
          </div>
        ) : null}
      </div>
    ) : null
}))

vi.mock('../detail/skill/SkillDetailDialog', () => ({
  default: ({
    skill,
    open,
    onOpenChange
  }: {
    skill: { name: string } | null
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open && skill ? (
      <div role="dialog" aria-label="skill-detail-dialog">
        <span>{skill.name}</span>
        <button type="button" onClick={() => onOpenChange(false)}>
          close skill detail
        </button>
      </div>
    ) : null
}))

vi.mock('../list/ResourceGrid', () => ({
  ResourceGrid: ({
    activeResourceType,
    assistantCatalog,
    onDuplicate,
    onEdit,
    onSearchChange,
    resources,
    search,
    onCreate
  }: {
    activeResourceType: 'assistant' | 'agent' | 'skill' | 'prompt'
    assistantCatalog?: {
      activeTab: string
      presets: any[]
      addedAssistantPresets: Record<string, string>
      onTabChange: (tabId: string) => void
      onAddPreset: (preset: any) => Promise<void> | void
      onOpenPresetChat: (assistantId: string) => void
      onPreviewPreset: (preset: any) => void
    }
    onDuplicate: (resource: any) => void
    onEdit: (resource: any) => void
    onSearchChange: (value: string) => void
    onCreate: (type: 'assistant' | 'agent' | 'skill' | 'prompt') => void
    resources: any[]
    search: string
  }) => (
    <div data-testid="resource-grid" data-resource-type={activeResourceType}>
      <div data-testid="assistant-catalog-active-tab">{assistantCatalog?.activeTab ?? ''}</div>
      <input aria-label="library search" value={search} onChange={(event) => onSearchChange(event.target.value)} />
      <button type="button" onClick={() => onCreate('assistant')}>
        create assistant
      </button>
      <button type="button" onClick={() => onCreate('agent')}>
        create agent
      </button>
      <button type="button" onClick={() => onCreate('prompt')}>
        create prompt
      </button>
      <button type="button" onClick={() => assistantCatalog?.onTabChange('custom')}>
        select custom tab
      </button>
      <button
        type="button"
        disabled={!assistantCatalog?.presets[0]}
        onClick={() => assistantCatalog?.onPreviewPreset(assistantCatalog.presets[0])}>
        preview catalog preset
      </button>
      <button
        type="button"
        disabled={!assistantCatalog?.presets[0]}
        onClick={() => void assistantCatalog?.onAddPreset(assistantCatalog.presets[0])}>
        add catalog preset
      </button>
      <output data-testid="added-assistant-id">{assistantCatalog?.addedAssistantPresets?.['preset-1'] ?? ''}</output>
      <button
        type="button"
        disabled={!assistantCatalog?.addedAssistantPresets?.['preset-1']}
        onClick={() => assistantCatalog?.onOpenPresetChat(assistantCatalog.addedAssistantPresets['preset-1'])}>
        go to catalog chat
      </button>
      <button type="button" disabled={!resources[0]} onClick={() => onDuplicate(resources[0])}>
        duplicate first
      </button>
      <button type="button" disabled={!resources[0]} onClick={() => onEdit(resources[0])}>
        open first
      </button>
    </div>
  )
}))

describe('LibraryPage create flow', () => {
  beforeEach(() => {
    allResourcesMock.length = 0
    assistantCatalogMock.tabs = [{ id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 }]
    assistantCatalogMock.presets = []
    createAgentMock.mockReset()
    createAgentMock.mockResolvedValue({ id: 'agent-created' })
    createAssistantMock.mockReset()
    createAssistantMock.mockResolvedValue({ id: 'assistant-created' })
    createPromptMock.mockReset()
    createPromptMock.mockResolvedValue({ id: 'prompt-created' })
    duplicateAssistantMock.mockReset()
    navigateMock.mockReset()
    openTabMock.mockReset()
    refetchSpy.mockReset()
    resourceLibraryOptionsMock.length = 0
    toastErrorMock.mockReset()
    toastSuccessMock.mockReset()
    updatePromptMock.mockReset()
    updatePromptMock.mockResolvedValue({ id: 'prompt-updated' })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: toastErrorMock,
        success: toastSuccessMock
      }
    })
  })

  it('uses the first sidebar resource type as the initial grid filter', () => {
    render(<LibraryPage />)

    expect(screen.getByTestId('resource-grid')).toHaveAttribute('data-resource-type', RESOURCE_TYPE_ORDER[0])
  })

  it('creates an assistant in a dialog while keeping the list visible', async () => {
    const user = userEvent.setup()

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'create assistant' }))
    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-create-dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'finish assistant create' }))

    await waitFor(() => {
      expect(screen.queryByTestId('assistant-create-dialog')).not.toBeInTheDocument()
    })
    expect(createAssistantMock).toHaveBeenCalledWith({
      name: 'assistant name',
      emoji: '💬',
      modelId: 'provider::model',
      description: 'assistant description'
    })
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  it('creates an agent in a dialog while keeping the list visible', async () => {
    const user = userEvent.setup()

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'create agent' }))
    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    expect(screen.getByTestId('agent-create-dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'finish agent create' }))

    await waitFor(() => {
      expect(screen.queryByTestId('agent-create-dialog')).not.toBeInTheDocument()
    })
    expect(createAgentMock).toHaveBeenCalledWith({
      type: 'claude-code',
      name: 'agent name',
      model: 'provider::model',
      planModel: 'provider::model',
      smallModel: 'provider::model',
      description: 'agent description',
      configuration: {
        avatar: '🤖',
        permission_mode: 'bypassPermissions',
        soul_enabled: true
      }
    })
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  it('creates a prompt in a dialog while keeping the list visible', async () => {
    const user = userEvent.setup()

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'create prompt' }))
    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-create-dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'save prompt dialog' }))

    await waitFor(() => {
      expect(screen.queryByTestId('prompt-create-dialog')).not.toBeInTheDocument()
    })
    expect(createPromptMock).toHaveBeenCalledWith({ title: 'Prompt title', content: 'Prompt content' })
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  it('reports assistant duplicate failures without an unhandled rejection', async () => {
    const user = userEvent.setup()
    duplicateAssistantMock.mockRejectedValueOnce(new Error('duplicate failed'))
    allResourcesMock.push({
      id: 'assistant-to-duplicate',
      type: 'assistant',
      name: 'Assistant to duplicate',
      description: '',
      avatar: '💬',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'assistant-to-duplicate', name: 'Assistant to duplicate', tags: [] }
    })

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'duplicate first' }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('duplicate failed')
    })
    expect(refetchSpy).not.toHaveBeenCalled()
  })

  it('resets a stale assistant catalog tab before keeping assistant filters disabled', async () => {
    const user = userEvent.setup()
    assistantCatalogMock.tabs = [
      { id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 },
      { id: 'custom', label: 'Custom', count: 1 }
    ]

    const { rerender } = render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'select assistant type' }))
    await user.type(screen.getByLabelText('library search'), 'needle')
    expect(resourceLibraryOptionsMock.at(-1)?.search).toBe('needle')

    await user.click(screen.getByRole('button', { name: 'select custom tab' }))
    await waitFor(() => {
      expect(resourceLibraryOptionsMock.at(-1)?.search).toBe('')
    })

    assistantCatalogMock.tabs = [{ id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 }]
    rerender(<LibraryPage />)

    await waitFor(() => {
      expect(screen.getByTestId('assistant-catalog-active-tab')).toHaveTextContent('__mine__')
      expect(resourceLibraryOptionsMock.at(-1)?.search).toBe('needle')
    })
  })

  it('stores an added catalog preset in page state and opens its chat', async () => {
    const user = userEvent.setup()
    assistantCatalogMock.tabs = [
      { id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 },
      { id: 'custom', label: 'Custom', count: 1 }
    ]
    assistantCatalogMock.presets = [{ id: 'preset-1', name: 'Catalog Preset' }]

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'select assistant type' }))
    await user.click(screen.getByRole('button', { name: 'select custom tab' }))
    await user.click(screen.getByRole('button', { name: 'add catalog preset' }))

    await waitFor(() => {
      expect(screen.getByTestId('added-assistant-id')).toHaveTextContent('assistant-created')
    })
    expect(createAssistantMock).toHaveBeenCalledWith({ name: 'Catalog Preset' })
    expect(toastSuccessMock).toHaveBeenCalledWith('common.add_success')

    await user.click(screen.getByRole('button', { name: 'go to catalog chat' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/chat',
      search: { assistantId: 'assistant-created' }
    })
  })

  it('keeps the preset preview open after adding and closes it after opening chat', async () => {
    const user = userEvent.setup()
    assistantCatalogMock.tabs = [
      { id: '__mine__', label: 'library.assistant_catalog.mine', count: 0 },
      { id: 'custom', label: 'Custom', count: 1 }
    ]
    assistantCatalogMock.presets = [{ id: 'preset-1', name: 'Catalog Preset' }]

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'select assistant type' }))
    await user.click(screen.getByRole('button', { name: 'select custom tab' }))
    await user.click(screen.getByRole('button', { name: 'preview catalog preset' }))

    expect(screen.getByTestId('assistant-preset-preview-dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'preview go to chat' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'preview add preset' }))

    await waitFor(() => {
      expect(screen.getByTestId('assistant-preset-preview-dialog')).toBeInTheDocument()
      expect(screen.getByTestId('preview-added-assistant-id')).toHaveTextContent('assistant-created')
    })

    await user.click(screen.getByRole('button', { name: 'preview go to chat' }))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/app/chat',
      search: { assistantId: 'assistant-created' }
    })
    await waitFor(() => {
      expect(screen.queryByTestId('assistant-preset-preview-dialog')).not.toBeInTheDocument()
    })
  })

  it('opens the agent edit dialog from the grid while keeping the list visible', async () => {
    const user = userEvent.setup()
    allResourcesMock.push({
      id: 'agent-from-selector',
      type: 'agent',
      name: 'Selector Agent',
      description: '',
      avatar: '',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'agent-from-selector' }
    })

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'open first' }))

    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    expect(screen.getByTestId('agent-edit-dialog')).toBeInTheDocument()
  })

  it('keeps the edit dialog host mounted while the close animation can run', async () => {
    const user = userEvent.setup()
    allResourcesMock.push({
      id: 'agent-from-selector',
      type: 'agent',
      name: 'Selector Agent',
      description: '',
      avatar: '',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'agent-from-selector' }
    })

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'open first' }))
    await user.click(screen.getByRole('button', { name: 'close agent edit' }))

    expect(screen.queryByTestId('agent-edit-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-edit-dialog-host')).toHaveAttribute('data-open', 'false')
  })

  it('opens the assistant edit dialog from the grid while keeping the list visible', async () => {
    const user = userEvent.setup()
    allResourcesMock.push({
      id: 'assistant-from-selector',
      type: 'assistant',
      name: 'Selector Assistant',
      description: '',
      avatar: '💬',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'assistant-from-selector' }
    })

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'open first' }))

    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-edit-dialog')).toBeInTheDocument()
  })

  it('keeps rendering assistant resources when stale raw data has no tags field', async () => {
    const user = userEvent.setup()
    allResourcesMock.push({
      id: 'assistant-stale-tags',
      type: 'assistant',
      name: 'Stale Assistant',
      description: '',
      avatar: '💬',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'assistant-stale-tags', name: 'Stale Assistant' }
    })

    render(<LibraryPage />)
    await user.click(screen.getByRole('button', { name: 'select assistant type' }))

    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
  })

  it('updates a prompt in a dialog while keeping the list visible', async () => {
    const user = userEvent.setup()
    allResourcesMock.push({
      id: 'prompt-from-grid',
      type: 'prompt',
      name: 'Grid Prompt',
      description: '',
      avatar: 'Aa',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'prompt-from-grid' }
    })

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'open first' }))
    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-edit-dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'save prompt dialog' }))

    await waitFor(() => {
      expect(screen.queryByTestId('prompt-edit-dialog')).not.toBeInTheDocument()
    })
    expect(updatePromptMock).toHaveBeenCalledWith({ title: 'Prompt title', content: 'Prompt content' })
    expect(refetchSpy).toHaveBeenCalledTimes(1)
  })

  it('opens skill details in a dialog while keeping the library list visible', async () => {
    const user = userEvent.setup()
    allResourcesMock.push({
      id: 'skill-from-grid',
      type: 'skill',
      name: 'Grid Skill',
      description: '',
      avatar: 'S',
      tags: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      raw: { id: 'skill-from-grid', name: 'Grid Skill' }
    })

    render(<LibraryPage />)

    await user.click(screen.getByRole('button', { name: 'open first' }))

    expect(screen.getByTestId('resource-grid')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'skill-detail-dialog' })).toBeInTheDocument()
    expect(screen.getByText('Grid Skill')).toBeInTheDocument()
  })
})
