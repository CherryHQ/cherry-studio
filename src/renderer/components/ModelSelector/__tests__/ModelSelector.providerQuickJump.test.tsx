import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createContext, type ReactNode, startTransition, Suspense, use, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import type * as UiIcons from '@cherrystudio/ui/icons'
import type * as ModelTags from '@renderer/components/tags/Model'
import type * as ModelUtils from '@renderer/utils/model'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { ModelSelector } from '../ModelSelector'
import type { FlatListItem, ModelSelectorModelItem, UseModelSelectorDataResult } from '../types'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  openSettingsTab: vi.fn(),
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
  useIcon: () => undefined
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

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')

function makeLongData() {
  const models = Array.from({ length: 60 }, (_, i) => makeModelItem(`openai::model-${i}`))
  const other = { ...provider, id: 'custom-other', name: 'Other Provider' }
  const header: FlatListItem = { key: 'provider-composed', type: 'group', groupKind: 'provider', provider: other }
  return makeData({
    listItems: [
      { key: 'pinned', type: 'group', groupKind: 'pinned' },
      { ...models[0], key: 'pinned-model', groupKind: 'pinned', isPinned: true },
      { key: 'provider-openai', type: 'group', groupKind: 'provider', provider },
      ...models.slice(0, 40),
      header,
      ...models.slice(40)
    ],
    modelItems: models,
    selectableModelsById: new Map(models.map((item) => [item.modelId, item.model]))
  })
}

beforeEach(() => {
  mocks.useModelSelectorData.mockReturnValue(makeLongData())
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? 36 : 200
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2304)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.hasAttribute('data-index') ? 36 : 200
    return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: height, width: 400, height, toJSON() {} }
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0
      fireEvent.scroll(this)
    }
  })
})

afterEach(() => {
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('provider quick jump with the real shell and virtual list', () => {
  it('names the provider button and heading when display-name resolution returns undefined', () => {
    const unnamedProvider = { ...provider, id: 'custom-unnamed' }
    Reflect.deleteProperty(unnamedProvider, 'name')
    const data = makeData()
    mocks.useModelSelectorData.mockReturnValue(
      makeData({
        listItems: [
          { key: 'provider-unnamed', type: 'group', groupKind: 'provider', provider: unnamedProvider },
          ...data.listItems
        ]
      })
    )

    render(
      <ModelSelector
        multiple={false}
        open
        showTagFilter={false}
        onSelect={() => {}}
        trigger={<button type="button">Open</button>}
      />
    )

    const strip = screen.getByRole('group', { name: 'models.detail.provider' })
    expect(within(strip).getByRole('button', { name: 'custom-unnamed' })).toBeInTheDocument()
    expect(within(screen.getByRole('listbox')).getByText('custom-unnamed')).toBeInTheDocument()
  })

  it.each([
    [2304, 1512],
    [1500, 1300]
  ])('lands below sticky padding with scroll-range clamping (%s px content)', async (contentHeight, expectedOffset) => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(contentHeight)
    render(
      <ModelSelector
        multiple={false}
        open
        showTagFilter={false}
        onSelect={() => {
          throw new Error('Jump selected a model')
        }}
        trigger={<button type="button">Open</button>}
      />
    )
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'model' } })
    input.focus()
    const activeId = input.getAttribute('aria-activedescendant')
    const group = screen.getByRole('group', { name: 'models.detail.provider' })
    expect(document.querySelector('[data-provider-jump-highlighted="true"]')).toBeNull()
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Other Provider' }))
    await waitFor(() => {
      const header = document.querySelector('[data-provider-jump-highlighted="true"]')
      expect(header).toHaveTextContent('Other Provider')
      const scroller = screen.getByRole('listbox').querySelector('[data-slot="scroll-area-viewport"]')
      expect(scroller?.scrollTop).toBe(expectedOffset)
    })
    expect(input).toHaveFocus()
    expect(input).toHaveValue('model')
    expect(input).toHaveAttribute('aria-activedescendant', activeId)
    expect(document.getElementById(activeId!)).toHaveAttribute('role', 'option')
    expect(document.querySelectorAll('[data-provider-jump-highlighted="true"]')).toHaveLength(1)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })
  it('keeps buttons Tab reachable and native Enter/Space activation separate from list navigation', async () => {
    const selected: (UniqueModelId | undefined)[] = []
    const openChanges: boolean[] = []
    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <ModelSelector
          multiple={false}
          selectionType="id"
          open={open}
          onOpenChange={(nextOpen) => {
            openChanges.push(nextOpen)
            setOpen(nextOpen)
          }}
          showTagFilter={false}
          onSelect={(id) => {
            selected.push(id)
          }}
          trigger={<button type="button">Open</button>}
        />
      )
    }
    render(<Host />)
    const user = userEvent.setup()
    const input = screen.getByRole('textbox')
    input.focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'OpenAI' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Other Provider' })).toHaveFocus()
    const scroller = screen.getByRole('listbox').querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
    const scrollOffsets: number[] = []
    scroller.addEventListener('scroll', () => scrollOffsets.push(scroller.scrollTop))
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const activationCount = () => timers.mock.calls.filter(([, delay]) => delay === 1600).length
    await user.keyboard('{Enter>}')
    await waitFor(() =>
      expect(document.querySelector('[data-provider-jump-highlighted="true"]')).toHaveTextContent('Other Provider')
    )
    await waitFor(() => expect(scrollOffsets).toEqual([1512]))
    expect(activationCount()).toBe(1)
    await user.keyboard('{/Enter}')
    await act(() => new Promise((resolve) => window.requestAnimationFrame(resolve)))
    expect(selected).toEqual([])
    expect(scrollOffsets).toEqual([1512])
    expect(openChanges).toEqual([])
    expect(activationCount()).toBe(1)
    scrollOffsets.length = 0
    await user.tab({ shift: true })
    await user.keyboard('[Space>]')
    await act(() => new Promise((resolve) => window.requestAnimationFrame(resolve)))
    expect(activationCount()).toBe(1)
    await user.keyboard('[/Space]')
    await act(() => new Promise((resolve) => window.requestAnimationFrame(resolve)))
    await waitFor(() =>
      expect(document.querySelector('[data-provider-jump-highlighted="true"]')).toHaveTextContent('OpenAI')
    )
    expect(selected).toEqual([])
    await waitFor(() => expect(scrollOffsets).toEqual([36]))
    expect(activationCount()).toBe(2)
    expect(openChanges).toEqual([])
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    input.focus()
    const activeOption = () => document.getElementById(input.getAttribute('aria-activedescendant')!)
    await user.keyboard('{ArrowDown}')
    expect(activeOption()).toHaveTextContent('model-0')
    await user.keyboard('{PageDown}')
    expect(activeOption()).toHaveTextContent('model-12')
    await user.keyboard('{PageUp}{ArrowUp}')
    expect(activeOption()).toHaveTextContent('model-0')
    await user.keyboard('{Enter}')
    expect(selected).toEqual(['openai::model-0'])
  })

  // Suspended filtering must not publish row indexes or reject a still-visible provider.
  it.each(['validation', 'frame'])('uses committed rows during suspended filtering (%s)', async (phase) => {
    const initialData = makeLongData()
    const filteredItems = initialData.listItems.filter((_, index) => index < 3 || index >= 13)
    const filteredData = makeData({
      listItems:
        phase === 'validation'
          ? initialData.listItems.slice(initialData.listItems.findIndex((item) => item.key === 'provider-composed'))
          : filteredItems
    })
    const DataContext = createContext(initialData)
    mocks.useModelSelectorData.mockImplementation(() => use(DataContext))
    const suspended = new Promise<never>(() => {})
    let attemptedFilter = false
    let updateData: (data: UseModelSelectorDataResult) => void = () => {}
    function SuspendFilter() {
      if (use(DataContext) === filteredData) {
        attemptedFilter = true
        throw suspended
      }
      return null
    }
    function Host() {
      const [data, setData] = useState(initialData)
      updateData = setData
      return (
        <Suspense fallback={<span>Loading filtered rows</span>}>
          <DataContext value={data}>
            <ModelSelector
              multiple={false}
              open
              showTagFilter={false}
              onSelect={() => {}}
              trigger={<button type="button">Open</button>}
            />
            <SuspendFilter />
          </DataContext>
        </Suspense>
      )
    }
    render(<Host />)
    await act(() => new Promise((resolve) => window.requestAnimationFrame(resolve)))
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextId, callback)
      return nextId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    const button = screen.getByRole('button', { name: phase === 'validation' ? 'OpenAI' : 'Other Provider' })
    if (phase === 'frame') fireEvent.click(button)
    act(() => startTransition(() => updateData(filteredData)))
    expect(attemptedFilter).toBe(true)
    expect(button).toBeInTheDocument()
    expect(screen.queryByText('Loading filtered rows')).toBeNull()
    if (phase === 'validation') fireEvent.click(button)
    act(() => {
      for (const [id, callback] of frames) {
        frames.delete(id)
        callback(performance.now())
      }
    })
    expect(screen.getByRole('listbox').querySelector('[data-slot="scroll-area-viewport"]')?.scrollTop).toBe(
      phase === 'validation' ? 36 : 1512
    )
    act(() => updateData(initialData))
  })

  // A queued jump must resolve the target key after filtering, rather than reuse its old index.
  it.each([false, true])('uses the current viewport target after list mutation (removed: %s)', async (removed) => {
    const props = {
      multiple: false as const,
      open: true,
      showTagFilter: false,
      onSelect: () => {},
      trigger: <button type="button">Open</button>
    }
    const view = render(<ModelSelector {...props} />)
    await act(() => new Promise((resolve) => window.requestAnimationFrame(resolve)))
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextId, callback)
      return nextId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Other Provider' }))
    const data = makeLongData()
    const filteredItems = data.listItems.filter((_, index) => index < 3 || index >= 13)
    const withoutTarget = filteredItems.slice(
      0,
      filteredItems.findIndex((item) => item.key === 'provider-composed')
    )
    mocks.useModelSelectorData.mockReturnValue(makeData({ listItems: removed ? withoutTarget : filteredItems }))
    view.rerender(<ModelSelector {...props} />)
    if (removed) {
      mocks.useModelSelectorData.mockReturnValue(makeData({ listItems: filteredItems }))
      view.rerender(<ModelSelector {...props} />)
    }
    act(() => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(performance.now()))
    })
    const scroller = screen.getByRole('listbox').querySelector('[data-slot="scroll-area-viewport"]')!
    expect(scroller.scrollTop).toBe(removed ? 0 : 1152)
    if (!removed)
      expect(document.querySelector('[data-provider-jump-highlighted="true"]')).toHaveTextContent('Other Provider')
    else expect(document.querySelector('[data-provider-jump-highlighted="true"]')).toBeNull()
  })

  // A stalled frame must not jump when an expired target disappears and later returns.
  it('leaves the viewport still when an expired queued target returns', async () => {
    const props = {
      multiple: false as const,
      open: true,
      showTagFilter: false,
      onSelect: () => {},
      trigger: <button type="button">Open</button>
    }
    const view = render(<ModelSelector {...props} />)
    await act(() => new Promise((resolve) => window.requestAnimationFrame(resolve)))
    vi.useFakeTimers()
    const frames = new Map<number, FrameRequestCallback>()
    let nextId = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++nextId, callback)
      return nextId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Other Provider' }))
    await act(() => vi.advanceTimersByTime(1600))
    mocks.useModelSelectorData.mockReturnValue(makeData())
    view.rerender(<ModelSelector {...props} />)
    mocks.useModelSelectorData.mockReturnValue(makeLongData())
    view.rerender(<ModelSelector {...props} />)
    act(() => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(performance.now()))
    })
    expect(screen.getByRole('listbox').querySelector('[data-slot="scroll-area-viewport"]')?.scrollTop).toBe(0)
    expect(document.querySelector('[data-provider-jump-highlighted="true"]')).toBeNull()
    view.unmount()
  })

  it.each([1, 20, 32, 36, 100, 440])('clamps measured body allocation for a %s px body', async (bodyHeight) => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      const height = this.hasAttribute('data-selector-shell-chrome') ? (440 - bodyHeight) / 2 : 36
      return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: height, width: 400, height, toJSON() {} }
    })
    render(
      <ModelSelector
        multiple={false}
        open
        showTagFilter={false}
        onSelect={() => {}}
        trigger={<button type="button">Open</button>}
      />
    )
    expect(within(screen.getByRole('group', { name: 'models.detail.provider' })).getAllByRole('button')).toHaveLength(2)
    await waitFor(() =>
      expect(screen.getByRole('listbox')).toHaveStyle({ height: `${Math.max(0, bodyHeight - 32)}px` })
    )
    await waitFor(() =>
      expect(screen.getByRole('listbox').querySelector('[data-slot="scroll-area"]')).toHaveStyle({
        height: `${Math.max(0, bodyHeight - 32 - 8)}px`
      })
    )
  })
})
