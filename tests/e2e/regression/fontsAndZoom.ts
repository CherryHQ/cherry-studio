import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { sendChatMarker } from './chat'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'
import { openSettingsSection } from './settings'

export async function fontsAndZoom(app: RegressionApp, mainWindow: Page, testInfo: TestInfo): Promise<void> {
  let page = mainWindow
  const keys = [
    'ui.theme_user.font_family',
    'ui.theme_user.code_font_family',
    'chat.message.font_size',
    'chat.message.font',
    'app.zoom_factor',
    'topic.naming.enabled'
  ] as const
  const previous = await page.evaluate(async (keys) => {
    return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)])))
  }, keys)
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const chooseFont = async (kind: 'global' | 'code', font: string) => {
    await page.keyboard.press('Escape')
    const input = page.locator(`#setting-appearance-font-${kind}`).getByRole('combobox')
    await input.click()
    await input.fill(font)
    await page.getByRole('option', { name: font, exact: true }).filter({ visible: true }).click()
    await expect(input).toHaveValue(font)
    await expect(page.getByRole('option').filter({ visible: true })).toHaveCount(0)
  }
  const setSize = async (size: number) => {
    const slider = page.locator('[data-ui~="settings.content"]').getByRole('slider')
    await slider.focus()
    await slider.press('Home')
    for (let value = 12; value < size; value++) await slider.press('ArrowRight')
    await expect(slider).toHaveAttribute('aria-valuenow', String(size))
    await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.message.font_size'))).toBe(size)
  }
  const openTopic = async () => {
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
  }
  const typography = async () => {
    const paragraph = page.getByText('MP106 typography preview 字体预览', { exact: true })
    const code = page
      .locator('[data-ui~="part:code-block"] [data-ui~="ui.code-viewer"]')
      .filter({ hasText: 'const fontPreview = 106' })
      .first()
    await expect(paragraph).toBeVisible()
    await expect(code).toBeVisible()
    return {
      body: await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily),
      text: await paragraph.evaluate((element) => ({
        family: getComputedStyle(element).fontFamily,
        size: getComputedStyle(element).fontSize,
        height: element.getBoundingClientRect().height
      })),
      code: await code.evaluate((element) => getComputedStyle(element).fontFamily),
      dpr: await page.evaluate(() => window.devicePixelRatio)
    }
  }
  const assertLayout = async () => {
    await expect(page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()).toBeEditable()
    const layout = await page.locator('[data-ui~="chat.view"]:visible').evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        width: rect.width,
        right: rect.right,
        viewport: innerWidth,
        overflow: element.scrollWidth - element.clientWidth
      }
    })
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1)
    expect(layout.overflow).toBeLessThanOrEqual(1)
  }
  const server = await startMockChatServer()
  // Font availability differs per platform, so choose from the installed catalog instead of assuming one font exists.
  const installedFonts = await page.evaluate(async () => {
    const result = (await window.api.ipcApi.request('system.get_fonts')) as
      | { ok: true; data: string[] }
      | { ok: false; error: unknown }
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    return result.data
  })
  const pickFont = (candidates: RegExp, label: string) => {
    const font = installedFonts.find((name) => candidates.test(name))
    if (!font) throw new Error(`UNCOVERED: no ${label} font is installed on this platform`)
    return font
  }
  const bodyFont = pickFont(/^Arial$/i, 'Arial')
  const codeFont = pickFont(/^(Menlo|Monaco|Consolas|Courier New)$/i, 'monospace')
  const providerId = `mp106-${Date.now()}`
  const assistantName = app.resourceName('Typography assistant')
  const topicName = app.resourceName('Typography code preview')
  let assistantId: string | undefined
  try {
    await page.evaluate(async () => {
      await window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'chat.message.font': 'system' })
    })
    // Only the provider reply is mocked; font rendering, zoom, persistence and controls are real.
    const statuses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp106-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP106 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp106-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp106-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, enabled.status, model.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(statuses).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp106-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp106-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    TopicSchema.parse(topic.data)
    await page.reload()
    await openSettingsSection(page, 'Appearance')
    await chooseFont('global', 'Default')
    await chooseFont('code', 'Default')
    await setSize(14)
    const zoom = () => page.locator('#setting-appearance-zoom')
    const resetZoom = zoom().getByRole('button', { name: 'Reset', exact: true })
    if (await resetZoom.isVisible()) await resetZoom.click()
    await expect(zoom()).toContainText('100%')
    await openTopic()
    await Promise.all([
      sendChatMarker(page, 'Show a short code sample.', 'MP106 typography preview 字体预览'),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(server.modelId)
        request.complete(
          'MP106 typography preview 字体预览\n\n```javascript\nconst fontPreview = 106;\nconsole.log(fontPreview);\n```'
        )
      })()
    ])
    const baseline = await typography()
    expect(baseline.text.size).toBe('14px')
    await openSettingsSection(page, 'Appearance')
    await chooseFont('global', bodyFont)
    await chooseFont('code', codeFont)
    await setSize(18)
    await screenshot('MP-106 selected fonts and message size')
    await zoom().getByRole('button', { name: 'Zoom In', exact: true }).click()
    await expect(zoom()).toContainText('110%')
    await openTopic()
    const changed = await typography()
    expect(changed.body.split(',')[0].replaceAll('"', '')).toBe(bodyFont)
    expect(changed.text.family.split(',')[0].replaceAll('"', '')).toBe(bodyFont)
    expect(changed.code.split(',')[0].replaceAll('"', '')).toBe(codeFont)
    expect(changed.text.size).toBe('18px')
    expect(changed.text.height).toBeGreaterThan(baseline.text.height)
    expect(changed.dpr / baseline.dpr).toBeCloseTo(1.1, 2)
    await assertLayout()
    await screenshot('MP-106 rendered fonts size and 110 percent zoom')
    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    await openTopic()
    const persisted = await typography()
    expect(persisted.body).toBe(changed.body)
    expect(persisted.text.family).toBe(changed.text.family)
    expect(persisted.text.size).toBe('18px')
    expect(persisted.code).toBe(changed.code)
    expect(persisted.dpr).toBeCloseTo(changed.dpr, 2)
    await assertLayout()
    await screenshot('MP-106 fonts and zoom persist after restart')
    await openSettingsSection(page, 'Appearance')
    await expect(zoom()).toContainText('110%')
    await zoom().getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(zoom()).toContainText('100%')
    await chooseFont('global', 'Default')
    await chooseFont('code', 'Default')
    await setSize(14)
    await openTopic()
    const restored = await typography()
    expect(restored.body).toBe(baseline.body)
    expect(restored.text.family).toBe(baseline.text.family)
    expect(restored.text.size).toBe('14px')
    expect(restored.code).toBe(baseline.code)
    expect(restored.dpr).toBeCloseTo(baseline.dpr, 2)
    await assertLayout()
    await screenshot('MP-106 defaults restored')
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.evaluate(
      async ({ previous, assistantId, providerId }) => {
        await window.api.preference.setMultiple(previous)
        await window.api.ipcApi.request('app.adjust_zoom', { reset: true, delta: 0 })
        await window.api.ipcApi.request('app.adjust_zoom', { delta: Number(previous['app.zoom_factor']) - 1 })
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({ id: 'mp106-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { previous, assistantId, providerId }
    )
  }
}
