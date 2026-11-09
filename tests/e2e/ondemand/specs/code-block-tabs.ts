import { expect } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import { ThemeMode } from '../../../../src/shared/data/preference/preferenceTypes'
import type { Assistant } from '../../../../src/shared/data/types/assistant'
import type { Message } from '../../../../src/shared/data/types/message'
import type { Topic } from '../../../../src/shared/data/types/topic'
import type { IpcResult } from '../../../../src/shared/ipc/errors/IpcError'

export default async function run(context: ScenarioContext) {
  const { page } = context
  await context.ensureChinese()
  const preferences = await page.evaluate(async () => ({
    editor: await window.api.preference.get('chat.code.editor.enabled'),
    theme: await window.api.preference.get('ui.theme_mode')
  }))
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  const viewport = page.viewportSize()
  const name = `code-tabs-${Date.now()}`
  const first = 'const answer = 42;'
  const second = 'def greet(name):\n    return f"Hello, {name}"\n\nprint(greet("Cherry"))'
  const source =
    '```typescript\n' +
    first +
    '\n```\n\n```python\n' +
    second +
    '\n```\n\n```mermaid\ngraph LR\n A-->B\n```\n\n```html\n<div>HTML tab preview</div>\n```'
  let assistantId: string | undefined
  try {
    await page.evaluate(async () => {
      await window.api.preference.set('chat.code.editor.enabled', true)
    })
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
    const topicId = (topic.data as Topic).id
    const message = await page.evaluate(
      ({ topicId, source }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: `/topics/${topicId}/messages`,
          body: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: source }] } }
        }),
      { topicId, source }
    )
    expect(message.status).toBe(201)
    const messageId = (message.data as Message).id
    await page.reload({ waitUntil: 'domcontentloaded' })
    const back = page.getByRole('button', { name: '返回', exact: true })
    if (await back.isVisible()) await back.click()
    await page.locator('button[aria-label="对话"]:not([data-tab-id])').click()
    await page.getByRole('button', { name, exact: true }).and(page.locator(':not([data-tab-id])')).click()
    const tabs = page.getByRole('tablist', { name: '代码块', exact: true })
    await context.runSteps([{ verb: 'expectVisible', selector: '[role="tablist"][aria-label="代码块"]' }])
    await expect(tabs.getByRole('tab')).toHaveCount(4)
    const group = tabs.locator('xpath=ancestor::*[@data-slot="tabs"]')
    const panel = page.getByRole('tabpanel')
    await expect(panel).toHaveCount(1)
    await expect(panel).toContainText(first)
    await expect(group.locator('.code-block-header')).toHaveCount(1)
    await page.mouse.move(0, 0)
    const toolbar = group.locator('.code-toolbar')
    await expect(toolbar.locator('..').locator('..')).toHaveCSS('opacity', '0')
    await panel.hover()
    await expect(toolbar.locator('..').locator('..')).toHaveCSS('opacity', '1')
    const headerBounds = await tabs.boundingBox()
    const toolbarBounds = await toolbar.boundingBox()
    expect(headerBounds).not.toBeNull()
    expect(toolbarBounds).not.toBeNull()
    expect(toolbarBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y)
    expect(toolbarBounds!.y + toolbarBounds!.height).toBeLessThanOrEqual(headerBounds!.y + headerBounds!.height)
    await group.getByRole('button', { name: '编辑', exact: true }).click()
    const editor = panel.locator('.cm-content')
    await editor.click()
    await editor.press('ControlOrMeta+End')
    const addition = ' // unsaved draft'
    await page.keyboard.insertText(addition)
    await tabs.getByRole('tab', { name: 'python', exact: true }).click()
    await expect(panel).toContainText(/def greet\(name\):\s*return f"Hello, \{name\}"\s*print\(greet\("Cherry"\)\)/)
    await panel.hover()
    await group.getByRole('button', { name: '复制源代码', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(second)
    await tabs.getByRole('tab', { name: 'typescript', exact: true }).click()
    await expect(editor).toContainText(first + addition)
    await editor.click()
    await editor.press('ControlOrMeta+z')
    await expect(editor).toHaveText(first)
    await editor.press('ControlOrMeta+Shift+z')
    await expect(editor).toHaveText(first + addition)
    await panel.hover()
    await group.getByRole('button', { name: '保存修改', exact: true }).click()
    const saved = source.replace(first, first + addition)
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (id) => window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: `/messages/${id}` }),
          messageId
        )
        return (response.data as Message).data.parts
      })
      .toEqual([{ type: 'text', text: saved }])
    await tabs.getByRole('tab', { name: 'mermaid', exact: true }).click()
    await expect(panel.locator('svg').filter({ hasText: 'A' }).first()).toBeVisible()
    await tabs.getByRole('tab', { name: 'html', exact: true }).click()
    await expect(panel).toBeVisible()
    await expect(panel.locator('iframe')).toBeVisible()
    await tabs.getByRole('tab', { name: 'typescript', exact: true }).click()
    await page.setViewportSize({ width: 620, height: 720 })
    await tabs.getByRole('tab', { name: 'typescript', exact: true }).focus()
    await page.keyboard.press('End')
    const lastTab = tabs.getByRole('tab', { name: 'html', exact: true })
    await expect(lastTab).toBeFocused()
    await expect(lastTab).toBeInViewport()
    await page.setViewportSize({ width: 820, height: 720 })
    for (const theme of [ThemeMode.light, ThemeMode.dark]) {
      await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), theme)
      await tabs.getByRole('tab', { name: 'typescript', exact: true }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(tabs.getByRole('tab', { name: 'python', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(panel).toContainText(/def greet\(name\):\s*return f"Hello, \{name\}"\s*print\(greet\("Cherry"\)\)/)
      await context.screenshot(`code-tabs-${theme}`)
    }
    await page.setViewportSize({ width: 1100, height: 720 })
    await panel.hover()
    await context.screenshot('code-tabs-header-hover')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.mouse.move(0, 0)
    await expect(toolbar.locator('..').locator('..')).toHaveCSS('opacity', '0')
    await context.screenshot('code-tabs-header-rest')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('tabpanel')).toContainText(first + addition)
  } finally {
    if (viewport) await page.setViewportSize(viewport)
    await page.evaluate(
      async ({ preferences, clipboard, assistantId }) => {
        await window.api.preference.setMultiple({
          'chat.code.editor.enabled': preferences.editor,
          'ui.theme_mode': preferences.theme
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
      { preferences, clipboard, assistantId }
    )
  }
}
