import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelSelector } from '../ModelSelector'
import type { FlatListItem, ModelSelectorModelItem, UseModelSelectorDataResult } from '../types'

const { mockUseModelSelectorData, mockNavigate, mockScrollToIndex, mockLoggerError, mockVirtualListSizes } = vi.hoisted(
  () => ({
    mockUseModelSelectorData: vi.fn(),
    mockNavigate: vi.fn(),
    mockScrollToIndex: vi.fn(),
    mockLoggerError: vi.fn(),
    mockVirtualListSizes: [] as number[]
  })
)

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mockLoggerError,
      warn: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate
}))

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: (id: string) => id
}))

vi.mock('@cherrystudio/ui/icons', () => ({
  resolveIcon: () => null
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
    Input: ({
      ref,
      ...props
    }: InputHTMLAttributes<HTMLInputElement> & { ref?: RefObject<HTMLInputElement | null> }) => (
      <input ref={ref} {...props} />
    ),
    Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PopoverContent: ({
      children,
      ...props
    }: HTMLAttributes<HTMLDivElement> & { side?: string; align?: string; sideOffset?: number }) => {
      const { side, align, sideOffset, ...contentProps } = props
      void side
      void align
      void sideOffset

      return <div {...contentProps}>{children}</div>
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
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
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

vi.mock('../useModelSelectorData', () => ({
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
    isSelected: false,
    showIdentifier: false,
    ...overrides
  }
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
    refetchPinnedModels: vi.fn(),
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
    ...overrides
  }
}

describe('ModelSelector', () => {
  beforeEach(() => {
    mockUseModelSelectorData.mockReset()
    mockNavigate.mockReset()
    mockScrollToIndex.mockReset()
    mockLoggerError.mockReset()
    mockVirtualListSizes.length = 0
    mockNavigate.mockResolvedValue(undefined)
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

  it('keeps keyboard focus stable when multi-select value changes while open', async () => {
    const selectedSecond = makeModelItem('openai::gpt-3.5' as UniqueModelId, { isSelected: true })
    const selectedFirst = makeModelItem('openai::gpt-4' as UniqueModelId, { isSelected: true })
    const unselectedFirst = makeModelItem('openai::gpt-4' as UniqueModelId)
    const firstData = makeData({
      listItems: [unselectedFirst, selectedSecond],
      modelItems: [unselectedFirst, selectedSecond],
      resolvedSelectedModelIds: ['openai::gpt-3.5' as UniqueModelId]
    })
    const secondData = makeData({
      listItems: [selectedFirst, selectedSecond],
      modelItems: [selectedFirst, selectedSecond],
      resolvedSelectedModelIds: ['openai::gpt-4' as UniqueModelId, 'openai::gpt-3.5' as UniqueModelId]
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

    await waitFor(() => expect(mockScrollToIndex).toHaveBeenCalledWith(1, { align: 'auto' }))
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

  it('navigates from provider settings without selecting a model', async () => {
    mockUseModelSelectorData.mockReturnValue(makeData())
    const onSelect = vi.fn()

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={onSelect} />)

    fireEvent.click(screen.getByLabelText('navigate.provider_settings'))

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings/provider', search: { id: 'openai' } })
    )
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('uses listVisibleCount to size the visible model list', () => {
    const items = Array.from({ length: 10 }, (_, index) => makeModelItem(`openai::model-${index}` as UniqueModelId))
    mockUseModelSelectorData.mockReturnValue(
      makeData({
        listItems: items,
        modelItems: items
      })
    )

    render(
      <ModelSelector
        open
        multiple={false}
        listVisibleCount={8}
        trigger={<button type="button">open</button>}
        onSelect={vi.fn()}
      />
    )

    expect(mockVirtualListSizes.at(-1)).toBe(8 * 36)
  })
})
