import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as UiIcons from '@cherrystudio/ui/icons'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { SelectorShellProps } from '../../SelectorShell'
import { ModelSelector } from '../ModelSelector'
import type { ModelSelectorModelItem, UseModelSelectorDataResult } from '../types'

vi.mock('@cherrystudio/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof UiIcons>()),
  useIcon: () => undefined
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: vi.fn() }))
vi.mock('../ModelSelectorDetailCard', () => ({
  ModelSelectorDetailCard: ({ children }: { children: ReactNode }) => children
}))
// Keep the real virtualizer; this boundary supplies the popup's kept-mounted visibility.
vi.mock('@renderer/components/SelectorShell', () => ({
  SelectorShell: ({ open, children }: SelectorShellProps) => (
    <div hidden={!open}>{typeof children === 'function' ? children({ availableListHeight: 200 }) : children}</div>
  )
}))
vi.mock('../useModelSelectorData', () => ({ useModelSelectorData: () => data }))

const provider: Provider = {
  id: 'openai',
  name: 'OpenAI',
  apiKeys: [],
  authType: 'api-key',
  reportsActualCost: false,
  settings: {},
  isEnabled: true
}
const models: Model[] = Array.from({ length: 10 }, (_, index) => ({
  id: `openai::model-${index}` as UniqueModelId,
  providerId: provider.id,
  name: `Model ${index}`,
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}))
const items: ModelSelectorModelItem[] = models.map((model) => ({
  key: model.id,
  type: 'model',
  groupKind: 'provider',
  model,
  provider,
  modelId: model.id,
  modelIdentifier: model.name,
  isPinned: false,
  showIdentifier: false
}))
const data: UseModelSelectorDataResult = {
  availableTags: [],
  getModelDescription: () => undefined,
  isModelUnavailable: () => false,
  isLoading: false,
  isPinActionDisabled: false,
  listItems: items,
  modelItems: items,
  pinnedIds: [],
  refetchModels: vi.fn(),
  refetchPinnedModels: vi.fn(),
  refetchProviders: vi.fn(),
  resetTags: vi.fn(),
  resolvedSelectedModelIds: [],
  selectableModelsById: new Map(models.map((model) => [model.id, model])),
  selectedTags: [],
  sortedProviders: [provider],
  tagSelection: {} as UseModelSelectorDataResult['tagSelection'],
  togglePin: vi.fn(async () => undefined),
  toggleTag: vi.fn(),
  visibleSelectedModelIdSet: new Set()
}

describe('ModelSelector kept-mounted measurements', () => {
  const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
  const observers = new Set<{ callback: ResizeObserverCallback; elements: Set<Element> }>()
  let hiddenMeasurements = 0
  const height = (element: Element) => (element.closest('[hidden]') ? 0 : element.hasAttribute('data-index') ? 36 : 200)

  const notifyResize = () =>
    act(() => {
      for (const observer of observers) {
        const entries = [...observer.elements].map((target) => ({
          target,
          get borderBoxSize() {
            if (target.hasAttribute('data-index') && height(target) === 0) hiddenMeasurements++
            return [{ blockSize: height(target), inlineSize: 400 }]
          }
        }))
        observer.callback(entries as ResizeObserverEntry[], observer as unknown as ResizeObserver)
      }
    })

  beforeEach(() => {
    observers.clear()
    hiddenMeasurements = 0
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return height(this)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.stubGlobal(
      'ResizeObserver',
      class {
        elements = new Set<Element>()
        constructor(public callback: ResizeObserverCallback) {
          observers.add(this)
        }
        observe(element: Element) {
          this.elements.add(element)
        }
        unobserve(element: Element) {
          this.elements.delete(element)
        }
        disconnect() {
          this.elements.clear()
        }
      }
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  })

  afterEach(() => {
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not overwrite row heights with zero while a reusable menu is hidden', () => {
    const props = { multiple: false as const, trigger: <button type="button">Models</button>, onSelect: vi.fn() }
    const { rerender } = render(<ModelSelector {...props} open mountStrategy="lazy-keep" />)
    expect(screen.getByRole('option', { name: /Model 0$/ })).toBeInTheDocument()
    notifyResize()

    rerender(<ModelSelector {...props} open={false} mountStrategy="lazy-keep" />)
    notifyResize()

    // Hidden zero measurements made rows share their initial position on the next opening.
    expect(hiddenMeasurements).toBe(0)
    rerender(<ModelSelector {...props} open mountStrategy="lazy-keep" />)
    expect(screen.getByRole('option', { name: /Model 0$/ })).toBeInTheDocument()
  })
})
