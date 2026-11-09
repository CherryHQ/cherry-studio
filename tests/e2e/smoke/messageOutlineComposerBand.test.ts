import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, runTest, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot },
      timeout: 60000
    })
    await runTest(electronApp)
    await electronApp.close()
    await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
  }
})

// The transform-derived token on the component root; present in both the fixed
// and unfixed builds, and the element whose box the fix bounds.
const RAIL_ROOT = '[data-ui~="chat.message-outline"]'
// The authored token on the interactive scroll box (fixed code only); use it
// for the visible strip's geometry, hover scoping, and the heading click.
const RAIL_STRIP = '[data-ui~="part:message-outline"]'

interface Box {
  height: number
  width: number
  x: number
  y: number
}

async function requireBox(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Expected a bounding box for ${locator.toString()}`)
  return box
}

test('message outline rail clears the composer band and keeps working above it', async ({
  mainWindow: page
}, testInfo) => {
  await page.evaluate(async () => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'app.privacy.policy_version': '20260820',
      'chat.message.show_outline': true,
      // A full-width composer puts the input card's left edge under the rail's
      // left strip without resizing the window, which would race the app's
      // own window-state restoration.
      'chat.narrow_mode': false
    })
  })
  await page.reload()
  await page.waitForSelector('#root')

  const topicId = await page.evaluate(async () => {
    const text = Array.from({ length: 40 }, (_, index) => `## Heading ${index}`).join('\n\n')
    const assistantResponse = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: '/assistants',
      body: { name: `Outline composer band ${Date.now()}` }
    })
    if (assistantResponse.error) throw new Error(assistantResponse.error.message)
    const assistant = assistantResponse.data as { id: string }
    const topicResponse = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: '/topics',
      body: { name: `Outline composer band ${Date.now()}`, assistantId: assistant.id }
    })
    if (topicResponse.error) throw new Error(topicResponse.error.message)
    const topic = topicResponse.data as { id: string }
    const message = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: `/topics/${topic.id}/messages`,
      body: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text }] } }
    })
    if (message.error) throw new Error(message.error.message)
    return topic.id
  })

  await page.reload()
  await page.waitForSelector('#root')
  await page.evaluate(
    (id) => window.api.ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${id}` }),
    topicId
  )

  const railRoot = page.locator(RAIL_ROOT).filter({ visible: true }).first()
  const railStrip = page.locator(RAIL_STRIP).filter({ visible: true }).first()
  const dockSurface = page.locator('[data-composer-dock-surface]').filter({ visible: true }).first()
  const inputbar = page.locator('[data-composer-inputbar]').filter({ visible: true }).first()
  const messageScroller = page.locator('[data-message-virtual-list-scroller]').filter({ visible: true }).first()
  await railRoot.waitFor()
  await dockSurface.waitFor()
  await inputbar.waitFor()

  // Case A — a grown composer: the rail must clear the input card and stop
  // stealing its hover and click (the reported bug).
  const composerInput = page.locator('[data-ui~="chat.composer"] [contenteditable]').filter({ visible: true }).first()
  await composerInput.click()
  // One long draft, no Enter — the composer must grow without mutating the
  // conversation the rail is outlining.
  const targetDockHeight = 0.35 * (await page.evaluate(() => window.innerHeight))
  for (let chunk = 0; chunk < 12; chunk += 1) {
    await composerInput.pressSequentially('grow the composer band ')
    const dockHeight = (await requireBox(dockSurface)).height
    if (dockHeight >= targetDockHeight) break
    await page.waitForTimeout(150)
  }
  // Let the dock transition and the overlay-inset measurement settle.
  await page.waitForTimeout(600)

  // The growth step stayed a draft: the text is still in the composer and no
  // queued-message dock appeared.
  await expect(composerInput).toContainText('grow the composer band')
  await expect(page.getByText(/^Queued \(\d+\)$/)).toHaveCount(0)
  // A composer tall enough to hide the rail would make every later assertion
  // vacuous — fail the fixture here instead of passing silently.
  await expect(railRoot).toBeVisible()

  // The bug assertion: on the unfixed baseline the root is inset-y-0, so its
  // bottom sits far below the composer top. No strip lookup before this passes.
  const grownRootBox = await requireBox(railRoot)
  const grownDockBox = await requireBox(dockSurface)
  expect(grownRootBox.y + grownRootBox.height).toBeLessThanOrEqual(grownDockBox.y - 16 + 1)

  await railStrip.waitFor()
  const grownStripBox = await requireBox(railStrip)
  expect(grownStripBox.y + grownStripBox.height).toBeLessThanOrEqual(grownDockBox.y - 16 + 1)
  const viewportHeight = await page.evaluate(() => window.innerHeight)
  expect(grownStripBox.height).toBeLessThanOrEqual(0.7 * viewportHeight + 1)

  const inputBox = await requireBox(inputbar)
  const point = { x: Math.round(inputBox.x + 10), y: Math.round(inputBox.y + 20) }
  const hit = await page.evaluate((probe) => {
    const element = document.elementFromPoint(probe.x, probe.y)
    return {
      hitsComposer: Boolean(element?.closest('[data-ui~="chat.composer"]')),
      hitsOutline: Boolean(element?.closest('[data-ui~="chat.message-outline"], [data-ui~="part:message-outline"]'))
    }
  }, point)
  expect(hit.hitsComposer).toBe(true)
  expect(hit.hitsOutline).toBe(false)

  await page.mouse.move(point.x, point.y)
  await expect(railStrip.getByText('Heading 1', { exact: true })).toBeHidden()

  // Evidence shot: hover the strip itself so the labels fade in before the
  // capture, making the rail visible against the grown composer band.
  await railStrip.hover()
  await page.waitForTimeout(250)
  const screenshotPath = testInfo.outputPath('rail-vs-composer.png')
  await page.bringToFront()
  await page.waitForTimeout(250)
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('rail-vs-composer', { path: screenshotPath, contentType: 'image/png' })

  // Case B — the rail still works and stays viewport-anchored while the
  // composer is short.
  await composerInput.fill('')
  // Let the dock transition and the overlay-inset measurement settle.
  await page.waitForTimeout(600)

  await expect(railStrip).toBeVisible()
  const shortRailBox = await requireBox(railStrip)
  const shortDockBox = await requireBox(dockSurface)
  const scrollerBox = await requireBox(messageScroller)
  expect(shortRailBox.y + shortRailBox.height).toBeLessThanOrEqual(shortDockBox.y - 16 + 1)
  const bandCentre = (scrollerBox.y + shortDockBox.y) / 2
  expect(Math.abs(shortRailBox.y + shortRailBox.height / 2 - bandCentre)).toBeLessThanOrEqual(40)

  // Scroll the long message so the first heading starts off-screen; the rail
  // must stay put (viewport-anchored).
  await messageScroller.hover()
  await page.mouse.wheel(0, 10000)
  await page.waitForTimeout(500)
  const scrolledRailBox = await requireBox(railStrip)
  expect(Math.abs(scrolledRailBox.y - shortRailBox.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(scrolledRailBox.height - shortRailBox.height)).toBeLessThanOrEqual(1)

  await expect(railStrip.getByText(/^Heading \d+$/)).toHaveCount(40)
  // Heading-click navigation is covered by the MessageOutline unit tests; the
  // E2E only proves the strip is interactive and clear of the composer.
  await railStrip.hover()
  await page.waitForTimeout(300)
  await expect(railStrip.getByText('Heading 0', { exact: true })).toBeVisible()
  await page.mouse.move(0, 0)
})
