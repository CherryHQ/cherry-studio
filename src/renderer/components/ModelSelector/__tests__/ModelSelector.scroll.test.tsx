import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type * as IconLibrary from '@cherrystudio/ui/icons'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { ModelSelector } from '../ModelSelector'
import type { ModelSelectorModelItem, UseModelSelectorDataOptions } from '../types'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof IconLibrary>()),
  useIcon: () => undefined
}))
vi.mock('../useModelSelectorData', () => ({
  useModelSelectorData: ({ selectedModelIds = [] }: UseModelSelectorDataOptions) => ({
    availableTags: [],
    getModelPresentation: () => ({ tags: [] }),
    isLoading: false,
    isPinActionDisabled: false,
    listItems: items,
    modelItems: items,
    navigableItems: items,
    pinnedIds: [],
    refetchModels: async () => {},
    refetchPinnedModels: async () => {},
    refetchProviders: async () => {},
    resetTags: () => {},
    resolvedSelectedModelIds: selectedModelIds,
    selectableModelsById: new Map(items.map((item) => [item.modelId, item.model])),
    selectedTags: [],
    sortedProviders: [provider],
    tagSelection: {},
    togglePin: async () => {},
    toggleTag: () => {},
    visibleSelectedModelIdSet: new Set(selectedModelIds)
  })
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
const items: ModelSelectorModelItem[] = Array.from({ length: 50 }, (_, index) => {
  const id = `openai::model-${index}` as UniqueModelId
  return {
    key: id,
    type: 'model',
    groupKind: 'provider',
    provider,
    modelId: id,
    modelIdentifier: `model-${index}`,
    isPinned: false,
    showIdentifier: false,
    model: {
      id,
      providerId: provider.id,
      name: `Model ${index}`,
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    }
  }
})
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')

beforeEach(() => {
  // Supply browser geometry while retaining the real portal and virtualizer lifecycles.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? 36 : 200
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1800)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0
      fireEvent.scroll(this)
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

// The shell mounts its portal after the selector's initial layout effect.
it.each(['destroy', 'lazy-keep'] as const)('reveals the current model on opening a %s list', async (mountStrategy) => {
  const view = (open: boolean, index: number) => (
    <ModelSelector
      open={open}
      multiple={false}
      value={items[index].model}
      mountStrategy={mountStrategy}
      trigger={<button type="button">Choose model</button>}
      onSelect={vi.fn()}
    />
  )
  const { rerender } = render(view(false, 40))
  const viewport = () => document.querySelector('.dynamic-virtual-list') as HTMLElement
  rerender(view(true, 40))
  await waitFor(() => expect(viewport()?.scrollTop).toBeGreaterThan(1200))
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Model 40')

  rerender(view(false, 20))
  rerender(view(true, 20))
  await waitFor(() => {
    expect(viewport()?.scrollTop).toBeGreaterThan(500)
    expect(viewport()?.scrollTop).toBeLessThan(1000)
  })
  expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Model 20')
})
