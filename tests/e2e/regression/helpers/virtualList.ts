import type { Locator, Page } from '@playwright/test'

/**
 * Virtualized lists render only their visible window, so the whole list is read by
 * scrolling it from top to bottom and keeping the text of every window on the way.
 */
export async function collectVirtualizedText(page: Page, scroller: Locator): Promise<string> {
  const windows: string[] = []
  await scroller.evaluate((element) => {
    element.scrollTop = 0
  })
  for (let step = 0; step < 100; step += 1) {
    windows.push(await scroller.evaluate((element) => (element as HTMLElement).innerText))
    const moved = await scroller.evaluate((element) => {
      const next = Math.min(element.scrollTop + element.clientHeight * 0.8, element.scrollHeight)
      if (next <= element.scrollTop) return false
      element.scrollTop = next
      return true
    })
    if (!moved) break
    await page.waitForTimeout(200)
  }
  await scroller.evaluate((element) => {
    element.scrollTop = 0
  })
  return windows.join('\n')
}

/** Scroll a virtualized list until the target entry is part of the rendered window. */
export async function revealVirtualized(page: Page, scroller: Locator, target: Locator): Promise<void> {
  await scroller.evaluate(async (element) => {
    element.scrollTop = 0
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  for (let step = 0; step < 100; step += 1) {
    if ((await target.count()) > 0 && (await target.first().isVisible())) return
    const moved = await scroller.evaluate((element) => {
      const next = Math.min(element.scrollTop + element.clientHeight * 0.8, element.scrollHeight)
      if (next <= element.scrollTop) return false
      element.scrollTop = next
      return true
    })
    if (!moved) return
    await page.waitForTimeout(200)
  }
}
