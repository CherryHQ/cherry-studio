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
  await expect.poll(() => section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.getByText(/^(Something went wrong|似乎出现了一些问题\.\.\.)$/)).toHaveCount(0)
}

export async function assertAgentContextDetails(page: Page): Promise<void> {
  const section = page
    .locator('section:visible')
    .filter({ has: page.getByRole('heading', { name: /^(Context usage|上下文用量)$/ }) })
    .last()
  await expect(section.getByRole('rowheader', { name: /^(Memory files|记忆文件)$/ })).toBeVisible()
  await expect(section.getByRole('rowheader', { name: /^(System tools|系统工具)$/ })).toBeVisible()
  const deferred = section.getByRole('row').filter({ hasText: /MCP.*(Deferred|延迟加载)/i })
  await expect(deferred).toContainText('—')
  const tools = section.getByRole('button', { name: /^MCP (tools|工具)/i })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  const details = page.locator(`[id="${await tools.getAttribute('aria-controls')}"]`)
  await expect(details.getByText(/^≈/).first()).toBeVisible()
  expect(await details.getByText(/^≈/).count()).toBeGreaterThan(1)
  await expect(details).not.toContainText('—')
  await expect.poll(() => section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await tools.click()
}
