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
    try {
      await runTest(electronApp)
    } finally {
      await electronApp.close()
      await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
    }
  }
})

async function requireBox(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Expected a bounding box for ${locator.toString()}`)
  return box
}

async function settledBox(locator: Locator) {
  let previous = await requireBox(locator)
  let stableSamples = 0
  await expect
    .poll(
      async () => {
        const current = await requireBox(locator)
        stableSamples =
          Math.abs(current.height - previous.height) <= 0.1 && Math.abs(current.y - previous.y) <= 0.1
            ? stableSamples + 1
            : 0
        previous = current
        return stableSamples
      },
      { intervals: [100], timeout: 10000 }
    )
    .toBeGreaterThanOrEqual(4)
  return previous
}

test('manual composer height survives paste and typing while auto sizing still grows', async ({
  electronApp,
  mainWindow: page
}, testInfo) => {
  await page.evaluate(async () => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'app.privacy.policy_version': '20260820',
      'chat.narrow_mode': false,
      'chat.input.paste_long_text_as_file': false,
      'chat.input.send_message_shortcut': ['CommandOrControl', 'Enter']
    })
  })
  await page.reload()
  await page.waitForSelector('#root')

  const referenceText = 'Reference message above the manually resized composer.'
  const topicId = await page.evaluate(async (text) => {
    const assistantResponse = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: '/assistants',
      body: { name: 'Composer manual height smoke' }
    })
    if (assistantResponse.error) throw new Error(assistantResponse.error.message)
    const assistant = assistantResponse.data as { id: string }
    const topicResponse = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: '/topics',
      body: { name: 'Composer manual height smoke', assistantId: assistant.id }
    })
    if (topicResponse.error) throw new Error(topicResponse.error.message)
    const topic = topicResponse.data as { id: string }
    const messageResponse = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'POST',
      path: `/topics/${topic.id}/messages`,
      body: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text }] } }
    })
    if (messageResponse.error) throw new Error(messageResponse.error.message)
    return topic.id
  }, referenceText)

  await page.reload()
  await page.waitForSelector('#root')
  await page.evaluate(
    (id) => window.api.ipcApi.request('navigation.open_route_in_main', { path: `/app/chat?topicId=${id}` }),
    topicId
  )
  await page.bringToFront()

  const composer = page.locator('[data-ui~="chat.composer"]').filter({ visible: true }).first()
  const frame = composer.locator('[data-composer-editor-frame]')
  const handle = composer.locator('[data-composer-resize-handle]')
  const editor = frame.locator('[contenteditable="true"]')
  const viewport = frame.locator('[data-slot="scroll-area-viewport"]')
  const reference = page.getByText(referenceText, { exact: true })
  await expect(editor).toBeVisible()
  await expect(reference).toBeVisible()
  await expect.poll(async () => Number(await handle.getAttribute('aria-valuemax'))).toBeGreaterThan(400)

  const initial = await settledBox(frame)
  const minHeight = Number(await handle.getAttribute('aria-valuemin'))
  const maxHeight = Number(await handle.getAttribute('aria-valuemax'))
  const targetHeight = Math.round((minHeight + maxHeight) / 2)
  const grip = await requireBox(handle)
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - (targetHeight - initial.height), {
    steps: 10
  })
  await page.mouse.up()
  await expect(composer.getByRole('button', { name: 'Restore', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const f0 = await settledBox(frame)
  expect(Math.abs(f0.height - targetHeight)).toBeLessThanOrEqual(1)
  expect(f0.height).toBeGreaterThan(initial.height + 100)
  const referenceBefore = await settledBox(reference)

  const text = Array.from(
    { length: 80 },
    (_, index) => `Pasted line ${index + 1}: keep this draft inside the editor.`
  ).join('\n')
  const pasteShortcut = process.platform === 'darwin' ? 'Meta+V' : 'Control+V'
  await editor.click()
  await electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
  await page.keyboard.press(pasteShortcut)
  await expect(editor).toHaveText(text, { useInnerText: true })
  const pasted = await settledBox(frame)
  expect(Math.abs(pasted.height - f0.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(pasted.y - f0.y)).toBeLessThanOrEqual(1)
  const referenceAfter = await settledBox(reference)
  expect(Math.abs(pasted.y - referenceAfter.y - (f0.y - referenceBefore.y))).toBeLessThanOrEqual(1)

  await page.keyboard.type('\nTyped after paste\nand another line')
  await expect(editor).toContainText('and another line')
  const typed = await settledBox(frame)
  expect(Math.abs(typed.height - f0.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(typed.y - f0.y)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('manual-height-after-paste.png') })

  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0)
  await viewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)
  await viewport.hover()
  await page.mouse.wheel(0, 200)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('manual-height-scrolled-inside.png') })

  await composer.locator('[data-composer-expand-corner]').hover()
  await composer.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(composer.getByRole('button', { name: 'Expand', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.press('Backspace')
  await expect(editor).toHaveText('')
  const emptyAuto = await settledBox(frame)
  expect(emptyAuto.height).toBeLessThan(f0.height)

  await electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
  await page.keyboard.press(pasteShortcut)
  await expect(editor).toHaveText(text, { useInnerText: true })
  const auto = await settledBox(frame)
  expect(auto.height).toBeGreaterThanOrEqual(emptyAuto.height + 200)
  expect(Math.abs(auto.height - Number(await handle.getAttribute('aria-valuemax')))).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('auto-fit-grows.png') })
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(0)
  await viewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0)
  await viewport.hover()
  await page.mouse.wheel(0, 200)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})
