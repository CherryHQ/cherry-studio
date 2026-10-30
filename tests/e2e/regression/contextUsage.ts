import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function assertAgentContextUsage(
  page: Page,
  expected?: { tokens: number; window: number }
): Promise<void> {
  const title = /^(Context|上下文)$/
  const section = page
    .locator('section:visible')
    .filter({ has: page.getByRole('button', { name: title }) })
    .last()
  if (!(await section.isVisible())) await page.getByRole('button', { name: /^(Status|状态)$/ }).click()
  const toggle = section.getByRole('button', { name: title })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
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
  await expect(section).not.toContainText(/[≈~～]/)
  await expect.poll(() => section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.getByText(/^(Something went wrong|似乎出现了一些问题\.\.\.)$/)).toHaveCount(0)
}

export async function assertAgentContextDetails(page: Page): Promise<void> {
  const section = page
    .locator('section:visible')
    .filter({ has: page.getByRole('button', { name: /^(Context|上下文)$/ }) })
    .last()
  await expect(section.getByRole('rowheader', { name: /^(Memory files|记忆文件)$/ })).toBeVisible()
  await expect(section.getByRole('rowheader', { name: /^(System tools|系统工具)$/ })).toBeVisible()
  await expect(section.getByRole('meter').getByTitle(/^(Memory files|记忆文件)$/)).toBeAttached()
  await expect(section.getByRole('meter').getByTitle(/^(MCP tools|MCP 工具)$/)).toBeAttached()
  const deferred = section.getByRole('row').filter({ hasText: /MCP.*(Deferred|延迟加载)/i })
  await expect(deferred).toContainText('—')
  const tools = section.getByRole('button', { name: /^MCP (tools|工具)/i })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  const details = section.getByRole('list', { name: /^MCP (tools|工具)$/i })
  await expect(details.getByRole('listitem').first()).toBeVisible()
  expect(await details.getByRole('listitem').count()).toBeGreaterThan(1)
  await expect(details).not.toContainText('—')
  await expect(details).not.toContainText(/mcp__|[≈~～]/)
  await expect(details).toContainText(' · ')
  const lastTool = details.getByRole('listitem').last()
  await lastTool.scrollIntoViewIfNeeded()
  await expect(lastTool).toBeInViewport()
  await expect.poll(() => section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await tools.click()
  const memory = section.getByRole('button', { name: /^(Memory files|记忆文件)/ })
  if ((await memory.getAttribute('aria-expanded')) !== 'true') await memory.click()
  await expect(section.getByRole('list', { name: /^(Memory files|记忆文件)$/ })).not.toContainText(/[\\/]/)
  await memory.click()
  const toggle = section.getByRole('button', { name: /^(Context|上下文)$/ })
  await toggle.click()
  await expect(section.getByRole('table')).toBeHidden()
  const compactMeter = section.getByRole('meter')
  await expect(compactMeter).toBeVisible()
  await expect(compactMeter).toHaveAttribute('aria-valuemax', '100')
  const bounds = await compactMeter.boundingBox()
  expect(bounds?.width).toBeGreaterThanOrEqual(16)
  expect(bounds?.height).toBeGreaterThanOrEqual(16)
  await toggle.press('Enter')
  await expect(section.getByRole('table')).toBeVisible()
}
