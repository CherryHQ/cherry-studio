import { expect, type Locator } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import { ThemeMode } from '../../../../src/shared/data/preference/preferenceTypes'
import type { Assistant } from '../../../../src/shared/data/types/assistant'
import type { Message } from '../../../../src/shared/data/types/message'
import type { Topic } from '../../../../src/shared/data/types/topic'
import type { IpcResult } from '../../../../src/shared/ipc/errors/IpcError'

async function switchWithoutSyntaxFlash(block: Locator, editing: boolean) {
  const expected = await block
    .locator('.code-syntax-comment')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ style: getComputedStyle(node).fontStyle, color: getComputedStyle(node).color }))
    )
  expect(expected.length).toBeGreaterThan(0)
  await block.evaluate((block, editing) => {
    const paints: { style: string; color: string }[][] = []
    Object.assign(window, { codeBlockPaints: paints })
    let frames = 0
    const record = () => {
      if (!block.isConnected) return
      if (!!block.querySelector('.cm-content') === editing) {
        paints.push(
          [...block.querySelectorAll('.code-syntax-comment')].map((node) => ({
            style: getComputedStyle(node).fontStyle,
            color: getComputedStyle(node).color
          }))
        )
      }
      if (++frames < 120 && paints.length < 3) requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  }, editing)
  await block.getByRole('button', { name: editing ? '编辑' : '预览', exact: true }).click()
  const paints = () =>
    block.evaluate(
      () =>
        (
          window as unknown as Window & {
            codeBlockPaints: { style: string; color: string }[][]
          }
        ).codeBlockPaints
    )
  await expect.poll(async () => (await paints()).length).toBe(3)
  for (const paint of await paints()) expect(paint).toEqual(expected)
}

async function codeAppearance(block: Locator) {
  return block.evaluate((block) => {
    const editing = !!block.querySelector('.cm-editor')
    const body = block.querySelector(editing ? '.code-editor' : '.code-viewer')!
    const origin = body.getBoundingClientRect()
    const lines = [...block.querySelectorAll(editing ? '.cm-line' : '.line-content')].map((line) => {
      const style = getComputedStyle(line)
      const rect = (editing ? line : line.closest('.line')!).getBoundingClientRect()
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      let text: Node | null
      let textLeft: number | null = null
      while ((text = walker.nextNode())) {
        const offset = text.textContent!.search(/\S/u)
        if (offset === -1) continue
        const range = document.createRange()
        range.setStart(text, offset)
        range.setEnd(text, offset + 1)
        textLeft = range.getBoundingClientRect().left - origin.left
        break
      }
      return {
        text: line.textContent,
        font: style.fontFamily,
        size: style.fontSize,
        lineHeight: style.lineHeight,
        tabSize: style.tabSize,
        x: line.getBoundingClientRect().left - origin.left,
        y: rect.top - origin.top,
        height: rect.height,
        textLeft
      }
    })
    const numbers = [...block.querySelectorAll(editing ? '.cm-lineNumbers .cm-gutterElement' : '.line-number')]
      .filter((node) => getComputedStyle(node).visibility !== 'hidden')
      .map((node) => ({ text: node.textContent, y: node.getBoundingClientRect().top - origin.top }))
    return { background: getComputedStyle(body).backgroundColor, height: origin.height, lines, numbers }
  })
}

function expectSameAppearance(read: Awaited<ReturnType<typeof codeAppearance>>, edit: typeof read) {
  // Switching modes must preserve blank lines, tab alignment, wrapping and gutter baselines.
  expect(edit.background).toBe(read.background)
  expect(Math.abs(edit.height - read.height), `surface height: read ${read.height}, edit ${edit.height}`).toBeLessThan(
    1 / 64
  )
  expect(edit.lines).toHaveLength(read.lines.length)
  for (const [index, line] of read.lines.entries()) {
    const { x, y, height, textLeft, ...textStyle } = line
    const { x: editX, y: editY, height: editHeight, textLeft: editLeft, ...editStyle } = edit.lines[index]
    expect(editStyle).toEqual(textStyle)
    expect(Math.abs(editX - x), `line ${index + 1} left`).toBeLessThan(1 / 64)
    expect(Math.abs(editY - y), `line ${index + 1} top`).toBeLessThan(1 / 64)
    expect(Math.abs(editHeight - height), `line ${index + 1} height`).toBeLessThan(1 / 64)
    if (textLeft !== null) expect(Math.abs(editLeft! - textLeft), `line ${index + 1} text indent`).toBeLessThan(1 / 64)
  }
  expect(edit.numbers).toHaveLength(read.numbers.length)
  for (const [index, number] of read.numbers.entries()) {
    expect(edit.numbers[index].text).toBe(number.text)
    expect(Math.abs(edit.numbers[index].y - number.y)).toBeLessThan(1 / 64)
  }
}

export default async function codeBlock(context: ScenarioContext): Promise<void> {
  const { page } = context
  await context.ensureChinese()
  const originalPreferences = await page.evaluate(async () => ({
    enabled: await window.api.preference.get('chat.code.editor.enabled'),
    wrap: await window.api.preference.get('chat.code.wrappable'),
    theme: await window.api.preference.get('ui.theme_mode'),
    lineNumbers: await window.api.preference.get('chat.code.show_line_numbers'),
    light: await window.api.preference.get('chat.code.viewer.theme_light')
  }))
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  const name = `code-block-${Date.now()}`
  const source =
    'const greeting = "你好 🥟";  \nfunction greet() {\n\tconst answer = 42;\n\treturn greeting; // ' +
    'wrapping words '.repeat(10) +
    '\n}\n\nconst result = greet();\n\n'
  const addition = '// draft 中文 🥟  '
  let assistantId: string | undefined
  let topicId: string | undefined
  try {
    await page.evaluate(async (light) => {
      await window.api.preference.setMultiple({
        'chat.code.editor.enabled': true,
        'chat.code.wrappable': true,
        'chat.code.show_line_numbers': false,
        'ui.theme_mode': light,
        'chat.code.viewer.theme_light': 'one-light'
      })
    }, ThemeMode.light)
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
    topicId = (topic.data as Topic).id
    const created = await page.evaluate(
      ({ topicId, source }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: `/topics/${topicId}/messages`,
          body: {
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: '```typescript\n' + source + '\n```' }] }
          }
        }),
      { topicId, source }
    )
    expect(created.status).toBe(201)
    const messageId = (created.data as Message).id
    await page.reload({ waitUntil: 'domcontentloaded' })
    const back = page.getByRole('button', { name: '返回', exact: true })
    if (await back.isVisible()) await back.click()
    await page.locator('button[aria-label="对话"]:not([data-tab-id])').click()
    await page.getByRole('button', { name, exact: true }).click()
    const block = page.locator('[data-ui~="part:code-block"]').filter({ hasText: 'TYPESCRIPT' })
    await context.runSteps([{ verb: 'expectVisible', selector: '[data-ui~="part:code-block"] .code-viewer' }])
    await expect(block.locator('.cm-editor')).toHaveCount(0)
    await expect(block.locator('.code-syntax-keyword').first()).toHaveText('const')
    const readColor = await block
      .locator('.code-syntax-keyword')
      .first()
      .evaluate((node) => getComputedStyle(node).color)
    await block.hover()
    await block.getByRole('button', { name: '编辑', exact: true }).click()
    const editor = block.locator('.cm-content')
    await expect(editor).toBeVisible()
    await expect(block.locator('.cm-content .code-syntax-keyword').first()).toHaveCSS('color', readColor)
    await editor.click()
    await editor.press('ControlOrMeta+End')
    await page.keyboard.insertText(addition)
    await editor.press('Shift+Home')
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(addition)
    await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), ThemeMode.dark)
    await expect
      .poll(() =>
        block
          .locator('.code-syntax-keyword')
          .first()
          .evaluate((node) => getComputedStyle(node).color)
      )
      .not.toBe(readColor)
    await expect(editor).toBeFocused()
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(addition)
    await block.hover()
    await block.getByRole('button', { name: '预览', exact: true }).click()
    await expect(block.locator('.cm-editor')).toHaveCount(0)
    await expect(block.locator('.code-viewer')).toContainText(addition.trim())
    await block.hover()
    await block.getByRole('button', { name: '复制源代码', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source + addition)
    const darkColor = await block
      .locator('.code-syntax-keyword')
      .first()
      .evaluate((node) => getComputedStyle(node).color)
    await context.screenshot('code-block-dark-draft')
    await block.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(editor).toBeVisible()
    await expect(block.locator('.cm-content .code-syntax-keyword').first()).toHaveCSS('color', darkColor)
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(addition)
    await editor.press('ControlOrMeta+z')
    await block.getByRole('button', { name: '复制源代码', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
    await editor.press('ControlOrMeta+Shift+z')
    await block.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (id) => window.api.dataApi.request({ id: crypto.randomUUID(), method: 'GET', path: `/messages/${id}` }),
          messageId
        )
        return (response.data as Message).data.parts
      })
      .toEqual([{ type: 'text', text: '```typescript\n' + source + addition + '\n```' }])
    await editor.press('ControlOrMeta+z')
    await block.getByRole('button', { name: '复制源代码', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
    await editor.press('ControlOrMeta+Shift+z')
    await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), ThemeMode.light)
    await page.evaluate(() => window.api.preference.set('chat.code.show_line_numbers', true))
    await expect(block.locator('.cm-lineNumbers')).toBeVisible()
    await context.screenshot('code-block-light-editor')
    await block.getByRole('button', { name: '预览', exact: true }).click()
    await expect(block.locator('.line-number').first()).toBeVisible()
    for (const theme of [ThemeMode.light, ThemeMode.dark]) {
      await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), theme)
      await expect(block.locator('.code-syntax-keyword').first()).toHaveCSS(
        'color',
        theme === ThemeMode.light ? readColor : darkColor
      )
      for (const numbers of [false, true]) {
        await page.evaluate((numbers) => window.api.preference.set('chat.code.show_line_numbers', numbers), numbers)
        for (const wrap of [false, true]) {
          await page.evaluate((wrap) => window.api.preference.set('chat.code.wrappable', wrap), wrap)
          await expect(block.locator('.code-viewer .line')).toHaveCount((source + addition).split('\n').length)
          await expect
            .poll(async () => (await codeAppearance(block)).numbers.length)
            .toBe(numbers ? (source + addition).split('\n').length : 0)
          await expect(block.locator('.line-content span').first()).toHaveCSS('white-space', wrap ? 'pre-wrap' : 'pre')
          const read = await codeAppearance(block)
          await block.hover()
          await switchWithoutSyntaxFlash(block, true)
          await expect(editor).toBeVisible()
          await expect.poll(async () => (await codeAppearance(block)).lines.length).toBe(read.lines.length)
          await expect(async () => expectSameAppearance(read, await codeAppearance(block))).toPass({ timeout: 5000 })
          if (wrap && numbers) await context.screenshot(`code-block-${theme}-aligned-editor`)
          await switchWithoutSyntaxFlash(block, false)
          if (wrap && numbers) await context.screenshot(`code-block-${theme}-aligned-preview`)
        }
      }
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(block.locator('.code-viewer')).toContainText(addition.trim())
  } finally {
    await page.evaluate(
      async ({ originalPreferences, clipboard, topicId, assistantId }) => {
        await window.api.preference.setMultiple({
          'chat.code.editor.enabled': originalPreferences.enabled,
          'chat.code.wrappable': originalPreferences.wrap,
          'chat.code.show_line_numbers': originalPreferences.lineNumbers,
          'ui.theme_mode': originalPreferences.theme,
          'chat.code.viewer.theme_light': originalPreferences.light
        })
        await navigator.clipboard.writeText(clipboard)
        if (assistantId) {
          const deleted = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<unknown>
          if (!deleted.ok) throw new Error(deleted.error.message)
        } else if (topicId) {
          const deleted = (await window.api.ipcApi.request('trash.topic.delete_permanently', {
            topicIds: [topicId]
          })) as IpcResult<unknown>
          if (!deleted.ok) throw new Error(deleted.error.message)
        }
      },
      { originalPreferences, clipboard, topicId, assistantId }
    )
  }
}
