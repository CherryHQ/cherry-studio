import type { Page } from '@playwright/test'

import { APP_URL, composerInput, gotoApp, send, setUpAssistant, sidebarApps, test, useMockProvider } from './appPage'
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
    'Archive',
    'About & Feedback'
  ])
  expect(pageErrors).toEqual([])
})

test('leaves out the entries for desktop and Cherry account services', async ({ page }) => {
  await page.goto(APP_URL)
  // CherryIN signs in through a callback on the computer, which a Web page cannot receive.
  await expect(page.getByRole('button', { name: 'Set up another provider' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect CherryIN' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Set up later' }).click()
  await composerInput(page).waitFor()

  await expect(page.getByRole('button', { name: 'Help' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /dictation/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'User', exact: true }).click()
  const panel = page.getByRole('dialog')
  await expect(panel.getByRole('button')).toHaveText(['Enter your name', 'Settings'])
  await expect(panel.getByRole('radio')).toHaveCount(3)
})

test('leaves out the entries a browser tab cannot carry out', async ({ page }) => {
  const run = Date.now().toString(36)
  await gotoApp(page)
  await useMockProvider(page, run)
  await gotoApp(page)
  await send(page, `topic ${run}`)
  await expect(page.getByText(`echo: topic ${run}`)).toBeVisible()
  // The app is one tab: no tab or conversation opens in a window of its own.
  await expect(page.getByRole('button', { name: 'Open in New Window' })).toHaveCount(0)
  await page.getByRole('button', { name: 'More' }).first().click()
  await page
    .getByTestId('topic-list-row')
    .filter({ hasText: `topic ${run}` })
    .click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Edit conversation name' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Open in New Window' })).toHaveCount(0)
  // Notes are files on the computer; knowledge bases index files with the desktop's native libraries.
  await expect(page.getByRole('menuitem', { name: 'Save to Notes' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Save to Knowledge Base' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Model Provider', exact: true }).click()
  await page.getByTestId('provider-list-item-cherryin').click()
  await expect(page.getByText('API Key', { exact: true }).first()).toBeVisible()
  // Sign-in popups cannot report back to this cross-origin isolated page; CLI logins need a computer.
  await expect(page.getByRole('button', { name: 'Authorize with CherryIN' })).toHaveCount(0)
  for (const id of ['claude-code', 'openai-codex', 'grok-cli', 'copilot']) {
    await expect(page.getByTestId(`provider-list-item-${id}`)).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Add Provider' }).click()
  const editor = page.getByTestId('provider-editor-dialog')
  await expect(editor.getByRole('button', { name: 'Builtin avatar' })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Image Upload' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // The browser zooms, updates and debugs the page itself.
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await expect(page.getByText('Theme', { exact: true })).toBeVisible()
  await expect(page.getByText('Page Zoom', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'About & Feedback', exact: true }).click()
  await expect(page.getByText('Official Website', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check Update' })).toHaveCount(0)
  await expect(page.getByText('Debug', { exact: true })).toHaveCount(0)
})

test('keeps the agent browser off in a workspace that had it on', async ({ page }) => {
  type PreferenceApi = {
    preference: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
  }
  const keys = ['app.browser.agent_control.enabled', 'app.browser.open_links_in_browser']
  await gotoApp(page)
  // As a workspace created before the Web edition turned these off has them.
  await page.evaluate(async (keys) => {
    for (const key of keys) await (window.api as unknown as PreferenceApi).preference.set(key, true)
  }, keys)

  await page.reload()
  await composerInput(page).waitFor()
  const values = await page.evaluate(
    (keys) => Promise.all(keys.map((key) => (window.api as unknown as PreferenceApi).preference.get(key))),
    keys
  )
  expect(values).toEqual([false, false])
})

test('saves a reply as a Markdown download', async ({ page }) => {
  await gotoApp(page)
  await useMockProvider(page, Date.now().toString(36))
  await setUpAssistant(page)
  await gotoApp(page)
  await send(page, 'save me')
  await expect(page.getByText('echo: save me')).toBeVisible()

  await page.getByText('echo: save me').hover()
  await page.getByRole('button', { name: 'More actions' }).click()
  // Notes and knowledge bases are desktop features.
  await expect(page.getByRole('menuitem', { name: 'Save to Notes' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Save', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Save to Local File' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^\d{12}\.md$/)
  expect(await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString())).toBe(
    'echo: save me'
  )
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

test('opens links in a new tab and answers the device type from the browser', async ({
  page,
  context,
  browserName
}) => {
  await context.route('https://cherry-ai.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '' }))
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'About & Feedback', exact: true }).click()
  const opened = context.waitForEvent('page', { timeout: 10_000 })
  const row = page.getByText('Official Website', { exact: true }).locator('xpath=ancestor::*[.//button][1]')
  await row.getByRole('button', { name: 'Website', exact: true }).click()
  await (await opened).waitForURL('https://cherry-ai.com/')

  const deviceType = await page.evaluate(async () => {
    const api = window.api as unknown as { ipcApi: { request(route: string): Promise<{ data: unknown }> } }
    return (await api.ipcApi.request('system.get_device_type')).data
  })
  // The Desktop Chrome and Firefox profiles present Windows; Desktop Safari presents a Mac.
  const expected = browserName === 'webkit' ? 'mac' : 'windows'
  expect(deviceType).toBe(expected)
})

test('archives a chat topic from the topic list and restores it from Settings', async ({ page }) => {
  const run = Date.now().toString(36)
  const message = `topic to archive ${run}`
  await gotoApp(page)
  await useMockProvider(page, run)
  await gotoApp(page)
  await composerInput(page).click()
  await page.keyboard.type(message)
  await page.keyboard.press('Enter')
  await expect(page.getByText(`echo: ${message}`)).toBeVisible()
  await expect.poll(() => replyStatus(page)).toBe('success')

  // "More" on the assistant lists its topics.
  await page.getByRole('button', { name: 'More' }).first().click()
  const row = page.getByTestId('topic-list-row').filter({ hasText: message })
  // The row's buttons take pointer events only while it is hovered or focused.
  await row.getByRole('button', { name: 'Archive', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(row).toHaveCount(0)
  await expect.poll(() => topicNames(page)).not.toContain(message)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('tabpanel').getByRole('button', { name: 'Restore' }).click()
  await expect.poll(() => topicNames(page)).toContain(message)
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

function topicNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const response = await window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: '/topics' })
    return (response.data as { items: { name: string }[] }).items.map(({ name }) => name)
  })
}
