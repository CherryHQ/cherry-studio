import type { Locator, Page } from '@playwright/test'
import { afterEach, vi } from 'vitest'

import { collectVirtualizedText, revealVirtualized } from '../../../../tests/e2e/regression/helpers/virtualList'

// Model the browser's clamped scroll position; unbounded bottom polling used to exhaust the wait budget.
function listFixture(scrollHeight = 450) {
  let position = 0
  let waits = 0
  const element = {
    clientHeight: 100,
    scrollHeight,
    get scrollTop() {
      return position
    },
    set scrollTop(value: number) {
      position = Math.max(0, Math.min(value, scrollHeight - this.clientHeight))
    },
    get innerText() {
      return position >= scrollHeight - this.clientHeight ? 'Last entry' : 'First entry'
    }
  }
  const scroller = {
    evaluate: async (callback: (node: typeof element) => unknown) => callback(element)
  } as unknown as Locator
  const page = {
    waitForTimeout: async () => {
      if (++waits > 10) throw new Error('List traversal exceeded its window budget')
    }
  } as unknown as Page
  return { element, scroller, page }
}

afterEach(() => vi.unstubAllGlobals())

it('collects the final window, terminates at the bottom and resets the list', async () => {
  const { element, scroller, page } = listFixture()

  const text = await collectVirtualizedText(page, scroller)

  expect(text).toContain('First entry')
  expect(text).toContain('Last entry')
  expect(element.scrollTop).toBe(0)
})

it.each([true, false])('terminates when the final target is present=%s', async (present) => {
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback())
  const { element, scroller, page } = listFixture()
  const target = {
    count: async () => Number(present && element.scrollTop === 350),
    first: () => ({ isVisible: async () => true })
  } as unknown as Locator

  await revealVirtualized(page, scroller, target)

  expect(element.scrollTop).toBe(350)
})

it('reads a list shorter than its viewport without scrolling', async () => {
  const { element, scroller, page } = listFixture(50)

  expect(await collectVirtualizedText(page, scroller)).toBe('Last entry')
  expect(element.scrollTop).toBe(0)
})
