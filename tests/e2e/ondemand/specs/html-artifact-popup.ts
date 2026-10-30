import { expect } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import { ThemeMode } from '../../../../src/shared/data/preference/preferenceTypes'
import type { Assistant } from '../../../../src/shared/data/types/assistant'
import type { Message } from '../../../../src/shared/data/types/message'
import type { Topic } from '../../../../src/shared/data/types/topic'
import type { IpcResult } from '../../../../src/shared/ipc/errors/IpcError'

export default async function htmlArtifactPopup(context: ScenarioContext): Promise<void> {
  const { page } = context
  await context.ensureChinese()
  const originalPreferences = await page.evaluate(async () => ({
    fancy: await window.api.preference.get('chat.code.fancy_block'),
    theme: await window.api.preference.get('ui.theme_mode'),
    light: await window.api.preference.get('chat.code.viewer.theme_light')
  }))
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  const name = `html-popup-${Date.now()}`
  const source = `<!doctype html>\n<html>\n<head><title>${name}</title></head>\n<body><h1>Popup 中文 🥟</h1></body>\n</html>  \n\n`
  const addition = '<!-- draft 中文 🥟 -->  '
  let assistantId: string | undefined
  try {
    await page.evaluate(
      async (theme) =>
        window.api.preference.setMultiple({
          'chat.code.fancy_block': true,
          'ui.theme_mode': theme,
          'chat.code.viewer.theme_light': 'one-light'
        }),
      ThemeMode.light
    )
    const assistant = await page.evaluate(
      (name) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/assistants',
          body: { name }
        }),
      name
    )
    expect(assistant.status).toBe(201)
    assistantId = (assistant.data as Assistant).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name, assistantId }
    )
    expect(topic.status).toBe(201)
    const message = await page.evaluate(
      ({ topicId, source }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: `/topics/${topicId}/messages`,
          body: {
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: '```html\n' + source + '\n```' }] }
          }
        }),
      { topicId: (topic.data as Topic).id, source }
    )
    expect(message.status).toBe(201)
    const messageId = (message.data as Message).id
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('button[aria-label="对话"]:not([data-tab-id])').click()
    await page.getByRole('button', { name, exact: true }).click()
    const open = page.getByRole('button', { name: `预览: ${name}`, exact: true })
    if (await open.isVisible()) await open.click()
    else {
      await page.getByTestId('html-artifact-surface').hover({ position: { x: 8, y: 8 } })
      await page.getByRole('button', { name: '最大化', exact: true }).click()
    }
    const popup = page.getByRole('dialog', { name, exact: true })
    await context.runSteps([{ verb: 'expectVisible', selector: '[role="dialog"]' }])
    await expect(popup.getByRole('radio', { name: '预览', exact: true })).toBeChecked()
    await popup.getByRole('radio', { name: '代码', exact: true }).click()
    const editor = popup.locator('.cm-content')
    await expect(editor).toBeVisible()
    await expect(editor.locator('.code-syntax-tag').first()).toBeVisible()
    const lightColor = await editor
      .locator('.code-syntax-tag')
      .first()
      .evaluate((node) => getComputedStyle(node).color)
    await editor.press('ControlOrMeta+End')
    await page.keyboard.insertText(addition)
    await editor.press('Shift+Home')
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(addition)

    for (const mode of ['分屏', '预览', '代码', '分屏']) {
      await popup.getByRole('radio', { name: mode, exact: true }).click()
      if (mode === '预览') {
        await expect(editor).toHaveCount(0)
        await expect(popup.locator('iframe')).not.toHaveAttribute('srcdoc', new RegExp('draft'))
      } else {
        await expect(editor).toBeVisible()
        await editor.press('ControlOrMeta+c')
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(addition)
      }
    }
    await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), ThemeMode.dark)
    await expect
      .poll(() =>
        editor
          .locator('.code-syntax-tag')
          .first()
          .evaluate((node) => getComputedStyle(node).color)
      )
      .not.toBe(lightColor)
    await expect(editor).toBeFocused()
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(addition)
    await context.screenshot('html-popup-dark-split-draft')
    await editor.press('ControlOrMeta+z')
    await editor.press('ControlOrMeta+a')
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
    await editor.press('ControlOrMeta+Shift+z')
    await popup.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (id) => window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: `/messages/${id}` }),
          messageId
        )
        return (response.data as Message).data.parts
      })
      .toEqual([{ type: 'text', text: '```html\n' + source + addition + '\n```' }])
    await editor.press('ControlOrMeta+z')
    await editor.press('ControlOrMeta+a')
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
    await editor.press('ControlOrMeta+Shift+z')
    await popup.getByRole('radio', { name: '预览', exact: true }).click()
    await expect(popup.locator('iframe')).toHaveAttribute('srcdoc', /draft 中文 🥟/)
    await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), ThemeMode.light)
    await popup.getByRole('radio', { name: '分屏', exact: true }).click()
    await expect(editor.locator('.code-syntax-tag').first()).toHaveCSS('color', lightColor)
    await context.screenshot('html-popup-light-split-saved')
    await page.reload({ waitUntil: 'domcontentloaded' })
    const reopen = page.getByRole('button', { name: `预览: ${name}`, exact: true })
    if (await reopen.isVisible()) await reopen.click()
    else {
      await page.getByTestId('html-artifact-surface').hover({ position: { x: 8, y: 8 } })
      await page.getByRole('button', { name: '最大化', exact: true }).click()
    }
    await popup.getByRole('radio', { name: '代码', exact: true }).click()
    await editor.press('ControlOrMeta+a')
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source + addition)
  } finally {
    await page.evaluate(
      async ({ originalPreferences, clipboard, assistantId }) => {
        await window.api.preference.setMultiple({
          'chat.code.fancy_block': originalPreferences.fancy,
          'ui.theme_mode': originalPreferences.theme,
          'chat.code.viewer.theme_light': originalPreferences.light
        })
        await navigator.clipboard.writeText(clipboard)
        if (assistantId) {
          const result = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<unknown>
          if (!result.ok) throw new Error(result.error.message)
        }
      },
      { originalPreferences, clipboard, assistantId }
    )
  }
}
