import type { Page } from '@playwright/test'

import { composerInput, gotoApp, sidebarApps, test, useMockProvider } from './appPage'
import { expect } from './fixtures'

test('runs the desktop main window with only the Web edition features', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await gotoApp(page)

  await expect(sidebarApps(page)).toHaveCount(2)
  expect(await sidebarApps(page).evaluateAll((buttons) => buttons.map((button) => button.ariaLabel))).toEqual([
    'Work',
    'Chat'
  ])

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('[data-ui~="part:menu-item"]')).toHaveText([
    'Model Provider',
    'Default Model',
    'General',
    'Appearance',
    'About & Feedback'
  ])
  expect(pageErrors).toEqual([])
})

test('tells a second tab that the app is already open instead of loading forever', async ({ page, context }) => {
  await gotoApp(page)

  const second = await context.newPage()
  await second.goto(page.url())
  await expect(second.getByText('Cherry Studio is already open in another tab.')).toBeVisible()
  await expect(second.getByRole('button', { name: 'Reload' })).toBeVisible()
})

test('chats through the desktop composer and keeps the conversation across a reload', async ({ page }) => {
  const run = Date.now().toString(36)
  const message = `hello from the web page ${run}`
  await gotoApp(page)
  await useMockProvider(page, run)
  await gotoApp(page)

  await composerInput(page).click()
  await page.keyboard.type(message)
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(page.getByText(`echo: ${message}`)).toBeVisible()
  // The reply shows while it streams; reloading before the turn is saved would end the turn.
  await expect.poll(() => replyStatus(page)).toBe('success')

  await gotoApp(page)
  await expect(page.getByText(message, { exact: true })).toBeVisible()
  await expect(page.getByText(`echo: ${message}`)).toBeVisible()
})

test('keeps a reply cut off by a reload and says it was interrupted', async ({ page }) => {
  await gotoApp(page)
  await useMockProvider(page, Date.now().toString(36))
  await gotoApp(page)

  // The mock sends "partial" and never finishes the reply.
  await composerInput(page).click()
  await page.keyboard.type('please hang')
  await page.keyboard.press('Enter')
  const messages = page.getByLabel('Messages')
  await expect(messages.getByText('partial', { exact: true })).toBeVisible()
  // A streaming reply is saved about once a second.
  await page.waitForTimeout(2_000)

  await gotoApp(page)
  await expect(messages.getByText('partial', { exact: true })).toBeVisible()
  await expect(messages.getByText(/^This reply was interrupted because the app closed\./)).toBeVisible()
})

test('runs no script from HTML in a reply, in its preview or in a link', async ({ page }) => {
  await gotoApp(page)
  await useMockProvider(page, Date.now().toString(36))
  await gotoApp(page)

  const injected = "window.injected = 'reply'"
  const reply = [
    `Inline <img src="x" onerror="${injected}"> and <script>${injected}</script> HTML.`,
    "[A link](javascript:window.injected='link')",
    "```html\n<p>Preview body</p><script>parent.injected = 'preview'; navigator.storage.getDirectory().then(() => (parent.injected = 'opfs'))</script>\n```"
  ].join('\n\n')
  await composerInput(page).click()
  await page.keyboard.type(`say ${JSON.stringify(reply)}`)
  await page.keyboard.press('Enter')
  const messages = page.getByLabel('Messages')
  await expect(messages.getByText(/^Inline .* HTML\.$/)).toBeVisible()
  await expect(
    page.frameLocator('[data-testid="message-html-artifact"] iframe').getByText('Preview body')
  ).toBeVisible()

  await expect(messages.getByText('A link', { exact: true })).toBeVisible()
  await expect(page.locator('a[href^="javascript:" i]')).toHaveCount(0)
  expect(await page.evaluate(() => (window as { injected?: string }).injected)).toBeUndefined()
})

/** Status of the latest message in the only topic. */
function replyStatus(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const request = (path: string) => window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path })
    const topics = (await request('/topics')).data as { items: { activeNodeId: string | null }[] }
    const tip = topics.items[0]?.activeNodeId
    return tip ? ((await request(`/messages/${tip}`)).data as { status: string }).status : undefined
  })
}
