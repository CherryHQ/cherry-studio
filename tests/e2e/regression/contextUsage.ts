import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function assertAgentContextUsage(
  page: Page,
  expected?: { tokens: number; window: number }
): Promise<void> {
  const title = /^(Context usage|上下文用量)$/
  const section = page
    .locator('section:visible')
    .filter({ has: page.getByRole('heading', { name: title }) })
    .last()
  if (!(await section.isVisible())) await page.getByRole('button', { name: /^(Status|状态)$/ }).click()
  const meter = section.getByRole('meter')
  await expect(meter).toBeVisible({ timeout: 30_000 })
  const used = Number(await meter.getAttribute('aria-valuenow'))
  const capacity = Number(await meter.getAttribute('aria-valuemax'))
  expect(used).toBeGreaterThan(0)
  expect(capacity).toBeGreaterThan(used)
  if (expected) {
    expect(used).toBe(expected.tokens)
    expect(capacity).toBe(expected.window)
  }
  await expect(section.getByRole('table')).toBeVisible()
  await expect(section).toContainText('≈')
  expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.getByText(/^(Something went wrong|似乎出现了一些问题\.\.\.)$/)).toHaveCount(0)
}
