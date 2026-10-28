import { execFileSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import sharp from 'sharp'

import type { SelectionFilterMode, SelectionTriggerMode } from '@shared/data/preference/preferenceTypes'
import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import { computerUseRequestSchemas } from '@shared/ipc/schemas/computerUse'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import {
  saveNativeFile,
  sendSystemHotkey,
  closeExternalText,
  openExternalText
} from '../../../../scripts/e2e/regression/systemAutomation'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { expect, test } from '../fixture'
import {
  computerUseMain,
  nativeComputerUse,
  readNativePermission,
  stopNativeDesktopControl
} from '../helpers/computerUseNative'
import { openLaunchpad, selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection, closeSettings } from '../helpers/settings'
import { globalSearch } from '../scenarios/globalSearch'
import { launchpadPinning } from '../scenarios/launchpadPinning'
import { singleInstanceRelaunch } from '../scenarios/singleInstanceRelaunch'
import { systemTrayMenu } from '../scenarios/systemTrayMenu'

test(...caseDefinition('MP-127'), async ({ app, mainWindow: page }, testInfo) => {
  const screenshot = async (target: typeof page, name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(target, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  if (app.record.platform !== 'macos') throw new Error('UNCOVERED: MP-127 requires macOS Accessibility permissions')
  await openSettingsSection(page, 'Selection Assistant')
  const trusted = await page.evaluate(async () => {
    const response = (await window.api.ipcApi.request('system.mac.is_process_trusted')) as {
      ok: boolean
      data?: boolean
      error?: { message: string }
    }
    if (!response.ok) throw new Error(response.error?.message)
    return response.data
  })
  if (!trusted) {
    await page.getByRole('switch').first().click()
    const permission = page.getByRole('dialog', { name: 'Accessibility Permission', exact: true })
    await expect(permission).toContainText('Accessibility Permission')
    await expect(permission.getByRole('button', { name: 'Open Accessibility Settings', exact: true })).toBeVisible()
    await screenshot(page, 'MP-127 accessibility permission required')
    await page.keyboard.press('Escape')
    // Missing Accessibility trust is a prerequisite gap, not a regression: the controller
    // records skipped as blocked, while a throw would be reported as a product failure.
    test.skip(true, 'UNCOVERED: macOS has not granted Accessibility permission to the test application')
  }

  // Real native selection and UI; only the external model HTTP responses are mocked.
  const server = await startMockChatServer()
  const providerId = `mp127-${Date.now()}`
  const original = 'The early bird catches the worm. Preparation and timely action improve the chances of success.'
  const preferenceKeys = [
    'feature.selection.enabled',
    'feature.selection.trigger_mode',
    'feature.selection.action_items',
    'feature.selection.auto_pin',
    'feature.selection.auto_close',
    'feature.selection.filter_mode',
    'shortcut.selection.capture_text',
    'feature.translate.model_id',
    'feature.translate.auto_detection_method'
  ] as const
  const previous = await page.evaluate(async (keys) => {
    const entries = await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)]))
    return Object.fromEntries(entries)
  }, preferenceKeys)
  let assistantId: string | undefined
  try {
    const assistant = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp127-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-127 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock', key: 'mock-api-key', isEnabled: true }]
          }
        })
        if (provider.status !== 201) throw new Error('Could not create MP-127 provider')
        const enabled = await window.api.dataApi.request({
          id: 'mp127-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        if (enabled.status !== 200) throw new Error('Could not enable MP-127 provider')
        const models = await window.api.dataApi.request({
          id: 'mp127-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        if (models.status !== 201) throw new Error('Could not create MP-127 model')
        return window.api.dataApi.request({
          id: 'mp127-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name: 'MP-127 Selection', modelId: `${providerId}::${modelId}` }
        })
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    await page.evaluate(
      async ({ assistantId, modelId }) => {
        const items = await window.api.preference.get('feature.selection.action_items')
        await window.api.preference.setMultiple({
          'feature.selection.action_items': items.map((item) => ({
            ...item,
            assistantId,
            enabled: ['explain', 'translate', 'copy'].includes(item.id)
          })),
          'feature.selection.trigger_mode': 'shortcut' as SelectionTriggerMode,
          'feature.selection.filter_mode': 'default' as SelectionFilterMode,
          'feature.selection.auto_pin': false,
          'feature.selection.auto_close': false,
          'feature.translate.model_id': modelId,
          'feature.translate.auto_detection_method': 'franc',
          'shortcut.selection.capture_text': { binding: ['CommandOrControl', 'Alt', 'Shift', 'S'], enabled: true },
          'feature.selection.enabled': true
        })
      },
      { assistantId, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    await expect(page.getByRole('switch').first()).toHaveAttribute('aria-checked', 'true')
    await closeSettings(page)

    const textFile = `${app.paths.fixtures}/MP-127-selection.txt`
    await writeFile(textFile, original)
    const invoke = async () => {
      openExternalText('macos', app.paths, textFile)
      await expect
        .poll(() => {
          execFileSync(
            'osascript',
            [
              '-e',
              'tell application "TextEdit" to activate',
              '-e',
              'tell application "System Events" to tell process "TextEdit"',
              '-e',
              'set frontmost to true',
              '-e',
              'set focused of text area 1 of scroll area 1 of window 1 to true',
              '-e',
              'keystroke "a" using command down',
              '-e',
              'end tell'
            ],
            { timeout: 10_000 }
          )
          return execFileSync(
            'osascript',
            [
              '-e',
              'tell application "System Events" to tell process "TextEdit" to get value of attribute "AXSelectedText" of text area 1 of scroll area 1 of window 1'
            ],
            { encoding: 'utf8', timeout: 10_000 }
          ).trim()
        })
        .toBe(original)
      sendSystemHotkey('macos', ['Meta', 'Alt', 'Shift', 's'])
      const toolbar = await app.window('/windows/selection/toolbar/')
      await expect(toolbar.getByRole('button', { name: 'Explain', exact: true })).toBeVisible()
      const position = await toolbar.evaluate(() => ({ x: screenX, y: screenY }))
      const bounds = execFileSync(
        'osascript',
        ['-e', 'tell application "System Events" to tell process "TextEdit" to get {position, size} of window 1'],
        { encoding: 'utf8', timeout: 10_000 }
      )
        .trim()
        .split(', ')
        .map(Number)
      expect(position.x).toBeGreaterThanOrEqual(bounds[0] - 50)
      expect(position.x).toBeLessThanOrEqual(bounds[0] + bounds[2] + 50)
      expect(position.y).toBeGreaterThanOrEqual(bounds[1] - 50)
      expect(position.y).toBeLessThanOrEqual(bounds[1] + bounds[3] + 50)
      return toolbar
    }
    for (const action of ['Explain', 'Translate']) {
      const toolbar = await invoke()
      await screenshot(toolbar, `MP-127 native selection toolbar ${action}`)
      await toolbar.getByRole('button', { name: action, exact: true }).click()
      let resultWindow: typeof page | undefined
      await expect
        .poll(async () => {
          for (const candidate of page.context().pages()) {
            if (
              candidate.url().includes('/windows/selection/action/') &&
              (await candidate.title()) === `${action} - Selection Assistant` &&
              (await candidate.evaluate(() => !document.hidden))
            ) {
              resultWindow = candidate
              return true
            }
          }
          return false
        })
        .toBe(true)
      if (!resultWindow) throw new Error(`${action} result window was not shown`)
      const result = resultWindow
      const request = await server.nextRequest(30_000)
      expect(request.body.model).toBe(server.modelId)
      expect(JSON.stringify(request.body.messages)).toContain(original)
      const answer =
        action === 'Explain'
          ? 'The proverb means that people who prepare and act early have a better chance of success.'
          : '早起的鸟儿有虫吃。充分准备并及时行动会增加成功的机会。'
      request.complete(Array.from({ length: 45 }, (_, index) => `Paragraph ${index + 1}: ${answer}`).join('\n\n'))
      await expect(result.getByText(`Paragraph 45: ${answer}`, { exact: true })).toBeAttached({ timeout: 30_000 })
      await result.getByRole('button', { name: 'Show Original', exact: true }).click()
      await expect(result.getByText(original, { exact: true })).toBeVisible()
      await screenshot(result, `MP-127 ${action} result and original`)
      const scrollable = result
        .locator('[data-ui~="selection.action"]')
        .locator('div')
        .filter({ has: result.getByText(original, { exact: true }) })
      const scroll = await scrollable.evaluateAll((elements) => {
        const node = elements.find(
          (element) =>
            element.scrollHeight > element.clientHeight &&
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
        )
        if (!node) return null
        node.scrollTop = node.scrollHeight
        const bottom = node.scrollTop
        node.scrollTop = 0
        return bottom
      })
      expect(scroll).toBeGreaterThan(0)
      const pin = result.getByRole('button', { name: 'Pin', exact: true })
      await pin.hover()
      await expect(result.getByRole('tooltip', { name: 'Pin', exact: true })).toBeVisible()
      await pin.click()
      await result.getByRole('button', { name: 'Pinned', exact: true }).hover()
      await expect(result.getByRole('tooltip', { name: 'Pinned', exact: true })).toBeVisible()
      const copy = result.getByRole('button', { name: 'Copy Original', exact: true })
      await copy.hover()
      await expect(result.getByRole('tooltip', { name: 'Copy Original', exact: true })).toBeVisible()
      await copy.click()
      await expect.poll(() => execFileSync('pbpaste', { encoding: 'utf8', timeout: 10_000 })).toBe(original)
      await result.keyboard.press('Escape')
      await expect
        .poll(() =>
          execFileSync(
            'osascript',
            [
              '-e',
              `tell application "System Events" to tell (first application process whose unix id is ${app.record.electronPid}) to exists window "${action} - Selection Assistant"`
            ],
            { encoding: 'utf8', timeout: 10_000 }
          ).trim()
        )
        .toBe('false')
      expect(
        execFileSync(
          'osascript',
          [
            '-e',
            'tell application "System Events" to tell process "TextEdit" to get value of text area 1 of scroll area 1 of window 1'
          ],
          {
            encoding: 'utf8',
            timeout: 10_000
          }
        ).trim()
      ).toBe(original)
    }
  } finally {
    closeExternalText('macos')
    await server.close()
    await page.evaluate(
      async ({ previous, providerId, assistantId }) => {
        await window.api.preference.setMultiple(previous)
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp127-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { previous, providerId, assistantId }
    )
  }
})

test(...caseDefinition('MP-128'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(180_000)
  const permission = await page.evaluate(() => window.api.ipcApi.request('system.mac.screen_capture_status'))
  expect(permission, 'UNCOVERED: screen recording permission is required').toMatchObject({
    ok: true,
    data: 'authorized'
  })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

  const original = await page.evaluate(async () => ({
    enabled: await window.api.preference.get('feature.screenshot.enabled'),
    autoOcr: await window.api.preference.get('feature.screenshot.auto_ocr'),
    shortcut: await window.api.preference.get('shortcut.screenshot.capture')
  }))
  const screenshot = async (window: Page, name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(window, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  let overlay: Page | undefined
  const drag = async (window: Page, x: number, y: number, width: number, height: number) => {
    await window.mouse.move(x, y)
    await window.mouse.down()
    await window.mouse.move(x + width, y + height, { steps: 15 })
    await window.mouse.up()
  }
  const clipboard = async () => {
    let result!: { png: string; width: number; height: number }
    await expect(async () => {
      result = await (overlay ?? page).evaluate(async () => {
        const items = await navigator.clipboard.read()
        const item = items.find((item) => item.types.includes('image/png'))
        if (!item) throw new Error('Clipboard contains no PNG image')
        const blob = await item.getType('image/png')
        const image = await createImageBitmap(blob)
        const png = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        return { png, width: image.width, height: image.height }
      })
    }).toPass({ timeout: 5_000 })
    return result
  }

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'feature.screenshot.enabled': true,
        'feature.screenshot.auto_ocr': false,
        'shortcut.screenshot.capture': { binding: ['CommandOrControl', 'Shift', 'A'], enabled: true }
      })
    )
    await page.bringToFront()
    // This is capture input displayed in the real application, never an injected OCR result.
    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.id = 'mp128-sample'
      canvas.width = 560
      canvas.height = 220
      canvas.style.cssText = 'position:fixed;left:120px;top:100px;width:560px;height:220px;z-index:2147483647'
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 560, 220)
      context.fillStyle = '#000000'
      context.font = '40px Arial'
      context.fillText('canary-seven', 40, 80)
      document.body.append(canvas)
    })
    await screenshot(page, 'MP-128 sample before capture')
    const bounds = await page.evaluate(() => ({ x: screenX, y: screenY }))
    const capture = async () => {
      await page.bringToFront()
      sendSystemHotkey(app.record.platform, [app.record.platform === 'macos' ? 'Meta' : 'Control', 'Shift', 'a'])
      overlay = await app.window('/windows/screenshot/')
      await expect(overlay.locator('canvas').first()).toBeVisible({ timeout: 20_000 })
      const origin = await overlay.evaluate(() => ({ x: screenX, y: screenY }))
      const x = bounds.x + 120 - origin.x
      const y = bounds.y + 100 - origin.y
      await drag(overlay, x, y, 560, 220)
      await expect(overlay.getByRole('button', { name: 'Rectangle', exact: true })).toBeVisible()
      return { window: overlay, x, y }
    }
    const { window: capturePage, x, y } = await capture()
    await capturePage.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await capturePage.getByRole('button', { name: 'Red', exact: true }).click()
    await expect(capturePage.getByRole('button', { name: 'Red', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await drag(capturePage, x + 20, y + 20, 400, 100)
    const painted = await capturePage
      .locator('canvas')
      .last()
      .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    await capturePage.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(() =>
        capturePage
          .locator('canvas')
          .last()
          .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
      )
      .not.toBe(painted)
    await capturePage.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect
      .poll(() =>
        capturePage
          .locator('canvas')
          .last()
          .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
      )
      .toBe(painted)
    await capturePage.getByRole('button', { name: 'Text', exact: true }).click()
    await capturePage.getByRole('button', { name: 'Blue', exact: true }).click()
    await capturePage.getByRole('button', { name: 'Text size 28', exact: true }).click()
    await expect(capturePage.getByRole('button', { name: 'Text size 28', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await capturePage.mouse.click(x + 40, y + 140)
    await capturePage.locator('textarea').fill('MP-128 annotation')
    await capturePage.getByRole('button', { name: 'Text', exact: true }).click()
    await screenshot(capturePage, 'MP-128 rectangle and text annotations')

    // Copy must preserve the overlay; accepting Copy and close here would hide the regression.
    await capturePage.evaluate(() => navigator.clipboard.writeText('MP128 copy baseline'))
    await expect(capturePage.getByRole('button', { name: 'Copy to clipboard', exact: true })).toBeVisible()
    await capturePage.getByRole('button', { name: 'Copy to clipboard', exact: true }).click()
    const copied = await clipboard()
    expect(copied.width).toBeGreaterThanOrEqual(560)
    expect(copied.height / copied.width).toBeCloseTo(220 / 560, 2)
    await expect(capturePage.getByRole('button', { name: 'Copy and close', exact: true })).toBeVisible()
    await expect(capturePage.getByRole('button', { name: 'Save image', exact: true })).toBeVisible()

    const savedPath = join(app.paths.evidence, 'MP-128-annotated.png')
    await rm(savedPath, { force: true })
    await capturePage.getByRole('button', { name: 'Save image', exact: true }).click()
    await saveNativeFile(app.record.platform, app.paths, savedPath)
    await expect
      .poll(() =>
        readFile(savedPath).then(
          (buffer) => buffer.subarray(0, 8).toString('hex'),
          (error) => {
            if (error.code !== 'ENOENT') throw error
            return ''
          }
        )
      )
      .toBe('89504e470d0a1a0a')
    const savedPixels = await sharp(savedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const copiedPixels = await sharp(Buffer.from(copied.png, 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(savedPixels.info).toMatchObject({ width: copied.width, height: copied.height, channels: 4 })
    expect(savedPixels.data.equals(copiedPixels.data), 'Saved PNG must preserve every copied pixel').toBe(true)
    await page.evaluate(async (png) => {
      const image = new Image()
      image.src = `data:image/png;base64,${png}`
      await image.decode()
      if (image.naturalWidth === 0) throw new Error('Saved PNG cannot be opened')
    }, copied.png)
    await testInfo.attach('MP-128 saved PNG', { path: savedPath, contentType: 'image/png' })

    const ocrCapture = await capture()
    await ocrCapture.window.getByRole('button', { name: 'Recognize text', exact: true }).click()
    const recognized = ocrCapture.window.getByText('canary-seven', { exact: true }).first()
    await expect(recognized).toBeVisible({ timeout: 30_000 })
    await recognized.evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      getSelection()?.removeAllRanges()
      getSelection()?.addRange(range)
    })
    expect(await ocrCapture.window.evaluate(() => getSelection()?.toString())).toBe('canary-seven')
    await ocrCapture.window.getByRole('button', { name: 'Copy all text, or select it on screen', exact: true }).click()
    expect(await ocrCapture.window.evaluate(() => navigator.clipboard.readText())).toContain('canary-seven')
    await screenshot(ocrCapture.window, 'MP-128 recognized text')
    await ocrCapture.window.getByRole('button', { name: 'Copy and close', exact: true }).click()
    await expect(ocrCapture.window.getByRole('button', { name: 'Copy and close', exact: true })).toBeHidden()
    const composer = page.locator('[data-ui~="chat.view"]:visible [data-ui~="chat.composer"]')
    const imageTokens = composer.locator('[data-composer-token-kind="file"][data-file-token-variant="image"]')
    await composer.locator('[contenteditable="true"]').first().click()
    await page.keyboard.press(app.record.platform === 'macos' ? 'Meta+v' : 'Control+v')
    await expect(imageTokens).toHaveCount(1)
    await imageTokens.first().hover()
    await expect(page.locator('[data-file-token-image-preview] img')).toBeVisible()
    await screenshot(page, 'MP-128 pasted image in chat')

    const chatCapture = await capture()
    await chatCapture.window.getByRole('button', { name: 'Add to chat', exact: true }).click()
    await chatCapture.window.getByRole('dialog').getByRole('button', { name: 'Add to chat', exact: true }).click()
    await expect(imageTokens).toHaveCount(2)
    await screenshot(page, 'MP-128 added screenshot to conversation')

    await selectSidebarApp(page, 'Settings')
    const noChat = await capture()
    await noChat.window.getByRole('button', { name: 'Add to chat', exact: true }).click()
    await expect(
      noChat.window.getByText('Open a chat or Agent conversation, then start a new capture to add it to that draft.', {
        exact: true
      })
    ).toBeVisible()
    await expect(
      noChat.window.getByRole('dialog').getByRole('button', { name: 'Add to chat', exact: true })
    ).toBeDisabled()
  } finally {
    await overlay?.keyboard.press('Escape').catch(() => undefined)
    await page.evaluate(async (original) => {
      document.getElementById('mp128-sample')?.remove()
      await window.api.preference.setMultiple({
        'feature.screenshot.enabled': original.enabled,
        'feature.screenshot.auto_ocr': original.autoOcr,
        'shortcut.screenshot.capture': original.shortcut
      })
    }, original)
  }
})

test(...caseDefinition('MP-129'), async ({ app, mainWindow }, testInfo) => {
  await globalSearch(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-130'), async ({ app, mainWindow }, testInfo) => {
  await launchpadPinning(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-131'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(180_000)
  const menuMode = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
  const strip = page.getByTestId('app-shell-tab-strip')
  const tabs = strip.locator('[data-tab-id]')
  const tab = (name: string) => strip.getByRole('button', { name, exact: true }).and(tabs)
  const menu = async (target: ReturnType<typeof tab>, action: string) => {
    await target.click({ button: 'right' })
    await page.getByRole('menuitem', { name: action, exact: true }).click()
  }
  const screenshot = async (window: Page, name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(window, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const chat = page.locator('[data-ui~="chat.view"]:visible')
  const knowledge = page.locator('[data-ui~="knowledge.view"]:visible')
  let child: Page | undefined
  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    await selectSidebarApp(page, 'Chat')
    // Normalize tabs left by earlier cases through the same close actions users have.
    while ((await tabs.count()) > 1) {
      const id = await tabs.last().getAttribute('data-tab-id')
      await menu(strip.locator(`[data-tab-id="${id}"]`), 'Close Tab')
      await expect(strip.locator(`[data-tab-id="${id}"]`)).toHaveCount(0)
    }
    await menu(tabs.first(), 'Close Tab')
    await expect(tab('Launchpad')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()

    await selectSidebarApp(page, 'Chat')
    await expect(chat).toBeVisible()
    const chatTab = tabs.last()
    const chatId = await chatTab.getAttribute('data-tab-id')
    expect(chatId).toBeTruthy()
    const pinned = strip.locator(`[data-tab-id="${chatId}"]`)
    await expect(tabs).toHaveCount(1)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Knowledge Base')
    await expect(knowledge).toBeVisible()
    await selectSidebarApp(page, 'Settings')
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toBeVisible()
    await page.keyboard.press('Control+Shift+Tab')
    await expect(tab('Settings')).toBeVisible()
    await expect(tabs).toHaveCount(3)
    await expect(knowledge).toBeVisible()

    await menu(pinned, 'Pin Tab')
    await expect(pinned).toHaveAttribute('title', /.+/)
    await expect(pinned.getByRole('button', { name: 'Close Tab', exact: true })).toHaveCount(0)
    await pinned.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Unpin Tab', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await pinned.click({ button: 'middle' })
    await pinned.dblclick()
    await expect(pinned).toBeVisible()
    await expect(tabs).toHaveCount(3)
    await expect(chat).toBeVisible()
    await screenshot(page, 'MP-131 pinned chat with knowledge and settings tabs')

    await menu(tab('Knowledge Base'), 'Close Tabs to the Right')
    await expect(tab('Settings')).toHaveCount(0)
    await expect(pinned).toBeVisible()
    await expect(tab('Knowledge Base')).toBeVisible()
    await expect(tabs).toHaveCount(2)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Translation')
    await expect(tab('Translate')).toBeVisible()
    await menu(tab('Knowledge Base'), 'Close Other Tabs')
    await expect(tab('Translate')).toHaveCount(0)
    await expect(tabs).toHaveCount(2)
    await expect(pinned).toBeVisible()
    await expect(knowledge).toBeVisible()

    const knowledgeId = await tab('Knowledge Base').getAttribute('data-tab-id')
    expect(knowledgeId).toBeTruthy()
    const knowledgeContent = await knowledge.innerText()
    await menu(tab('Knowledge Base'), 'Open in New Window')
    child = await app.window('/windows/subWindow/', knowledgeId!)
    await expect(child.locator('[data-ui~="knowledge.view"]:visible')).toBeVisible()
    await expect(child.locator('[data-ui~="knowledge.view"]:visible')).toHaveText(knowledgeContent, {
      useInnerText: true
    })
    await expect(child.getByRole('button', { name: 'Back to Main Window', exact: true })).toBeVisible()
    await expect(tab('Knowledge Base')).toHaveCount(0)
    await expect(tabs).toHaveCount(1)
    await pinned.click()
    await expect(chat).toBeVisible()
    await screenshot(child, 'MP-131 knowledge base in independent window')
    await child.getByRole('button', { name: 'Back to Main Window', exact: true }).click()
    await expect.poll(() => child!.isClosed()).toBe(true)
    await page.bringToFront()
    await expect(knowledge).toBeVisible()
    await expect(tab('Knowledge Base')).toHaveAttribute('data-tab-id', knowledgeId!)
    await expect(tabs).toHaveCount(2)
    await expect(pinned).toBeVisible()
    await expect(pinned.getByRole('button', { name: 'Close Tab', exact: true })).toHaveCount(0)
    await screenshot(page, 'MP-131 knowledge returned and pinned chat preserved')

    await tab('Knowledge Base').hover()
    await tab('Knowledge Base').getByRole('button', { name: 'Close Tab', exact: true }).click()
    await expect(tabs).toHaveCount(1)
    await expect(chat).toBeVisible()
    await menu(pinned, 'Close Tab')
    await expect(tabs).toHaveCount(1)
    await expect(tab('Launchpad')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()
    await expect(chat).toHaveCount(0)
    await expect(knowledge).toHaveCount(0)
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toHaveCount(0)
    await screenshot(page, 'MP-131 last tab closed falls back to Launchpad')

    await selectSidebarApp(page, 'Chat')
    await expect(chat).toBeVisible()
    await expect(page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()).toBeEditable()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeHidden()
    await expect(tabs).toHaveCount(1)
    await openLaunchpad(page)
    await selectSidebarApp(page, 'Knowledge Base')
    await expect(knowledge).toBeVisible()
    await expect(tabs).toHaveCount(2)
    await screenshot(page, 'MP-131 sidebar opens working chat after Launchpad fallback')
  } finally {
    if (child && !child.isClosed()) await child.close()
    await page.evaluate((mode) => window.api.preference.set('menu.presentation_mode', mode), menuMode)
  }
})

test(...caseDefinition('MP-132'), async ({ app, mainWindow }, testInfo) => {
  await systemTrayMenu(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-133'), async ({ app, mainWindow }, testInfo) => {
  await singleInstanceRelaunch(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-140'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const original = await page.evaluate(async () => ({
    language: await window.api.preference.get('app.language'),
    enabled: await window.api.preference.get('app.computer_use.agent_control.enabled')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }

  try {
    await openSettingsSection(page, 'Computer Use')
    await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
    const settings = page.locator('[data-ui~="settings.view"]:visible')
    await expect(settings.getByRole('heading', { name: '电脑操作', exact: true })).toBeVisible()
    await screenshot('MP-140 step 1 computer use settings')
    await testInfo.attach('MP-140 actual settings text', {
      body: await settings.innerText(),
      contentType: 'text/plain'
    })
    await expect(settings.getByText('让 AI 查看屏幕、操作应用，帮你完成电脑上的任务。', { exact: true })).toBeVisible({
      timeout: 5_000
    })

    const permissions = [
      { name: '辅助功能', panel: 'Privacy_Accessibility' },
      { name: '屏幕录制', panel: 'Privacy_ScreenCapture' }
    ] as const
    const permissionStates = new Map<string, string>()
    for (const { name, panel } of permissions) {
      const row = settings.getByRole('heading', { name, exact: true }).locator('../..')
      await expect(row.locator('p')).toHaveText(/^(已授权|已拒绝|未确认|不可用)$/)
      const state = await row.locator('p').innerText()
      permissionStates.set(name, state)
      expect(readNativePermission(panel), `${name}: ${state}`).toBe(state === '已授权' ? '1' : '0')
    }
    await screenshot('MP-140 step 2 permission states')

    const refresh = settings.getByRole('button', { name: '重新检查权限', exact: true })
    await refresh.click()
    await expect(refresh).toBeEnabled()
    await expect(settings.getByRole('alert')).toHaveCount(0)
    await expect(settings.getByRole('heading', { name: '辅助功能', exact: true })).toBeVisible()
    await screenshot('MP-140 step 3 permissions refreshed')

    for (const { name } of permissions) {
      const guide = settings.getByRole('button', { name: `管理${name}权限`, exact: true })
      const state = permissionStates.get(name)
      if ((await guide.count()) === 0) {
        // Settings only offer a guide while the permission is still missing.
        expect(['已授权', '不可用'], `${name}: guide must be hidden only when nothing can be opened`).toContain(state)
        continue
      }
      await expect(guide).toHaveText('打开授权引导')
      await guide.click()
      await expect
        .poll(() =>
          nativeComputerUse(`
        tell application "System Events" to tell process "System Settings"
          return entire contents of window 1 as text
        end tell
      `)
        )
        .toContain(name)
      await screenshot(`MP-140 step 3 ${name} guide`)
      await page.bringToFront()
      await refresh.click()
      await expect(refresh).toBeEnabled()
      await expect(settings.getByRole('alert')).toHaveCount(0)
    }
    const permissionResult = (await page.evaluate(() =>
      window.api.ipcApi.request('computer_use.get_permission_status')
    )) as { ok: true; data: unknown } | { ok: false; error: unknown }
    if (!permissionResult.ok) throw new Error(JSON.stringify(permissionResult.error))
    const status = computerUseRequestSchemas['computer_use.get_permission_status'].output.parse(permissionResult.data)
    if (status.permissions.some(({ status }) => status !== 'granted')) {
      // Missing desktop-control permissions are a prerequisite gap, not a regression: skipping
      // records the case as blocked instead of failed.
      test.skip(true, 'UNCOVERED: desktop control requires both helper permissions to be granted in System Settings')
    }

    let control = page.getByRole('switch', { name: '允许 Agent 控制桌面应用', exact: true })
    await control.setChecked(true)
    await expect(control).toBeEnabled()
    await expect
      .poll(() => page.evaluate(() => window.api.preference.get('app.computer_use.agent_control.enabled')))
      .toBe(true)
    await screenshot('MP-140 step 4 control enabled')
    const oldPid = app.record.electronPid
    page = await app.restart()
    expect(app.record.electronPid).not.toBe(oldPid)
    await openSettingsSection(page, '电脑操作')
    control = page.getByRole('switch', { name: '允许 Agent 控制桌面应用', exact: true })
    await expect(control).toBeChecked()
    await screenshot('MP-140 step 4 enabled after full restart')

    const startControl = (ownerId: string) =>
      computerUseMain(
        app,
        `
      const context = service.createTask(${JSON.stringify(ownerId)}, 'MP-140 desktop control')
      const { apps } = await service.listApps(context)
      const target = apps.find(app => app.id === 'com.apple.systempreferences')
      if (!target) throw new Error('UNCOVERED: System Settings is not available for desktop control')
      const session = await service.openApp(context, target.id)
      return session.app.id
    `
      )
    await startControl('MP-140-toggle')
    await control.setChecked(false)
    await expect(control).toBeEnabled()
    await expect
      .poll(() =>
        computerUseMain(
          app,
          `
      return service.getControls().some(control => ['active', 'opening', 'stopping'].includes(control.status))
    `
        )
      )
      .toBe(false)
    expect(
      await computerUseMain(
        app,
        `
      try {
        await service.listApps(service.createTask('MP-140-disabled', 'MP-140 disabled attempt'))
        return 'ALLOWED'
      } catch (error) { return error.code }
    `
      )
    ).toBe('CONTROL_DISABLED')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await screenshot('MP-140 step 4 control disabled and revoked')

    await control.setChecked(true)
    await expect(control).toBeEnabled()
    await startControl('MP-140-tray')
    const menuLabel = stopNativeDesktopControl(app.record.electronPid)
    await testInfo.attach('MP-140 tray stop menu label', { body: menuLabel, contentType: 'text/plain' })
    expect(menuLabel).toBe('停止所有桌面控制')
    await expect
      .poll(() =>
        computerUseMain(
          app,
          `
      return service.getControls().some(control => ['active', 'opening', 'stopping'].includes(control.status))
    `
        )
      )
      .toBe(false)
    expect(
      await computerUseMain(
        app,
        `
      try {
        await service.listApps(service.createTask('MP-140-tray', 'MP-140 stopped attempt'))
        return 'ALLOWED'
      } catch (error) { return error.code }
    `
      )
    ).toBe('USER_STOPPED')
    await page.bringToFront()
    expect(await control.isChecked()).toBe(
      await page.evaluate(() => window.api.preference.get('app.computer_use.agent_control.enabled'))
    )
    await screenshot('MP-140 step 5 tray stopped desktop control')
  } finally {
    if (page.isClosed()) page = await app.mainWindow()
    await page.evaluate(
      ({ language, enabled }) =>
        window.api.preference.setMultiple({
          'app.language': language,
          'app.computer_use.agent_control.enabled': enabled
        }),
      original
    )
  }
})

test(...caseDefinition('MP-141'), async ({ app, mainWindow: page }, testInfo) => {
  // Catches broken gateway guidance, invitation expiry, and network-access persistence using the real gateway.
  test.setTimeout(8 * 60_000)
  testInfo.annotations.push({
    type: '未覆盖',
    description: '无实体手机：第 6 步扫码、验证码核对、允许/拒绝及配对成功后的撤销访问未覆盖；验证未扫码空态。'
  })
  const original = await page.evaluate(async () => ({
    enabled: await window.api.preference.get('feature.api_gateway.enabled'),
    host: await window.api.preference.get('feature.api_gateway.host'),
    port: await window.api.preference.get('feature.api_gateway.port')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const devices = async () => {
    const response = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp141-devices', method: 'GET', path: '/api-gateway/paired-devices' })
    )
    expect(response.status).toBe(200)
    return response.data
  }
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a gateway port')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))

  try {
    const stopped = await page.evaluate(() => window.api.ipcApi.request('api_gateway.stop'))
    expect(stopped).toEqual({ ok: true, data: { success: true, outcome: 'stopped' } })
    await page.evaluate(
      (port) =>
        window.api.preference.setMultiple({
          'feature.api_gateway.host': '127.0.0.1',
          'feature.api_gateway.port': port
        }),
      port
    )
    expect(await devices()).toEqual([])
    await openSettingsSection(page, 'Device Connections')
    const settings = () => page.locator('[data-ui~="settings.view"]:visible')
    await expect(
      settings().getByText('Connect mobile devices over a local, company or VPN network.', { exact: true })
    ).toBeVisible()
    const continueButton = () =>
      page.getByRole('button', { name: 'Already installed? Connect your device', exact: true })
    if (!(await continueButton().isVisible())) {
      await page.getByRole('button', { name: 'Download mobile app', exact: true }).click()
    }
    await expect(continueButton()).toBeVisible()
    await expect(page.getByRole('button', { name: 'iOS · App Store', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Android', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Get it on Google Play', exact: true })).toBeVisible()
    await screenshot('MP-141 mobile download guide')
    await continueButton().click()
    await expect(page.getByRole('button', { name: 'Download mobile app', exact: true })).toBeVisible()
    await expect(
      settings()
        .getByText('Start the gateway in API Gateway settings before allowing network access.', { exact: true })
        .first()
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow network access', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Open API Gateway settings', exact: true }).click()
    await expect(settings().getByText('Stopped', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(settings().getByText('Running', { exact: true })).toBeVisible()
    await openSettingsSection(page, 'Device Connections')
    await page.getByRole('button', { name: 'Allow network access', exact: true }).click()
    await expect(settings().getByText('Network access is allowed', { exact: true })).toBeVisible()
    await expect(
      settings().getByText(
        'Scan with the Cherry Studio mobile app. The invitation is single-use and expires in 2 minutes.',
        { exact: true }
      )
    ).toBeVisible()
    const qr = () =>
      settings()
        .locator('svg')
        .filter({ has: page.locator('title', { hasText: /^Pair a device$/ }) })
    await expect(qr()).toBeVisible()
    await expect(settings().getByText('No devices have been paired yet.', { exact: true })).toBeVisible()

    const createdAt = Date.now()
    await expect(settings().getByText('QR code expired', { exact: true })).toBeVisible({ timeout: 130_000 })
    expect(Date.now() - createdAt).toBeGreaterThanOrEqual(115_000)
    await expect(qr()).toHaveCount(0)
    await screenshot('MP-141 invitation expired after two minutes')
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(qr()).toBeVisible()
    await expect(settings().getByText('QR code expired', { exact: true })).toHaveCount(0)
    const connectionAddress = () => page.getByRole('combobox', { name: 'Connection address', exact: true })
    await connectionAddress().click()
    const options = page.getByRole('option')
    expect(await options.count()).toBeGreaterThan(1)
    const selectedAddress = (await options.nth(1).innerText()).trim()
    await options.nth(1).click()
    await expect(connectionAddress()).toContainText(selectedAddress)
    const oldQr = await qr().innerHTML()
    await page.getByRole('button', { name: 'Refresh addresses', exact: true }).click()
    const unavailable = settings().getByText('The selected address is no longer available. Choose another address.', {
      exact: true
    })
    // Refreshing can drop the address in use: the code then disappears and the alert replaces it.
    await expect(qr().or(unavailable).first()).toBeVisible({ timeout: 30_000 })
    if (await unavailable.isVisible()) {
      await connectionAddress().click()
      await page.getByRole('option', { name: 'Automatic', exact: true }).click()
      await expect(unavailable).toHaveCount(0)
      await expect(qr()).toBeVisible()
      await expect.poll(async () => qr().innerHTML()).not.toBe(oldQr)
      await screenshot('MP-141 address recovered after refresh')
    } else {
      await expect.poll(async () => qr().innerHTML()).not.toBe(oldQr)
    }
    await expect(qr()).toBeVisible()
    await connectionAddress().click()
    expect(await options.count()).toBeGreaterThan(1)
    await page.keyboard.press('Escape')
    await expect(qr()).toBeVisible()
    expect(await devices()).toEqual([])

    await page.getByRole('button', { name: 'Disable network access', exact: true }).click()
    await expect(settings().getByText('Network access is off', { exact: true })).toBeVisible()
    await expect(settings().getByText('Allow network access to pair devices.', { exact: true })).toBeVisible()
    await expect(qr()).toHaveCount(0)
    const blockedPairing = await page.evaluate(() => window.api.ipcApi.request('api_gateway.remote.create_invitation'))
    expect(blockedPairing).toMatchObject({ ok: false })
    const savedHost = await page.evaluate(() => window.api.preference.get('feature.api_gateway.host'))
    expect(savedHost).toBe('127.0.0.1')
    await screenshot('MP-141 network access disabled and no paired devices')
    page = await app.restart()
    await openSettingsSection(page, 'Device Connections')
    await expect(settings().getByText('Network access is off', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Allow network access', exact: true })).toBeVisible()
    await expect(settings().getByText('Allow network access to pair devices.', { exact: true })).toBeVisible()
    await expect(settings().getByText('No devices have been paired yet.', { exact: true })).toBeVisible()
    expect(await devices()).toEqual([])
    expect(await page.evaluate(() => window.api.preference.get('feature.api_gateway.host'))).toBe(savedHost)
    await expect(qr()).toHaveCount(0)
    await screenshot('MP-141 disabled state persists after restart')
  } finally {
    await page.evaluate(async (original) => {
      await window.api.ipcApi.request('api_gateway.lan.set_enabled', { enabled: false })
      await window.api.ipcApi.request('api_gateway.stop')
      await window.api.preference.setMultiple({
        'feature.api_gateway.host': original.host,
        'feature.api_gateway.port': original.port
      })
      if (original.enabled) await window.api.ipcApi.request('api_gateway.start')
    }, original)
  }
})
