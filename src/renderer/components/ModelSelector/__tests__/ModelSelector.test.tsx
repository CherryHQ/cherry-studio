import { useAgentModelFilter } from '@renderer/hooks/agent/useAgentModelFilter'
import { toast } from '@renderer/services/toast'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode, Ref } from 'react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectorShellBottomAction, SelectorShellProps } from '../../SelectorShell'
import { ModelSelector } from '../ModelSelector'
import type { FlatListItem, ModelSelectorModelItem, UseModelSelectorDataResult } from '../types'

const mocks = vi.hoisted(() => ({
  bottomActions: [] as SelectorShellBottomAction[],
  loggerError: vi.fn(),
  ipcRequest: vi.fn(),
  openSettingsTab: vi.fn(),
  shellEvents: [] as string[],
  scrollToIndex: vi.fn(),
  useModelSelectorData: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError,
      warn: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('@renderer/utils/platform', () => ({
  platform: undefined,
  isMac: false,
  isWin: false,
  isLinux: false,
  isDev: false,
  isProd: false
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  useIcon: () => undefined
}))

vi.mock('@renderer/utils/model', () => ({
  getModelLogoRef: () => undefined
}))

vi.mock('@renderer/components/tags/Model', () => ({
  getModelDisplayTags: () => [],
  ModelTag: () => null
}))

vi.mock('../ModelSelectorDetailCard', () => ({
  ModelSelectorDetailCard: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/components/VirtualList', async () => {
  const React = await import('react')

  return {
    DynamicVirtualList: ({
      ref,
      list,
      children
    }: {
      ref?: Ref<{ scrollToIndex: typeof mocks.scrollToIndex }>
      list: FlatListItem[]
      children: (item: FlatListItem, index: number) => ReactNode
    }) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: mocks.scrollToIndex
      }))

      return (
        <>
          {list.map((item, index) => (
            <React.Fragment key={item.key}>{children(item, index)}</React.Fragment>
          ))}
        </>
      )
    }
  }
})

vi.mock('@renderer/components/SelectorShell', () => ({
  SelectorShell: ({
    trigger,
    open,
    onOpenChange,
    search,
    filterContent,
    multiSelect,
    bottomAction,
    children,
    'data-testid': dataTestId
  }: SelectorShellProps) => {
    useEffect(() => {
      mocks.shellEvents.push('mount')
      return () => {
        mocks.shellEvents.push('unmount')
      }
    }, [])

    const actions = Array.isArray(bottomAction) ? bottomAction : bottomAction ? [bottomAction] : []
    mocks.bottomActions = actions
    const content = typeof children === 'function' ? children({ availableListHeight: undefined }) : children

    return (
      <>
        {trigger}
        {open ? (
          <div data-testid={dataTestId}>
            {search ? (
              <input
                aria-label={search.placeholder}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
              />
            ) : null}
            {filterContent}
            {multiSelect ? (
              <button
                type="button"
                role="switch"
                aria-label={multiSelect.ariaLabel ?? String(multiSelect.label)}
                aria-checked={multiSelect.checked}
                onClick={() => multiSelect.onCheckedChange(!multiSelect.checked)}
              />
            ) : null}
            {content}
            {actions.map((action) => (
              <button type="button" key={String(action.label)} disabled={action.disabled} onClick={action.onClick}>
                {action.label}
              </button>
            ))}
            <button type="button" aria-label="close selector" onClick={() => onOpenChange(false)} />
          </div>
        ) : null}
      </>
    )
  }
}))

vi.mock('../useModelSelectorData', () => ({
  useModelSelectorData: (...args: unknown[]) => mocks.useModelSelectorData(...args)
}))

const provider: Provider = {
  id: 'openai',
  name: 'OpenAI',
  apiKeys: [],
  authType: 'api-key',
  reportsActualCost: false,
  settings: {} as Provider['settings'],
  isEnabled: true
} as Provider

function makeModel(modelId: UniqueModelId): Model {
  return {
    id: modelId,
    providerId: provider.id,
    name: modelId.split('::')[1],
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

function makeModelItem(modelId: UniqueModelId, overrides: Partial<ModelSelectorModelItem> = {}) {
  const model = makeModel(modelId)

  return {
    key: modelId,
    type: 'model' as const,
    groupKind: 'provider' as const,
    model,
    provider,
    modelId,
    modelIdentifier: model.name,
    isPinned: false,
    showIdentifier: false,
    ...overrides
  }
}

function makeData(overrides: Partial<UseModelSelectorDataResult> = {}): UseModelSelectorDataResult {
  const firstItem = makeModelItem('openai::gpt-4' as UniqueModelId)
  const secondItem = makeModelItem('openai::gpt-3.5' as UniqueModelId)
  const listItems: FlatListItem[] = [
    {
      key: 'provider-openai',
      type: 'group',
      title: 'OpenAI',
      groupKind: 'provider',
      provider,
      canNavigateToSettings: true
    },
    firstItem,
    secondItem
  ]

  return {
    availableTags: [],
    isLoading: false,
    isPinActionDisabled: false,
    listItems,
    modelItems: [firstItem, secondItem],
    pinnedIds: [],
    refetchModels: vi.fn(),
    refetchPinnedModels: vi.fn(),
    refetchProviders: vi.fn(),
    resetTags: vi.fn(),
    resolvedSelectedModelIds: [],
    selectableModelsById: new Map([
      [firstItem.modelId, firstItem.model],
      [secondItem.modelId, secondItem.model]
    ]),
    selectedTags: [],
    sortedProviders: [provider],
    tagSelection: {} as UseModelSelectorDataResult['tagSelection'],
    togglePin: vi.fn(async () => undefined),
    toggleTag: vi.fn(),
    visibleSelectedModelIdSet: new Set(),
    ...overrides
  }
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bottomActions = []
    mocks.shellEvents = []
    mocks.useModelSelectorData.mockReturnValue(makeData())
    mocks.ipcRequest.mockResolvedValue({ modelCount: 0, quotaExhaustedModelIds: [] })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows only the model identifier under a persistent provider group', () => {
    const item = makeModelItem('openai::gpt-4-variant-a' as UniqueModelId, {
      model: { ...makeModel('openai::gpt-4-variant-a' as UniqueModelId), name: 'GPT-4' },
      modelIdentifier: 'gpt-4-variant-a',
      showIdentifier: true
    })
    const listItems: FlatListItem[] = [
      {
        key: 'provider-openai',
        type: 'group',
        title: 'OpenAI',
        groupKind: 'provider',
        provider,
        canNavigateToSettings: true
      },
      item
    ]
    mocks.useModelSelectorData.mockReturnValue(makeData({ listItems, modelItems: [item] }))

    render(
      <ModelSelector
        multiple={false}
        open
        trigger={<button type="button">Open</button>}
        value={item.model}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('| gpt-4-variant-a')).toBeInTheDocument()
    expect(screen.queryByText(/OpenAI · gpt-4-variant-a/)).not.toBeInTheDocument()
  })

  it('keeps the provider in a pinned row without a provider group', () => {
    const item = makeModelItem('openai::gpt-4-variant-a' as UniqueModelId, {
      key: 'openai::gpt-4-variant-a_pinned',
      groupKind: 'pinned',
      model: { ...makeModel('openai::gpt-4-variant-a' as UniqueModelId), name: 'GPT-4' },
      modelIdentifier: 'gpt-4-variant-a',
      isPinned: true,
      showIdentifier: true
    })
    mocks.useModelSelectorData.mockReturnValue(makeData({ listItems: [item], modelItems: [item] }))

    render(
      <ModelSelector
        multiple={false}
        open
        trigger={<button type="button">Open</button>}
        value={item.model}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('| OpenAI · gpt-4-variant-a')).toBeInTheDocument()
  })

  it('selects a model and closes the selector in single-select mode', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()
    render(
      <ModelSelector
        open
        multiple={false}
        trigger={<button type="button">open</button>}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
    )

    await user.click(screen.getAllByRole('option')[0])

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai::gpt-4' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows a quota-exhausted model but does not let the user select it', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ModelSelector
        open
        multiple={false}
        isModelDisabled={(model) => model.id === 'openai::gpt-4'}
        trigger={<button type="button">open</button>}
        onSelect={onSelect}
      />
    )

    const disabledModel = screen.getAllByRole('option')[0]
    expect(disabledModel).toHaveAttribute('aria-disabled', 'true')
    await user.click(disabledModel)

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('syncs Cloud availability and disables exhausted models for agent selectors', async () => {
    const exhaustedId = 'cherryai::deepseek-free' as UniqueModelId
    const availableId = 'cherryai::deepseek-go' as UniqueModelId
    const cloudProvider = { ...provider, id: 'cherryai', name: 'CherryAI' }
    const cloudItems = [exhaustedId, availableId].map((modelId) =>
      makeModelItem(modelId, {
        model: { ...makeModel(modelId), providerId: cloudProvider.id, group: 'Cherry Cloud' },
        provider: cloudProvider
      })
    )
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        listItems: [
          {
            key: 'provider-cherryai',
            type: 'group',
            title: 'CherryAI',
            groupKind: 'provider',
            provider: cloudProvider
          },
          ...cloudItems
        ],
        modelItems: cloudItems,
        selectableModelsById: new Map(cloudItems.map((item) => [item.modelId, item.model]))
      })
    )
    let resolveSync!: (value: { modelCount: number; quotaExhaustedModelIds: UniqueModelId[] }) => void
    mocks.ipcRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSync = resolve
      })
    )

    function AgentModelSelector() {
      const filter = useAgentModelFilter('claude-code')
      return (
        <ModelSelector
          open
          multiple={false}
          filter={filter}
          trigger={<button type="button">open</button>}
          onSelect={vi.fn()}
        />
      )
    }

    render(<AgentModelSelector />)

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledExactlyOnceWith('cherry_cloud.models.sync'))
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-disabled', 'true')

    await act(async () => {
      resolveSync({ modelCount: 2, quotaExhaustedModelIds: [exhaustedId] })
    })

    await waitFor(() => expect(screen.getAllByRole('option')[1]).not.toHaveAttribute('aria-disabled'))
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not sync Cloud availability for ordinary model selectors', () => {
    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('tears down the lazy shell before resetting an active tag filter on close', async () => {
    const user = userEvent.setup()
    const resetTags = vi.fn(() => {
      mocks.shellEvents.push('reset')
    })
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        resetTags,
        selectedTags: ['reasoning'],
        tagSelection: { reasoning: true } as UseModelSelectorDataResult['tagSelection']
      })
    )

    function Host() {
      const [open, setOpen] = useState(true)

      return (
        <ModelSelector
          open={open}
          multiple={false}
          mountStrategy="lazy-keep"
          trigger={<button type="button">open</button>}
          onOpenChange={setOpen}
          onSelect={vi.fn()}
        />
      )
    }

    render(<Host />)
    expect(mocks.shellEvents).toEqual(['mount'])

    await user.click(screen.getAllByRole('option')[0])

    expect(mocks.shellEvents).toEqual(['mount', 'unmount', 'mount', 'reset'])
  })

  it('tears down the lazy shell when the parent closes the controlled selector', async () => {
    const resetTags = vi.fn(() => {
      mocks.shellEvents.push('reset')
    })
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        resetTags,
        selectedTags: ['reasoning'],
        tagSelection: { reasoning: true } as UseModelSelectorDataResult['tagSelection']
      })
    )

    const renderSelector = (open: boolean) => (
      <ModelSelector
        open={open}
        multiple={false}
        mountStrategy="lazy-keep"
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )

    const { rerender } = render(renderSelector(true))
    expect(mocks.shellEvents).toEqual(['mount'])

    await act(async () => {
      rerender(renderSelector(false))
    })

    expect(mocks.shellEvents).toEqual(['mount', 'unmount', 'mount', 'reset'])
  })

  it('clears a single selection from the bottom option and closes the selector', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    render(
      <ModelSelector
        open
        multiple={false}
        value={makeModel('openai::gpt-4' as UniqueModelId)}
        noneOptionLabel="No model"
        trigger={<button type="button">open</button>}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
    )

    await user.click(screen.getByRole('button', { name: 'No model' }))

    expect(onSelect).toHaveBeenCalledWith(undefined)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('marks the empty option selected after the configure action', () => {
    render(
      <ModelSelector
        open
        multiple={false}
        noneOptionLabel="No model"
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )

    expect(mocks.bottomActions.map((action) => action.label)).toEqual(['models.action.configure_custom', 'No model'])
    expect(mocks.bottomActions[1]).toMatchObject({ type: 'selectable', selected: true })
  })

  it('omits the empty option from required single and multi selectors', () => {
    const { rerender } = render(
      <ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />
    )

    expect(mocks.bottomActions.map((action) => action.label)).toEqual(['models.action.configure_custom'])

    rerender(<ModelSelector open multiple trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(mocks.bottomActions.map((action) => action.label)).toEqual(['models.action.configure_custom'])
  })

  it('suppresses only the immediate close caused by a multi-select item click', async () => {
    const firstId = 'openai::gpt-4' as UniqueModelId
    const secondId = 'openai::gpt-3.5' as UniqueModelId
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()
    render(
      <ModelSelector
        open
        multiple
        selectionType="id"
        multiSelectMode
        value={[firstId]}
        trigger={<button type="button">open</button>}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />
    )

    // The close event from the popover primitive occurs in the same event turn.
    fireEvent.click(screen.getAllByRole('option')[1])
    fireEvent.click(screen.getByRole('button', { name: 'close selector' }))

    expect(onSelect).toHaveBeenCalledWith([firstId, secondId])
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    fireEvent.click(screen.getAllByRole('option')[1])
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    fireEvent.click(screen.getByRole('button', { name: 'close selector' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('collapses multiple ids when multi-select mode is disabled', async () => {
    const user = userEvent.setup()
    const firstId = 'openai::gpt-4' as UniqueModelId
    const secondId = 'openai::gpt-3.5' as UniqueModelId
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        resolvedSelectedModelIds: [firstId, secondId],
        visibleSelectedModelIdSet: new Set([firstId, secondId])
      })
    )
    const onMultiSelectModeChange = vi.fn()
    const onSelect = vi.fn()
    render(
      <ModelSelector
        open
        multiple
        selectionType="id"
        multiSelectMode
        value={[firstId, secondId]}
        trigger={<button type="button">open</button>}
        onMultiSelectModeChange={onMultiSelectModeChange}
        onSelect={onSelect}
      />
    )

    await user.click(screen.getByRole('switch', { name: 'models.multi_select.label' }))

    expect(onMultiSelectModeChange).toHaveBeenCalledWith(false)
    expect(onSelect).toHaveBeenCalledWith([firstId])
  })

  it('keeps lazy-mounted data active and refreshes it only on later openings', async () => {
    const refetchModels = vi.fn(async () => undefined)
    const refetchProviders = vi.fn(async () => undefined)
    const refetchPinnedModels = vi.fn(async () => undefined)
    mocks.useModelSelectorData.mockReturnValue(makeData({ refetchModels, refetchPinnedModels, refetchProviders }))
    const closed = (
      <ModelSelector
        open={false}
        multiple={false}
        mountStrategy="lazy-keep"
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )
    const opened = (
      <ModelSelector
        open
        multiple={false}
        mountStrategy="lazy-keep"
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )
    const { rerender } = render(closed)
    expect(mocks.useModelSelectorData).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))

    rerender(opened)

    expect(mocks.useModelSelectorData).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }))
    expect(refetchModels).not.toHaveBeenCalled()
    expect(refetchProviders).not.toHaveBeenCalled()
    expect(refetchPinnedModels).not.toHaveBeenCalled()

    rerender(closed)

    expect(mocks.useModelSelectorData).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }))

    rerender(opened)

    await waitFor(() => expect(refetchModels).toHaveBeenCalledOnce())
    expect(refetchProviders).toHaveBeenCalledOnce()
    expect(refetchPinnedModels).toHaveBeenCalledOnce()
  })

  it('positions the selected model before paint each time the selector opens', () => {
    const selectedId = 'openai::gpt-3.5' as UniqueModelId
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        resolvedSelectedModelIds: [selectedId],
        visibleSelectedModelIdSet: new Set([selectedId])
      })
    )
    const closed = (
      <ModelSelector open={false} multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />
    )
    const { rerender } = render(closed)

    rerender(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(mocks.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start' })

    mocks.scrollToIndex.mockClear()
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        resolvedSelectedModelIds: ['openai::gpt-4' as UniqueModelId],
        visibleSelectedModelIdSet: new Set(['openai::gpt-4' as UniqueModelId])
      })
    )
    rerender(closed)
    rerender(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(mocks.scrollToIndex).toHaveBeenCalledWith(1, { align: 'start' })
  })

  it('shows an error toast when pinning fails', async () => {
    const user = userEvent.setup()
    const togglePin = vi.fn(async () => {
      throw new Error('backend down')
    })
    mocks.useModelSelectorData.mockReturnValue(makeData({ togglePin }))
    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    await user.click(screen.getAllByRole('button', { name: 'models.action.pin' })[0])

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('common.error'))
    expect(mocks.loggerError).toHaveBeenCalledWith('Failed to toggle model pin', expect.any(Error), {
      modelId: 'openai::gpt-4'
    })
  })

  it.each([
    {
      actionName: 'navigate.provider_settings',
      expectedPath: '/settings/provider?id=openai',
      name: 'provider'
    },
    {
      actionName: 'models.action.configure_custom',
      expectedPath: '/settings/provider',
      name: 'custom model'
    }
  ])('lets the host close before navigating to $name settings', async ({ actionName, expectedPath }) => {
    const user = userEvent.setup()

    function HostDialog() {
      const [dialogOpen, setDialogOpen] = useState(true)
      const [selectorOpen, setSelectorOpen] = useState(true)

      return dialogOpen ? (
        <div role="dialog">
          <ModelSelector
            open={selectorOpen}
            multiple={false}
            trigger={<button type="button">open</button>}
            onOpenChange={setSelectorOpen}
            onSettingsNavigate={(navigate) => {
              setDialogOpen(false)
              navigate()
            }}
            onSelect={vi.fn()}
          />
        </div>
      ) : (
        <div>dialog closed</div>
      )
    }

    render(<HostDialog />)
    await user.click(screen.getByRole('button', { name: actionName }))

    await waitFor(() => expect(screen.getByText('dialog closed')).toBeInTheDocument())
    expect(mocks.openSettingsTab).toHaveBeenCalledWith(expectedPath)
  })

  it('shows an empty result when no models match', () => {
    mocks.useModelSelectorData.mockReturnValue(makeData({ listItems: [], modelItems: [] }))

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(screen.getByText('models.no_matches')).toBeInTheDocument()
  })

  it('keeps model filters on one horizontally scrollable row', () => {
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        availableTags: ['free'],
        tagSelection: { free: false } as UseModelSelectorDataResult['tagSelection']
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(screen.getByTestId('model-selector-filter-tags')).toHaveClass('flex-nowrap', 'overflow-x-auto')
  })
})
