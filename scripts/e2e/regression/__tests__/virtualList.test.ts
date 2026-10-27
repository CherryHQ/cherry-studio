import type { Locator, Page } from '@playwright/test'
import { afterEach, beforeEach, vi } from 'vitest'

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

beforeEach(() => vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback()))
afterEach(() => vi.unstubAllGlobals())

it('collects the final window, terminates at the bottom and resets the list', async () => {
  const { element, scroller, page } = listFixture()

  const text = await collectVirtualizedText(page, scroller)

  expect(text).toContain('First entry')
  expect(text).toContain('Last entry')
  expect(element.scrollTop).toBe(0)
})

it('waits for the first rendered window after resetting a previously scrolled list', async () => {
  let rendered = 'Later rows'
  const element = {
    scrollTop: 350,
    clientHeight: 100,
    scrollHeight: 450,
    get innerText() {
      return rendered
    }
  }
  const render = () => {
    rendered = element.scrollTop === 0 ? 'First row' : 'Later rows'
  }
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    render()
    callback()
  })
  const scroller = {
    evaluate: async (callback: (node: typeof element) => unknown) => callback(element)
  } as unknown as Locator
  const page = { waitForTimeout: async () => render() } as unknown as Page

  expect(await collectVirtualizedText(page, scroller)).toContain('First row')
})

it.each([true, false])('terminates when the final target is present=%s', async (present) => {
  const { element, scroller, page } = listFixture()
  const target = {
    count: async () => Number(present && element.scrollTop === 350),
    first: () => ({ isVisible: async () => true, scrollIntoViewIfNeeded: async () => {} })
  } as unknown as Locator

  await revealVirtualized(page, scroller, target)

  expect(element.scrollTop).toBe(350)
})

it('brings a mounted overscan entry into the visible scroll window', async () => {
  const { element, scroller, page } = listFixture()
  const rowTop = 180
  const rowHeight = 20
  const target = {
    count: async () => 1,
    first: () => ({
      isVisible: async () => true,
      scrollIntoViewIfNeeded: async () => {
        element.scrollTop = rowTop
      }
    })
  } as unknown as Locator

  await revealVirtualized(page, scroller, target)

  expect(rowTop).toBeGreaterThanOrEqual(element.scrollTop)
  expect(rowTop + rowHeight).toBeLessThanOrEqual(element.scrollTop + element.clientHeight)
})

it('reads a list shorter than its viewport without scrolling', async () => {
  const { element, scroller, page } = listFixture(50)

  expect(await collectVirtualizedText(page, scroller)).toBe('Last entry')
  expect(element.scrollTop).toBe(0)
})
