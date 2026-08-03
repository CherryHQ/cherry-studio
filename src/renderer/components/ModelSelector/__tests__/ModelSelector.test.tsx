import { toast } from '@renderer/services/toast'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode, Ref } from 'react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SelectorShellProps } from '../../SelectorShell'
import { ModelSelector } from '../ModelSelector'
import type { FlatListItem, ModelSelectorModelItem, UseModelSelectorDataResult } from '../types'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  openSettingsTab: vi.fn(),
  scrollToIndex: vi.fn(),
  useModelSelectorData: vi.fn()
}))

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
    const actions = Array.isArray(bottomAction) ? bottomAction : bottomAction ? [bottomAction] : []
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
  apiFeatures: {} as Provider['apiFeatures'],
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
    mocks.useModelSelectorData.mockReturnValue(makeData())
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('refreshes selector data whenever it opens', async () => {
    const refetchModels = vi.fn(async () => undefined)
    const refetchProviders = vi.fn(async () => undefined)
    const refetchPinnedModels = vi.fn(async () => undefined)
    mocks.useModelSelectorData.mockReturnValue(makeData({ refetchModels, refetchPinnedModels, refetchProviders }))
    const { rerender } = render(
      <ModelSelector open={false} multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />
    )

    rerender(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

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
