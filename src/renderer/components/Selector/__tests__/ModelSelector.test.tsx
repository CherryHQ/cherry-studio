import { type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  RefObject
} from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelSelector } from '../model/ModelSelector'
import type { FlatListItem, ModelSelectorModelItem, UseModelSelectorDataResult } from '../model/types'
import { DEFAULT_SELECTOR_CONTENT_HEIGHT } from '../shell/SelectorShell'

const {
  mockUseModelSelectorData,
  mockOpenSettingsWindow,
  mockScrollToIndex,
  mockLoggerError,
  mockVirtualListSizes,
  mockAvailablePopoverHeight,
  mockHoverCardContentProps
} = vi.hoisted(() => ({
  mockUseModelSelectorData: vi.fn(),
  mockOpenSettingsWindow: vi.fn(),
  mockScrollToIndex: vi.fn(),
  mockLoggerError: vi.fn(),
  mockVirtualListSizes: [] as number[],
  mockAvailablePopoverHeight: { value: undefined as number | undefined },
  mockHoverCardContentProps: [] as Array<{ portalContainer?: unknown; side?: string; align?: string }>
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mockLoggerError,
      warn: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/services/SettingsWindowService', () => ({
  openSettingsWindow: mockOpenSettingsWindow
}))

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: (id: string) => id
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  resolveIcon: () => null
}))

vi.mock('@renderer/config/models/reasoning', () => ({
  getModelSupportedReasoningEffortOptions: () => undefined
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@cherrystudio/ui', () => {
  return {
    Avatar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AvatarFallback: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => {
      const { variant, size, type = 'button', ...buttonProps } = props
      void variant
      void size

      return (
        <button type={type} {...buttonProps}>
          {children}
        </button>
      )
    },
    Checkbox: ({ checked, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
      <input type="checkbox" checked={Boolean(checked)} readOnly {...props} />
    ),
    CustomTag: ({
      children,
      icon,
      onClick,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      color?: string
      icon?: ReactNode
      inactive?: boolean
      size?: number
      tooltip?: string
    }) => {
      const { color, inactive, size, tooltip, ...buttonProps } = props
      void color
      void inactive
      void size
      void tooltip

      return (
        <button type="button" onClick={onClick} {...buttonProps}>
          {icon}
          {children}
        </button>
      )
    },
    HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
    HoverCardContent: ({
      portalContainer,
      side,
      align
    }: HTMLAttributes<HTMLDivElement> & {
      portalContainer?: unknown
      side?: string
      align?: string
      sideOffset?: number
      collisionPadding?: number
    }) => {
      mockHoverCardContentProps.push({ portalContainer, side, align })
      return null
    },
    HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Input: ({
      ref,
      ...props
    }: InputHTMLAttributes<HTMLInputElement> & { ref?: RefObject<HTMLInputElement | null> }) => (
      <input ref={ref} {...props} />
    ),
    Popover: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => (
      <div>
        <button type="button" data-testid="mock-popover-close" onClick={() => onOpenChange?.(false)} />
        {children}
      </div>
    ),
    PopoverContent: ({
      children,
      style,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      side?: string
      align?: string
      sideOffset?: number
      collisionPadding?: number
      portalContainer?: unknown
      forceMount?: boolean
      onInteractOutside?: unknown
      onOpenAutoFocus?: unknown
    }) => {
      const {
        side,
        align,
        sideOffset,
        collisionPadding,
        portalContainer,
        forceMount,
        onInteractOutside,
        onOpenAutoFocus,
        ...contentProps
      } = props
      void side
      void align
      void sideOffset
      void collisionPadding
      void portalContainer
      void onInteractOutside
      void onOpenAutoFocus

      return (
        <div
          {...contentProps}
          data-force-mount={forceMount ? 'true' : undefined}
          style={{
            ...(mockAvailablePopoverHeight.value
              ? ({
                  '--radix-popover-content-available-height': `${mockAvailablePopoverHeight.value}px`
                } as CSSProperties)
              : {}),
            ...style
          }}>
          {children}
        </div>
      )
    },
    PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & {
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      />
    ),
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    usePortalContainer: () => undefined
  }
})

vi.mock('@renderer/components/VirtualList', async () => {
  const React = await import('react')

  return {
    DynamicVirtualList: ({ ref, list, children, size }) => {
      mockVirtualListSizes.push(size)
      React.useImperativeHandle(ref, () => ({
        measure: vi.fn(),
        scrollElement: vi.fn(() => null),
        scrollToOffset: vi.fn(),
        scrollToIndex: mockScrollToIndex,
        resizeItem: vi.fn(),
        getTotalSize: vi.fn(() => list.length * 36),
        getVirtualItems: vi.fn(() => []),
        getVirtualIndexes: vi.fn(() => [])
      }))

      return (
        <div>
          {list.map((item, index) => (
            <React.Fragment key={item.key}>{children(item, index)}</React.Fragment>
          ))}
        </div>
      )
    }
  }
})

vi.mock('../model/useModelSelectorData', () => ({
  useModelSelectorData: (...args: unknown[]) => mockUseModelSelectorData(...args)
}))

const PROVIDER: Provider = {
  id: 'openai',
  name: 'OpenAI',
  apiKeys: [],
  authType: 'api-key',
  apiFeatures: {} as Provider['apiFeatures'],
  settings: {} as Provider['settings'],
  isEnabled: true
} as Provider

function makeModel(modelId: UniqueModelId, name: string): Model {
  return {
    id: modelId,
    providerId: PROVIDER.id,
    name,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  } as Model
}

function makeModelItem(
  modelId: UniqueModelId,
  overrides: Partial<ModelSelectorModelItem> = {}
): ModelSelectorModelItem {
  const model = makeModel(modelId, modelId.split('::')[1])

  return {
    key: modelId,
    type: 'model',
    model,
    provider: PROVIDER,
    modelId,
    modelIdentifier: model.name,
    isPinned: false,
    showIdentifier: false,
    ...overrides
  }
}

function makeSelectedSet(ids: UniqueModelId[]): ReadonlySet<UniqueModelId> {
  return new Set(ids)
}

function makeData(overrides: Partial<UseModelSelectorDataResult> = {}): UseModelSelectorDataResult {
  const itemA = makeModelItem('openai::gpt-4' as UniqueModelId)
  const itemB = makeModelItem('openai::gpt-3.5' as UniqueModelId)
  const listItems: FlatListItem[] = [
    {
      key: 'provider-openai',
      type: 'group',
      title: 'OpenAI',
      groupKind: 'provider',
      provider: PROVIDER,
      canNavigateToSettings: true
    },
    itemA,
    itemB
  ]

  return {
    availableTags: [],
    isLoading: false,
    isPinActionDisabled: false,
    listItems,
    modelItems: [itemA, itemB],
    pinnedIds: [],
    refetchModels: vi.fn(),
    refetchPinnedModels: vi.fn(),
    refetchProviders: vi.fn(),
    resetTags: vi.fn(),
    resolvedSelectedModelIds: [],
    selectableModelsById: new Map([
      [itemA.modelId, itemA.model],
      [itemB.modelId, itemB.model]
    ]),
    selectedTags: [],
    sortedProviders: [PROVIDER],
    tagSelection: {} as UseModelSelectorDataResult['tagSelection'],
    togglePin: vi.fn(async () => undefined),
    toggleTag: vi.fn(),
    visibleSelectedModelIdSet: makeSelectedSet([]),
    ...overrides
  }
}

function mockSelectorChromeHeight(height: number) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isChrome = this.hasAttribute('data-selector-shell-chrome')
    return {
      x: 0,
      y: 0,
      width: 320,
      height: isChrome ? height : 0,
      top: 0,
      right: 320,
      bottom: isChrome ? height : 0,
      left: 0,
      toJSON: () => {}
    }
  })
}

describe('ModelSelector', () => {
  beforeEach(() => {
    mockUseModelSelectorData.mockReset()
    mockOpenSettingsWindow.mockReset()
    mockScrollToIndex.mockReset()
    mockLoggerError.mockReset()
    mockVirtualListSizes.length = 0
    mockHoverCardContentProps.length = 0
    mockAvailablePopoverHeight.value = undefined
    mockOpenSettingsWindow.mockResolvedValue(undefined)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    Object.assign(window, { toast: { error: vi.fn() } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a toast when pin/unpin fails', async () => {
    const togglePin = vi.fn(async () => {
      throw new Error('backend down')
    })
    mockUseModelSelectorData.mockReturnValue(makeData({ togglePin }))

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    fireEvent.click(screen.getAllByLabelText('models.action.pin')[0])

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledWith('common.error'))
    expect(mockLoggerError).toHaveBeenCalledWith('Failed to toggle model pin', expect.any(Error), {
      modelId: 'openai::gpt-4'
    })
    expect(togglePin).toHaveBeenCalledWith('openai::gpt-4')
  })

  it('uses neutral row styling and pinned action color', () => {
    const pinnedItem = makeModelItem('openai::gpt-4' as UniqueModelId, { isPinned: true })
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: [pinnedItem],
        modelItems: [pinnedItem],
        resolvedSelectedModelIds: ['openai::gpt-4' as UniqueModelId],
        visibleSelectedModelIdSet: makeSelectedSet(['openai::gpt-4' as UniqueModelId])
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    const option = screen.getByTestId('model-selector-item-openai::gpt-4')
    const row = option.closest('[data-model-selector-row]')
    expect(row).toHaveClass('group', 'relative', 'rounded-[10px]', 'px-2', 'pr-0.5', 'py-1.5', 'bg-accent/70')
    expect(row).not.toHaveClass('bg-primary/10')
    expect(screen.getByLabelText('models.action.unpin')).toHaveClass(
      'size-4',
      'hover:bg-transparent',
      'text-foreground!'
    )
    expect(screen.getByLabelText('models.action.unpin')).not.toHaveClass('text-primary!')
  })

  it('renders filter tags as icon-only chips', () => {
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        availableTags: [MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.REASONING, 'free'],
        listItems: [],
        modelItems: []
      })
    )

    const { container } = render(
      <ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />
    )

    expect(screen.getByText('models.filter.by_tag')).toBeInTheDocument()
    expect(screen.queryByText('models.type.vision')).not.toBeInTheDocument()
    expect(screen.queryByText('models.type.reasoning')).not.toBeInTheDocument()
    expect(screen.queryByText('models.type.free')).not.toBeInTheDocument()
    expect(container.querySelectorAll('button.transition-colors svg')).toHaveLength(3)
  })

  it('uses neutral color on the row action when the model row is selected', () => {
    const selectedItem = makeModelItem('openai::gpt-4' as UniqueModelId)
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: [selectedItem],
        modelItems: [selectedItem],
        resolvedSelectedModelIds: ['openai::gpt-4' as UniqueModelId],
        visibleSelectedModelIdSet: makeSelectedSet(['openai::gpt-4' as UniqueModelId])
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(screen.getByLabelText('models.action.pin')).toHaveClass('text-foreground!')
    expect(screen.getByLabelText('models.action.pin')).not.toHaveClass('text-primary!')
  })

  it('keeps keyboard focus stable when multi-select value changes while open', async () => {
    const selectedSecond = makeModelItem('openai::gpt-3.5' as UniqueModelId)
    const selectedFirst = makeModelItem('openai::gpt-4' as UniqueModelId)
    const unselectedFirst = makeModelItem('openai::gpt-4' as UniqueModelId)
    const firstData = makeData({
      listItems: [unselectedFirst, selectedSecond],
      modelItems: [unselectedFirst, selectedSecond],
      resolvedSelectedModelIds: ['openai::gpt-3.5' as UniqueModelId],
      visibleSelectedModelIdSet: makeSelectedSet(['openai::gpt-3.5' as UniqueModelId])
    })
    const secondData = makeData({
      listItems: [selectedFirst, selectedSecond],
      modelItems: [selectedFirst, selectedSecond],
      resolvedSelectedModelIds: ['openai::gpt-4' as UniqueModelId, 'openai::gpt-3.5' as UniqueModelId],
      visibleSelectedModelIdSet: makeSelectedSet(['openai::gpt-4' as UniqueModelId, 'openai::gpt-3.5' as UniqueModelId])
    })
    let currentData = firstData
    mockUseModelSelectorData.mockImplementation(() => currentData)

    const onSelect = vi.fn()
    const { rerender } = render(
      <ModelSelector
        open
        multiple
        selectionType="id"
        multiSelectMode
        value={['openai::gpt-3.5' as UniqueModelId]}
        trigger={<button type="button">open</button>}
        onSelect={onSelect}
      />
    )

    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledWith(1, { align: 'start' }))
    mockScrollToIndex.mockClear()

    currentData = secondData
    rerender(
      <ModelSelector
        open
        multiple
        selectionType="id"
        multiSelectMode
        value={['openai::gpt-4' as UniqueModelId, 'openai::gpt-3.5' as UniqueModelId]}
        trigger={<button type="button">open</button>}
        onSelect={onSelect}
      />
    )

    expect(mockScrollToIndex).not.toHaveBeenCalled()
  })

  it('keeps the popover open when enabling controlled multi-select from an existing selection', () => {
    const firstModelId = 'openai::gpt-4' as UniqueModelId
    const secondModelId = 'openai::gpt-3.5' as UniqueModelId
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        resolvedSelectedModelIds: [firstModelId],
        visibleSelectedModelIdSet: makeSelectedSet([firstModelId])
      })
    )
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()
    const onMultiSelectModeChange = vi.fn()

    render(
      <ModelSelector
        open
        multiple
        value={[makeModel(firstModelId, 'gpt-4')]}
        multiSelectMode={false}
        trigger={<button type="button">open</button>}
        onOpenChange={onOpenChange}
        onSelect={onSelect}
        onMultiSelectModeChange={onMultiSelectModeChange}
      />
    )

    fireEvent.click(screen.getByTestId('model-selector-multi-select-switch'))
    fireEvent.click(screen.getByTestId(`model-selector-item-${secondModelId}`))
    fireEvent.click(screen.getByTestId('mock-popover-close'))

    expect(onMultiSelectModeChange).toHaveBeenCalledWith(true)
    expect(onSelect).toHaveBeenCalledWith([
      expect.objectContaining({ id: firstModelId }),
      expect.objectContaining({ id: secondModelId })
    ])
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('still closes normally after the multi-select item click guard expires', async () => {
    const firstModelId = 'openai::gpt-4' as UniqueModelId
    const secondModelId = 'openai::gpt-3.5' as UniqueModelId
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        resolvedSelectedModelIds: [firstModelId],
        visibleSelectedModelIdSet: makeSelectedSet([firstModelId])
      })
    )
    const onOpenChange = vi.fn()

    render(
      <ModelSelector
        open
        multiple
        value={[makeModel(firstModelId, 'gpt-4')]}
        multiSelectMode
        trigger={<button type="button">open</button>}
        onOpenChange={onOpenChange}
        onSelect={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId(`model-selector-item-${secondModelId}`))
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.click(screen.getByTestId('mock-popover-close'))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('scrolls the selected model to the start when a lazy-kept selector reopens', async () => {
    const firstData = makeData()
    const secondData = makeData({
      resolvedSelectedModelIds: ['openai::gpt-3.5' as UniqueModelId],
      visibleSelectedModelIdSet: makeSelectedSet(['openai::gpt-3.5' as UniqueModelId])
    })
    let currentData = firstData
    mockUseModelSelectorData.mockImplementation(() => currentData)

    const onSelect = vi.fn()
    const { rerender } = render(
      <ModelSelector
        open
        mountStrategy="lazy-keep"
        multiple={false}
        trigger={<button type="button">open</button>}
        onSelect={onSelect}
      />
    )

    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalled())
    mockScrollToIndex.mockClear()

    fireEvent.click(screen.getByTestId('model-selector-item-openai::gpt-3.5'))
    currentData = secondData
    rerender(
      <ModelSelector
        open={false}
        mountStrategy="lazy-keep"
        multiple={false}
        trigger={<button type="button">open</button>}
        onSelect={onSelect}
      />
    )
    mockScrollToIndex.mockClear()

    rerender(
      <ModelSelector
        open
        mountStrategy="lazy-keep"
        multiple={false}
        trigger={<button type="button">open</button>}
        onSelect={onSelect}
      />
    )

    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledWith(2, { align: 'start' }))
  })

  it('refetches models, providers, and pinned models when controlled open switches to true', async () => {
    const refetchModels = vi.fn(async () => undefined)
    const refetchProviders = vi.fn(async () => undefined)
    const refetchPinnedModels = vi.fn(async () => undefined)
    mockUseModelSelectorData.mockReturnValue(makeData({ refetchModels, refetchPinnedModels, refetchProviders }))

    const { rerender } = render(
      <ModelSelector open={false} multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />
    )

    expect(refetchModels).not.toHaveBeenCalled()
    expect(refetchProviders).not.toHaveBeenCalled()
    expect(refetchPinnedModels).not.toHaveBeenCalled()

    rerender(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    await waitFor(() => expect(refetchModels).toHaveBeenCalledTimes(1))
    expect(refetchProviders).toHaveBeenCalledTimes(1)
    expect(refetchPinnedModels).toHaveBeenCalledTimes(1)
  })

  it('refetches models and providers without pinned models when pinned section is hidden', async () => {
    const refetchModels = vi.fn(async () => undefined)
    const refetchProviders = vi.fn(async () => undefined)
    const refetchPinnedModels = vi.fn(async () => undefined)
    mockUseModelSelectorData.mockReturnValue(makeData({ refetchModels, refetchPinnedModels, refetchProviders }))

    const { rerender } = render(
      <ModelSelector
        open={false}
        multiple={false}
        showPinnedModels={false}
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )

    rerender(
      <ModelSelector
        open
        multiple={false}
        showPinnedModels={false}
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )

    await waitFor(() => expect(refetchModels).toHaveBeenCalledTimes(1))
    expect(refetchProviders).toHaveBeenCalledTimes(1)
    expect(refetchPinnedModels).not.toHaveBeenCalled()
  })

  it('does not refetch repeatedly while already open, but refetches after close and reopen', async () => {
    const refetchModels = vi.fn(async () => undefined)
    const refetchProviders = vi.fn(async () => undefined)
    const refetchPinnedModels = vi.fn(async () => undefined)
    mockUseModelSelectorData.mockReturnValue(makeData({ refetchModels, refetchPinnedModels, refetchProviders }))

    const { rerender } = render(
      <ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />
    )

    await waitFor(() => expect(refetchModels).toHaveBeenCalledTimes(1))
    expect(refetchProviders).toHaveBeenCalledTimes(1)
    expect(refetchPinnedModels).toHaveBeenCalledTimes(1)

    rerender(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(refetchModels).toHaveBeenCalledTimes(1)
    expect(refetchProviders).toHaveBeenCalledTimes(1)
    expect(refetchPinnedModels).toHaveBeenCalledTimes(1)

    rerender(
      <ModelSelector open={false} multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />
    )
    rerender(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    await waitFor(() => expect(refetchModels).toHaveBeenCalledTimes(2))
    expect(refetchProviders).toHaveBeenCalledTimes(2)
    expect(refetchPinnedModels).toHaveBeenCalledTimes(2)
  })

  it('lazy keeps the popover content mounted only after the first open', () => {
    mockUseModelSelectorData.mockReturnValue(makeData())

    const selector = (
      <ModelSelector
        open={false}
        mountStrategy="lazy-keep"
        multiple={false}
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )
    const { rerender } = render(selector)

    expect(screen.queryByTestId('model-selector-content')).toBeNull()

    rerender(
      <ModelSelector
        open
        mountStrategy="lazy-keep"
        multiple={false}
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByTestId('model-selector-content')).toHaveAttribute('data-force-mount', 'true')

    rerender(selector)

    expect(screen.getByTestId('model-selector-content')).toHaveAttribute('hidden')
  })

  it('opens provider settings from the provider group action without selecting a model', async () => {
    mockUseModelSelectorData.mockReturnValue(makeData())
    const onSelect = vi.fn()

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={onSelect} />)

    fireEvent.click(screen.getByLabelText('navigate.provider_settings'))

    await waitFor(() => expect(mockOpenSettingsWindow).toHaveBeenCalledWith('/settings/provider?id=openai'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens CherryAI provider settings from the group action without rendering a row navigation tag', async () => {
    const cherryProvider = { ...PROVIDER, id: 'cherryai', name: 'CherryAI' } as Provider
    const modelId = 'cherryai::Qwen/Qwen3-8B' as UniqueModelId
    const cherryModel = {
      ...makeModel(modelId, 'Qwen3-8B'),
      providerId: 'cherryai',
      apiModelId: 'Qwen/Qwen3-8B'
    } as Model
    const cherryItem = makeModelItem(modelId, {
      model: cherryModel,
      provider: cherryProvider,
      modelIdentifier: 'Qwen/Qwen3-8B'
    })

    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: [
          {
            key: 'provider-cherryai',
            type: 'group',
            title: 'CherryAI',
            groupKind: 'provider',
            provider: cherryProvider,
            canNavigateToSettings: true,
            settingsProviderId: 'cherryin'
          },
          cherryItem
        ],
        modelItems: [cherryItem],
        selectableModelsById: new Map([[modelId, cherryModel]]),
        sortedProviders: [cherryProvider]
      })
    )
    const onSelect = vi.fn()

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={onSelect} />)

    expect(screen.queryByText('cherryin')).toBeNull()
    fireEvent.click(screen.getByLabelText('navigate.provider_settings'))

    await waitFor(() => expect(mockOpenSettingsWindow).toHaveBeenCalledWith('/settings/provider?id=cherryin'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not render model identifiers in rows', () => {
    const longModelName = 'DeepSeek-V3.2-Thinking-Agent-Long-Display-Name'
    const longIdentifier = 'agent/deepseek-v3.2-thinking-agent-very-long-routing-identifier'
    const modelId = 'openai::deepseek-v3.2-thinking-agent' as UniqueModelId
    const model = makeModel(modelId, longModelName)
    const item = makeModelItem(modelId, {
      model,
      modelIdentifier: longIdentifier,
      showIdentifier: true,
      isPinned: true
    })

    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: [item],
        modelItems: [item],
        selectableModelsById: new Map([[modelId, model]])
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    const option = screen.getByTestId(`model-selector-item-${modelId}`)
    expect(option.querySelector('.overflow-hidden')).toBeInTheDocument()

    const modelName = screen.getByText(longModelName)
    const providerName = screen.getByText('| OpenAI')

    expect(modelName).toHaveClass('min-w-0', 'max-w-full', 'shrink-0', 'truncate')
    expect(modelName).toHaveAttribute('title', longModelName)
    expect(screen.queryByText(longIdentifier)).toBeNull()
    expect(providerName).toHaveClass('min-w-0', 'flex-[1_999_0%]', 'truncate')
    expect(providerName).toHaveAttribute('title', 'OpenAI')
  })

  it('passes the selector portal container to model detail hover cards', () => {
    const portalContainer = document.createElement('div')
    const item = makeModelItem('openai::gpt-4' as UniqueModelId)

    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: [item],
        modelItems: [item]
      })
    )

    render(
      <ModelSelector
        open
        multiple={false}
        trigger={<button type="button">open</button>}
        portalContainer={portalContainer}
        onSelect={vi.fn()}
      />
    )

    expect(mockHoverCardContentProps.at(-1)).toMatchObject({
      portalContainer,
      side: 'right',
      align: 'start'
    })
  })

  it('sets the default popover target height for long model lists', () => {
    const items = Array.from({ length: 30 }, (_, index) => makeModelItem(`openai::model-${index}` as UniqueModelId))
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: items,
        modelItems: items
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(screen.getByTestId('model-selector-content')).toHaveStyle({ height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px` })
    expect(mockVirtualListSizes.at(-1)).toBe(DEFAULT_SELECTOR_CONTENT_HEIGHT - 8)
  })

  it('fills the unified popover content height for short model lists', () => {
    const item = makeModelItem('openai::gpt-4' as UniqueModelId)
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: [item],
        modelItems: [item]
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(screen.getByTestId('model-selector-content')).toHaveStyle({ height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px` })
    expect(mockVirtualListSizes.at(-1)).toBe(DEFAULT_SELECTOR_CONTENT_HEIGHT - 8)
  })

  it('clamps the visible model list height to the available popover space', async () => {
    mockAvailablePopoverHeight.value = 160
    mockSelectorChromeHeight(52)
    const items = Array.from({ length: 10 }, (_, index) => makeModelItem(`openai::model-${index}` as UniqueModelId))
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: items,
        modelItems: items
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    await waitFor(() => expect(mockVirtualListSizes.at(-1)).toBe(100))
  })

  it('honors a measured zero available list height', async () => {
    mockAvailablePopoverHeight.value = 52
    mockSelectorChromeHeight(52)
    mockUseModelSelectorData.mockReturnValue(makeData())

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    await waitFor(() => expect(mockVirtualListSizes.at(-1)).toBe(0))
  })
})
