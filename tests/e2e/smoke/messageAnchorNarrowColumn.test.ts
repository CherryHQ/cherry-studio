import { expect, test } from './fixtures/electron.fixture'

test('anchor rail stays visible and navigates to the first turn in a narrow message column', async ({
  electronApp,
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  await page.evaluate(async () => {
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('app.privacy.policy_version', '20260820')
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('chat.message.navigation_mode', 'anchor')
  })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })

  const topicName = 'anchor-rail-narrow'
  const { topicId, firstUserMessageId } = await page.evaluate(async (name) => {
    const create = async (path: string, body: Record<string, unknown>) => {
      const response = await window.api.dataApi.request({ id: crypto.randomUUID(), method: 'POST', path, body })
      if (response.status !== 201) throw new Error(`Seed ${path} failed: ${JSON.stringify(response)}`)
      return (response.data as { id: string }).id
    }
    const topicId = await create('/topics', { name })
    let firstUserMessageId = ''
    for (let turn = 1; turn <= 20; turn += 1) {
      for (const role of ['user', 'assistant'] as const) {
        const text =
          role === 'user'
            ? `Anchor question ${turn}`
            : `Anchor answer ${turn}. ${'Content long enough to scroll the narrow conversation. '.repeat(12)}`
        const messageId = await create(`/topics/${topicId}/messages`, {
          role,
          status: 'success',
          data: { parts: [{ type: 'text', text }] }
        })
        if (turn === 1 && role === 'user') firstUserMessageId = messageId
      }
    }
    return { topicId, firstUserMessageId }
  }, topicName)

  await page.evaluate(
    (topicId) => window.api.ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${topicId}` }),
    topicId
  )
  await page.getByRole('button', { name: topicName, exact: false }).first().click()
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.getTitle() === 'Cherry Studio')
        ?.setSize(size.width, size.height)
    },
    { width: 900, height: 700 }
  )
  // ResizeObserver and window-state restoration must settle before measuring the column.
  await page.waitForTimeout(800)

  const scrollers = page.locator('[data-message-virtual-list-scroller]')
  await expect
    .poll(() => scrollers.evaluateAll((nodes) => Math.max(0, ...nodes.map((node) => node.clientWidth))))
    .toBeGreaterThan(0)
  // The off-screen image-capture list must not supply our geometry or scroll target.
  const scrollerIndex = await scrollers.evaluateAll((nodes) => {
    const widths = nodes.map((node) => node.clientWidth)
    return widths.indexOf(Math.max(...widths))
  })
  const scroller = scrollers.nth(scrollerIndex)
  const columnWidth = await scroller.evaluate((node) => node.clientWidth)
  expect(columnWidth, `Expected a narrow message column; measured clientWidth=${columnWidth}px`).toBeLessThan(700)

  const messageList = scroller.locator('xpath=ancestor::*[@id="messages"][1]')
  // These layout classes identify the tick ancestor whose inert state caused #23283.
  const rail = messageList
    .locator('.absolute.right-4.bottom-8')
    .filter({ has: page.locator('[data-message-anchor-tick]') })
  const ticks = rail.locator('[data-message-anchor-tick]')
  await expect.poll(() => ticks.count()).toBeGreaterThanOrEqual(5)
  await expect.poll(() => rail.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(220)
  await expect(rail).not.toHaveAttribute('inert')
  await expect(rail).not.toHaveClass(/\bpointer-events-none\b/)
  const strip = rail.locator('.overflow-y-auto')
  await page.mouse.move(0, 0)
  await expect.poll(() => strip.evaluate((node) => getComputedStyle(node).opacity)).toBe('0.7')

  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(200)
  const firstUserIsInViewport = () =>
    scroller.evaluate((node, messageId) => {
      const message = node.querySelector(`[data-message-id="${messageId}"]`)
      if (!message) return false
      const box = message.getBoundingClientRect()
      const viewport = node.getBoundingClientRect()
      return (
        box.height > 0 &&
        box.width > 0 &&
        box.top >= viewport.top - 1 &&
        box.bottom <= viewport.bottom + 1 &&
        box.left < viewport.right &&
        box.right > viewport.left
      )
    }, firstUserMessageId)

  const screenshotPath = testInfo.outputPath('anchor-rail-narrow.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('anchor-rail-narrow', { path: screenshotPath, contentType: 'image/png' })

  await ticks.first().click()
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(200)
  await expect
    .poll(firstUserIsInViewport, { message: 'Clicking the first tick must bring turn 1 into the list viewport' })
    .toBe(true)
})
