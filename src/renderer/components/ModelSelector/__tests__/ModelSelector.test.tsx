import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode, Ref } from 'react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as UiIcons from '@cherrystudio/ui/icons'
import type * as ModelTags from '@renderer/components/tags/Model'
import { CommandRuntimeContext, type CommandHandler } from '@renderer/hooks/command'
import { toast } from '@renderer/services/toast'
import type * as ModelUtils from '@renderer/utils/model'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { SelectorShellBottomAction, SelectorShellProps } from '../../SelectorShell'
import { ModelSelector } from '../ModelSelector'
import type { FlatListItem, ModelSelectorModelItem, UseModelSelectorDataResult } from '../types'
import type * as ModelSelectorData from '../useModelSelectorData'

const mocks = vi.hoisted(() => ({
  bottomActions: [] as SelectorShellBottomAction[],
  loggerError: vi.fn(),
  openSettingsTab: vi.fn(),
  shellEvents: [] as string[],
  scrollToIndex: vi.fn(),
  virtualize: false,
  availableListHeight: undefined as number | undefined,
  useModelSelectorData: vi.fn(),
  displayTags: [] as string[]
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

vi.mock('@cherrystudio/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof UiIcons>()),
  useIcon: (ref: { meta: { id: string } } | undefined) =>
    ref ? () => <svg role="img" aria-label={`brand-${ref.meta.id}`} /> : undefined
}))

vi.mock('@renderer/utils/model', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelUtils>()),
  getModelLogoRef: () => undefined
}))

vi.mock('@renderer/components/tags/Model', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelTags>()),
  getModelDisplayTags: () => mocks.displayTags,
  ModelTag: ({ tag }: { tag: string }) => <span data-testid={`model-tag-${tag}`} />
}))

vi.mock('../ModelSelectorDetailCard', () => ({
  ModelSelectorDetailCard: ({ children, description }: { children: ReactNode; description?: ReactNode }) => (
    <>
      {children}
      {description}
    </>
  )
}))

vi.mock('@renderer/components/VirtualList', async () => {
  const React = await import('react')

  return {
    DynamicVirtualList: ({
      ref,
      list,
      children,
      keepMountedIndexes = [],
      size
    }: {
      ref?: Ref<{ scrollToIndex: typeof mocks.scrollToIndex }>
      list: FlatListItem[]
      children: (item: FlatListItem, index: number) => ReactNode
      keepMountedIndexes?: readonly number[]
      size: number
    }) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: mocks.scrollToIndex
      }))

      const renderedIndexes = mocks.virtualize
        ? new Set([...Array.from({ length: Math.min(6, list.length) }, (_, index) => index), ...keepMountedIndexes])
        : new Set(list.map((_, index) => index))

      return (
        <div data-testid="virtual-viewport" style={{ height: size }}>
          {list.map((item, index) =>
            renderedIndexes.has(index) ? <React.Fragment key={item.key}>{children(item, index)}</React.Fragment> : null
          )}
        </div>
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
    const content =
      typeof children === 'function' ? children({ availableListHeight: mocks.availableListHeight }) : children

    return (
      <>
        {trigger}
        {open ? (
          <div data-testid={dataTestId}>
            {search ? (
              <input
                aria-label={search.placeholder}
                aria-activedescendant={search.activeDescendant}
                aria-controls={search.ariaControls}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                onKeyDown={search.onKeyDown}
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
  settings: {},
  isEnabled: true
}

function makeModel(modelId: UniqueModelId): Model {
  return {
    id: modelId,
    providerId: provider.id,
    name: modelId.split('::')[1],
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
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
  const firstItem = makeModelItem('openai::gpt-4')
  const secondItem = makeModelItem('openai::gpt-3.5')
  const listItems: FlatListItem[] = [
    {
      key: 'provider-openai',
      type: 'group',

      groupKind: 'provider',
      provider,
      canNavigateToSettings: true
    },
    firstItem,
    secondItem
  ]

  const data = {
    availableTags: [],
    getModelPresentation: () => ({ tags: [] }),
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
    visibleSelectedModelIdSet: new Set<UniqueModelId>(),
    ...overrides
  }
  return { ...data, navigableItems: overrides.navigableItems ?? data.listItems.filter((item) => item.type !== 'group') }
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bottomActions = []
    mocks.shellEvents = []
    mocks.virtualize = false
    mocks.availableListHeight = undefined
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

  function quickJumpData() {
    const data = makeData()
    const otherProvider = { ...provider, id: 'custom-other', name: 'Other Provider' }
    return makeData({
      listItems: [
        { key: 'pinned', type: 'group', groupKind: 'pinned' },
        { ...data.modelItems[0], key: 'pinned-model', groupKind: 'pinned', isPinned: true },
        ...data.listItems,
        { key: 'provider-composed-group', type: 'group', groupKind: 'provider', provider: otherProvider }
      ]
    })
  }

  it.each([
    ['', 'custom-other', 'custom-other'],
    ['   ', '  custom-other  ', 'custom-other'],
    ['   ', '   ', 'models.detail.provider'],
    ['  Other Provider  ', 'custom-other', '  Other Provider  ']
  ])('shares a nonblank label across provider surfaces (%j, %j)', (name, id, label) => {
    const data = quickJumpData()
    const header = data.listItems.at(-1)!
    if (header.type === 'group' && header.provider) header.provider = { ...header.provider, name, id }
    mocks.useModelSelectorData.mockReturnValue(data)
    render(<ModelSelector multiple={false} open onSelect={() => {}} trigger={<button type="button">Open</button>} />)
    const button = within(screen.getByRole('group', { name: 'models.detail.provider' })).getByRole('button', {
      name: label.trim()
    })
    expect(button).toHaveAttribute('aria-label', label)
    if (!name.trim()) expect(button).toHaveTextContent(label[0])
    expect(within(screen.getByRole('listbox')).getByText(label.trim())).toBeInTheDocument()
  })

  it('preserves preset precedence and custom brand or uploaded logos in jump buttons', () => {
    const data = quickJumpData()
    const header = data.listItems.at(-1)!
    if (header.type !== 'group' || !header.provider) throw new Error('Missing provider fixture')
    header.provider = { ...header.provider, logo: 'icon:anthropic', logoSrc: 'https://example.com/upload.png' }
    const preset = data.listItems.find((item) => item.type === 'group' && item.provider?.id === 'openai')!
    if (preset.type === 'group' && preset.provider) preset.provider = { ...preset.provider, logo: 'icon:anthropic' }
    mocks.useModelSelectorData.mockReturnValue(data)
    const props = {
      multiple: false as const,
      open: true,
      onSelect: () => {},
      trigger: <button type="button">Open</button>
    }
    const view = render(<ModelSelector {...props} />)
    const group = screen.getByRole('group', { name: 'models.detail.provider' })
    expect(within(group).getByRole('button', { name: 'OpenAI' }).querySelector('svg')).toHaveAttribute(
      'aria-label',
      'brand-openai'
    )
    expect(within(group).getByRole('button', { name: 'Other Provider' }).querySelector('svg')).toHaveAttribute(
      'aria-label',
      'brand-anthropic'
    )
    header.provider = { ...header.provider, logo: undefined }
    mocks.useModelSelectorData.mockReturnValue({ ...data, listItems: [...data.listItems] })
    view.rerender(<ModelSelector {...props} />)
    expect(within(group).getByRole('button', { name: 'Other Provider' }).querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/upload.png'
    )
  })

  it('excludes pinned headers and preserves search, selection and active descendant when jumping to composed groups', async () => {
    mocks.useModelSelectorData.mockReturnValue(quickJumpData())
    render(
      <ModelSelector
        multiple
        open
        multiSelectMode
        value={['openai::gpt-4']}
        selectionType="id"
        onSelect={() => {
          throw new Error('Jump changed selection')
        }}
        trigger={<button type="button">Open</button>}
      />
    )
    const group = screen.getByRole('group', { name: 'models.detail.provider' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'))
    ).toEqual(['OpenAI', 'Other Provider'])
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'gpt' } })
    const activeId = input.getAttribute('aria-activedescendant')
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Other Provider' }))
    expect(input).toHaveValue('gpt')
    expect(input).toHaveAttribute('aria-activedescendant', activeId)
    expect(document.getElementById(activeId!)).toHaveAttribute('role', 'option')
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true')
    expect(document.querySelectorAll('[data-provider-jump-highlighted="true"]')).toHaveLength(1)
    expect(document.querySelector('[data-provider-jump-highlighted="true"]')).toHaveTextContent('Other Provider')
  })

  it('restarts same-target expiry and prevents an old timer clearing the next target', async () => {
    vi.useFakeTimers()
    mocks.useModelSelectorData.mockReturnValue(quickJumpData())
    const view = render(
      <ModelSelector multiple={false} open onSelect={() => {}} trigger={<button type="button">Open</button>} />
    )
    const click = (name: string) =>
      fireEvent.click(
        within(screen.getByRole('group', { name: 'models.detail.provider' })).getByRole('button', { name })
      )
    const highlighted = () => document.querySelector('[data-provider-jump-highlighted="true"]')
    click('Other Provider')
    await act(() => vi.advanceTimersByTime(1000))
    click('Other Provider')
    await act(() => vi.advanceTimersByTime(601))
    expect(highlighted()).toHaveTextContent('Other Provider')
    click('OpenAI')
    await act(() => vi.advanceTimersByTime(1000))
    expect(highlighted()).toHaveTextContent('OpenAI')
    await act(() => vi.advanceTimersByTime(600))
    expect(highlighted()).toBeNull()
    click('Other Provider')
    mocks.useModelSelectorData.mockReturnValue(makeData())
    view.rerender(
      <ModelSelector multiple={false} open onSelect={() => {}} trigger={<button type="button">Open</button>} />
    )
    expect(highlighted()).toBeNull()
    mocks.useModelSelectorData.mockReturnValue(quickJumpData())
    view.rerender(
      <ModelSelector multiple={false} open onSelect={() => {}} trigger={<button type="button">Open</button>} />
    )
    click('Other Provider')
    view.rerender(
      <ModelSelector multiple={false} open={false} onSelect={() => {}} trigger={<button type="button">Open</button>} />
    )
    view.rerender(
      <ModelSelector multiple={false} open onSelect={() => {}} trigger={<button type="button">Open</button>} />
    )
    expect(highlighted()).toBeNull()
    view.unmount()
    vi.useRealTimers()
  })

  it.each([undefined, 100, 20, 0])('deducts strip height once and clamps the %s body budget', (budget) => {
    mocks.availableListHeight = budget
    const data = quickJumpData()
    mocks.useModelSelectorData.mockReturnValue(data)
    const view = render(
      <ModelSelector multiple={false} open onSelect={() => {}} trigger={<button type="button">Open</button>} />
    )
    expect(screen.getByRole('listbox')).toHaveStyle({
      height: `${Math.max(0, (budget ?? 8 + data.listItems.length * 36) - 32)}px`
    })
    expect(screen.getByTestId('virtual-viewport')).toHaveStyle({
      height: `${Math.max(0, (budget ?? 8 + data.listItems.length * 36) - 32 - 8)}px`
    })
    mocks.useModelSelectorData.mockReturnValue(makeData())
    view.rerender(
      <ModelSelector multiple={false} open onSelect={() => {}} trigger={<button type="button">Open</button>} />
    )
    expect(screen.queryByRole('group', { name: 'models.detail.provider' })).toBeNull()
    expect(screen.getByRole('listbox')).toHaveStyle({ height: `${budget ?? 116}px` })
  })

  it('activates action rows without changing selection or showing pin/checkbox controls', async () => {
    const onAction = vi.fn()
    const onSelect = vi.fn()
    const action = {
      key: 'upgrade',
      type: 'action' as const,
      providerId: 'openai',
      label: 'Upgrade',
      identifier: 'upgrade',
      searchId: 'upgrade',
      tags: [],
      onAction
    }
    mocks.useModelSelectorData.mockReturnValue(makeData({ listItems: [action], modelItems: [] }))
    const user = userEvent.setup()
    render(
      <ModelSelector
        multiple
        open
        multiSelectMode
        value={[]}
        onSelect={onSelect}
        trigger={<button type="button">Open</button>}
      />
    )
    await user.click(screen.getByRole('option', { name: 'Upgrade' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'models.action.pin' })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledTimes(2)
    expect(onSelect).not.toHaveBeenCalled()
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

  it('describes and disables models the availability data marks unavailable', async () => {
    const user = userEvent.setup()
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        getModelPresentation: (model) => ({
          tags: [],
          description: model.name === 'gpt-4' ? 'Available description' : 'Disabled description',
          disabled: model.name === 'gpt-3.5'
        })
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    const searchInput = screen.getByRole('textbox', { name: 'models.search.placeholder' })
    const listbox = screen.getByRole('listbox')
    const [firstOption, secondOption] = screen.getAllByRole('option')

    await waitFor(() => expect(searchInput).toHaveAttribute('aria-activedescendant', firstOption.id))
    expect(searchInput).toHaveAttribute('aria-controls', listbox.id)
    expect(firstOption).toHaveAccessibleDescription('Available description')

    await user.keyboard('{ArrowDown}')

    await waitFor(() => expect(searchInput).toHaveAttribute('aria-activedescendant', secondOption.id))
    expect(secondOption).toHaveAttribute('aria-disabled', 'true')
    expect(secondOption).toHaveAccessibleDescription('Disabled description')
  })

  it('keeps the active descendant mounted after page navigation', async () => {
    const items = Array.from({ length: 20 }, (_, index) => makeModelItem(`openai::model-${index}`))
    mocks.virtualize = true
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        listItems: items,
        modelItems: items,
        selectableModelsById: new Map(items.map((item) => [item.modelId, item.model]))
      })
    )
    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    const searchInput = screen.getByRole('textbox', { name: 'models.search.placeholder' })
    fireEvent.keyDown(searchInput, { key: 'PageDown' })

    await waitFor(() =>
      expect(searchInput.getAttribute('aria-activedescendant')).toContain(encodeURIComponent('openai::model-12'))
    )
    expect(document.getElementById(searchInput.getAttribute('aria-activedescendant')!)).not.toBeNull()
  })

  it('honors the explicitly supplied disabled state', async () => {
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

  it('clears a single selection from the bottom option and closes the selector', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSelect = vi.fn()

    render(
      <ModelSelector
        open
        multiple={false}
        value={makeModel('openai::gpt-4')}
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

  it('preserves selected models from other providers after a recovery selection', async () => {
    const user = userEvent.setup()
    const firstModel = makeModel('openai::gpt-4')
    const replacement = makeModel('openai::gpt-3.5')
    const otherModel = { ...makeModel('anthropic::claude'), providerId: 'anthropic' }
    const models = [firstModel, replacement, otherModel]
    const providers = [provider, { ...provider, id: 'anthropic', name: 'Anthropic' }]
    mockUseQuery.mockImplementation((path) => ({
      data: path === '/models' ? models : path === '/providers' ? providers : [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue(undefined)
    }))
    const { useModelSelectorData } = await vi.importActual<typeof ModelSelectorData>('../useModelSelectorData')
    mocks.useModelSelectorData.mockImplementation(useModelSelectorData)
    let openRecovery!: CommandHandler
    const onSelect = vi.fn()
    render(
      <CommandRuntimeContext
        value={{
          execute: vi.fn(),
          hasHandler: () => true,
          registerHandler: (_command, handler) => {
            openRecovery = typeof handler === 'function' ? handler : handler.current
            return () => undefined
          }
        }}>
        <ModelSelector
          multiple
          multiSelectMode
          shortcut="chat.model.select"
          value={[firstModel, otherModel]}
          trigger={<button type="button">open</button>}
          onSelect={onSelect}
        />
      </CommandRuntimeContext>
    )

    act(() => void openRecovery({ providerId: provider.id }))
    expect(screen.queryByRole('option', { name: /claude$/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /gpt-3\.5$/ }))
    expect(onSelect).toHaveBeenLastCalledWith([firstModel, otherModel, replacement])
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
        resolvedSelectedModelIds: ['openai::gpt-4'],
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

  it('exposes the whole model name through a tooltip instead of a native title', () => {
    const longName = 'Deepseek: DeepSeek: DeepSeek V4.1 Flash (1017)'
    const item = makeModelItem(`openai::${longName}`)
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        listItems: [item],
        modelItems: [item],
        selectableModelsById: new Map([[item.modelId, item.model]])
      })
    )

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(within(screen.getByRole('option')).getByTestId('tooltip')).toHaveAttribute('data-title', longName)
  })

  it('shows an empty result when no models match', () => {
    mocks.useModelSelectorData.mockReturnValue(makeData({ listItems: [], modelItems: [] }))

    render(<ModelSelector open multiple={false} trigger={<button type="button">open</button>} onSelect={vi.fn()} />)

    expect(screen.getByText('models.no_matches')).toBeInTheDocument()
  })
})
