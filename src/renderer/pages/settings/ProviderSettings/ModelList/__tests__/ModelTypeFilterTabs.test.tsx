import type * as CherryStudioUi from '@cherrystudio/ui'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelTypeFilterTabs } from '../ModelTypeFilterTabs'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

interface ResizeObserverMockInstance {
  callback: ResizeObserverCallback
  targets: Element[]
}

const originalResizeObserver = globalThis.ResizeObserver
const resizeObserverInstances: ResizeObserverMockInstance[] = []

function setElementSize(element: HTMLElement, sizes: { clientWidth: number; scrollWidth: number }) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: sizes.clientWidth },
    scrollLeft: { configurable: true, writable: true, value: 0 },
    scrollWidth: { configurable: true, value: sizes.scrollWidth }
  })
  Object.defineProperty(element.parentElement, 'clientWidth', {
    configurable: true,
    value: sizes.clientWidth
  })
}

function triggerResizeObserver() {
  const instance = resizeObserverInstances[0]
  if (!instance || instance.targets.length === 0) {
    throw new Error('Expected the model-type filter to use the shared horizontal scroll container')
  }

  act(() => {
    instance.callback(
      instance.targets.map((target) => ({ target }) as ResizeObserverEntry),
      {} as ResizeObserver
    )
  })
}

describe('ModelTypeFilterTabs', () => {
  beforeEach(() => {
    resizeObserverInstances.length = 0
    globalThis.ResizeObserver = vi.fn((callback: ResizeObserverCallback) => {
      const instance: ResizeObserverMockInstance = { callback, targets: [] }
      resizeObserverInstances.push(instance)

      return {
        observe: vi.fn((target: Element) => instance.targets.push(target)),
        disconnect: vi.fn()
      } as unknown as ResizeObserver
    }) as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    cleanup()
    globalThis.ResizeObserver = originalResizeObserver
  })

  it('offers horizontal controls when model-type tabs overflow', () => {
    render(
      <ModelTypeFilterTabs
        value="all"
        onValueChange={vi.fn()}
        counts={{ all: 9, text: 1, image: 1, embedding: 1, audio: 1, video: 1, rerank: 1, speech: 1, transcription: 1 }}
      />
    )

    const tabList = screen.getByRole('tablist')
    const scrollElement = tabList.closest('[data-scrolling]') as HTMLElement | null
    expect(scrollElement).not.toBeNull()
    setElementSize(scrollElement as HTMLElement, { clientWidth: 320, scrollWidth: 760 })

    triggerResizeObserver()

    expect(screen.queryByRole('button', { name: 'settings.models.filter.scroll_left' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'settings.models.filter.scroll_right' })).toBeInTheDocument()
    // Overflow ownership must stay on the shared container so it can calculate and control the scroll position.
    expect(tabList).toHaveClass('w-max', 'min-w-full', 'shrink-0')
    expect(tabList).not.toHaveClass('w-full', 'max-w-full', 'overflow-x-auto')
  })

  it('omits empty model types from the simplified filter row', () => {
    const counts = {
      all: 2,
      text: 2,
      image: 0,
      embedding: 0,
      audio: 0,
      video: 0,
      rerank: 0,
      speech: 0,
      transcription: 0
    }
    const { rerender } = render(
      <ModelTypeFilterTabs value="all" onValueChange={vi.fn()} counts={counts} hideEmptyFilters />
    )

    expect(screen.getByRole('tab', { name: /models\.all/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /models\.type\.text/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /models\.type\.image/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /models\.type\.embedding/ })).not.toBeInTheDocument()

    rerender(<ModelTypeFilterTabs value="image" onValueChange={vi.fn()} counts={counts} hideEmptyFilters />)
    expect(screen.getByRole('tab', { name: /models\.type\.image/ })).toBeInTheDocument()
  })
})
