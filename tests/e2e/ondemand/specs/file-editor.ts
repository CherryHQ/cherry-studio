import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect } from '@playwright/test'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import { ThemeMode } from '../../../../src/shared/data/preference/preferenceTypes'
import type { IpcResult } from '../../../../src/shared/ipc/errors/IpcError'
import type { InstalledSkill, SkillResult } from '../../../../src/shared/types/skill'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export default async function fileEditor(context: ScenarioContext): Promise<void> {
  const { page } = context
  await context.ensureChinese()
  const fixture = await mkdtemp(join(tmpdir(), 'cherry-file-editor-'))
  const name = `file-editor-${Date.now()}`
  const original = '\uFEFFconst greeting = "你好 🥟";\r\nconst answer = 42;  \r\n\r\n'
  const addition = '// verified 中文 🥟'
  const pasteSource = 'target\r\ntarget\r\n'
  const jsonClipboard = '["HELLO","WORLD"]'
  const largeSource = Array.from(
    { length: 20_000 },
    (_, index) => `export const row${index} = "中文 🥟 ${index}"; // source fixture\n`
  ).join('')
  const interactionsSource = Array.from({ length: 1_000 }, (_, index) => `const row${index} = "original";`).join('\r\n')
  const largeDigest = digest(largeSource)
  await writeFile(
    join(fixture, 'SKILL.md'),
    `---\nname: ${name}\ndescription: File editor E2E fixture\n---\n# Fixture\n`
  )
  await writeFile(join(fixture, 'sample.ts'), original)
  await writeFile(join(fixture, 'paste.ts'), pasteSource)
  await writeFile(join(fixture, 'large.ts'), largeSource)
  await writeFile(join(fixture, 'interactions.ts'), interactionsSource)
  let skillId: string | undefined
  const originalTheme = await page.evaluate(() => window.api.preference.get('ui.theme_mode'))
  const originalLightTheme = await page.evaluate(() => window.api.preference.get('chat.code.viewer.theme_light'))
  const originalClipboard = await page.evaluate(() => navigator.clipboard.readText())

  try {
    await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), ThemeMode.dark)
    const installed = await page.evaluate(async (directoryPath) => {
      const response = (await window.api.ipcApi.request('skill.install_from_directory', {
        directoryPath
      })) as IpcResult<SkillResult<InstalledSkill>>
      if (!response.ok) throw new Error(response.error.message)
      if (!response.data.success || !response.data.data) throw new Error('Fixture skill installation failed')
      return response.data.data
    }, fixture)
    skillId = installed.id
    const rootPath = await page.evaluate(async (id) => {
      const response = (await window.api.ipcApi.request('skill.folder.resolve', { skillId: id })) as IpcResult<{
        rootPath: string
        access: string
      }>
      if (!response.ok) throw new Error(response.error.message)
      if (response.data.access !== 'read_write') throw new Error('Fixture is not writable')
      return response.data.rootPath
    }, installed.id)
    const savedFile = join(rootPath, 'sample.ts')

    if (await page.getByText('稍后设置', { exact: true }).isVisible()) {
      await page.getByText('稍后设置', { exact: true }).click()
    }
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '技能', exact: true }).click()
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page.getByRole('searchbox').fill(name)
    await page.getByRole('button', { name, exact: true }).click()
    await context.runSteps([{ verb: 'expectVisible', selector: '[data-ui~="skill-file-workspace"]' }])
    await page.getByRole('treeitem', { name: 'paste.ts', exact: true }).click()
    await page.getByRole('radio', { name: '编辑', exact: true }).click()
    const pasteEditor = page.getByRole('textbox', { name: 'paste.ts', exact: true })
    await expect(pasteEditor).toBeVisible()
    await pasteEditor.click()
    await pasteEditor.press('ControlOrMeta+Home')
    await pasteEditor.press('ControlOrMeta+d')
    await pasteEditor.press('ControlOrMeta+d')
    await page.evaluate((text) => navigator.clipboard.writeText(text), jsonClipboard)
    await pasteEditor.press('ControlOrMeta+v')
    const pastedSource = `${jsonClipboard}\r\n${jsonClipboard}\r\n`
    const pastePath = join(rootPath, 'paste.ts')
    await expect.poll(() => readFile(pastePath, 'utf8'), { timeout: 15_000 }).toBe(pastedSource)
    await expect(pasteEditor.locator('[data-line="1"]')).toHaveText(jsonClipboard)
    await expect(pasteEditor.locator('[data-line="2"]')).toHaveText(jsonClipboard)
    await pasteEditor.press('ControlOrMeta+z')
    await expect.poll(() => readFile(pastePath, 'utf8'), { timeout: 15_000 }).toBe(pasteSource)
    await pasteEditor.press('ControlOrMeta+Shift+z')
    await expect.poll(() => readFile(pastePath, 'utf8'), { timeout: 15_000 }).toBe(pastedSource)
    await context.screenshot('file-editor-json-multiselection-paste')

    await page.getByRole('treeitem', { name: 'sample.ts', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'sample.ts', exact: true })
    await expect(editor).toBeVisible()

    await editor.click()
    await editor.press('ControlOrMeta+End')
    await page.keyboard.insertText(addition)
    await expect.poll(() => readFile(savedFile, 'utf8'), { timeout: 15_000 }).toBe(original + addition)
    await editor.press('Shift+Home')
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(addition)

    const colors = await editor.evaluate((node) => ({
      foreground: getComputedStyle(node).color,
      background: getComputedStyle(node.closest('pre') ?? node).backgroundColor,
      keyword: getComputedStyle(node.querySelector('[data-char]') ?? node).color
    }))
    await page.evaluate(async (theme) => {
      await window.api.preference.set('ui.theme_mode', theme)
      await window.api.preference.set('chat.code.viewer.theme_light', 'github-light')
    }, ThemeMode.light)
    await expect
      .poll(() => editor.evaluate((node) => getComputedStyle(node.closest('pre') ?? node).backgroundColor))
      .not.toBe(colors.background)
    await expect.poll(() => editor.evaluate((node) => getComputedStyle(node).color)).not.toBe(colors.foreground)
    await expect
      .poll(() => editor.evaluate((node) => getComputedStyle(node.querySelector('[data-char]') ?? node).color))
      .not.toBe(colors.keyword)
    await expect(editor).toBeFocused()
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await editor.press('ControlOrMeta+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(addition)
    await editor.press('ControlOrMeta+z')
    await expect.poll(() => readFile(savedFile, 'utf8'), { timeout: 15_000 }).toBe(original)
    await editor.press('ControlOrMeta+Shift+z')
    await expect.poll(() => readFile(savedFile, 'utf8'), { timeout: 15_000 }).toBe(original + addition)

    const appearance = await editor.evaluate((node) => {
      const style = getComputedStyle(node)
      return { font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, color: style.color }
    })
    await page.getByRole('radio', { name: '预览', exact: true }).click()
    await expect(editor).toHaveCount(0)
    const source = page.getByRole('textbox', { name: /[/\\]sample\.ts$/ })
    await expect(source).toHaveAttribute('aria-readonly', 'true')
    expect(
      await source.evaluate((node) => {
        const style = getComputedStyle(node)
        return { font: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, color: style.color }
      })
    ).toEqual(appearance)
    await page.getByRole('radio', { name: '编辑', exact: true }).click()
    await expect(editor).toBeVisible()
    await editor.click()
    await editor.press('ControlOrMeta+z')
    await expect.poll(() => readFile(savedFile, 'utf8'), { timeout: 15_000 }).toBe(original)
    await context.screenshot('file-editor-theme-history')

    await page.getByRole('treeitem', { name: 'interactions.ts', exact: true }).click()
    const interactions = page.getByRole('textbox', { name: 'interactions.ts', exact: true })
    const interactionsPath = join(rootPath, 'interactions.ts')
    await expect(interactions).toBeVisible()
    const scrollToMiddle = () =>
      interactions.evaluate((node) => {
        let scroll = (node.getRootNode() as ShadowRoot).host.parentElement
        while (scroll && !/(auto|scroll|overlay)/.test(getComputedStyle(scroll).overflowY))
          scroll = scroll.parentElement
        if (!scroll) throw new Error('Missing file viewport')
        scroll.scrollTop = 500 * parseFloat(getComputedStyle(node).lineHeight)
      })
    await scrollToMiddle()
    const visibleRow = interactions.locator('[data-line="501"]')
    await expect(visibleRow).toBeVisible()
    await visibleRow.click()
    await expect(interactions.locator('[data-line="1"]')).toHaveCount(0)
    await interactions.press(process.platform === 'darwin' ? 'Meta+Alt+f' : 'Control+h')
    await page.getByPlaceholder('Search', { exact: true }).fill('original')
    await page.getByPlaceholder('Replace', { exact: true }).fill('changed!')
    await scrollToMiddle()
    await expect(visibleRow).toBeVisible()
    await expect(interactions.locator('[data-line="1"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Replace All', exact: true }).click()
    const replacedSource = interactionsSource.replaceAll('original', 'changed!')
    expect(await visibleRow.textContent()).toBe('const row500 = "changed!";')
    await expect.poll(() => readFile(interactionsPath, 'utf8'), { timeout: 15_000 }).toBe(replacedSource)
    await context.screenshot('file-editor-scrolled-replace-all')
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await interactions.click()
    await interactions.press('ControlOrMeta+z')
    await expect.poll(() => readFile(interactionsPath, 'utf8'), { timeout: 15_000 }).toBe(interactionsSource)
    await interactions.press('ControlOrMeta+Shift+z')
    await expect.poll(() => readFile(interactionsPath, 'utf8'), { timeout: 15_000 }).toBe(replacedSource)

    await interactions.press('ControlOrMeta+Home')
    const firstInteractionRow = interactions.locator('[data-line="1"]')
    await expect(firstInteractionRow).toBeVisible()
    await firstInteractionRow.click({ position: { x: 2, y: 2 } })
    const dropPoint = await firstInteractionRow.boundingBox()
    if (!dropPoint) throw new Error('Missing drop target')
    const cdp = await page.context().newCDPSession(page)
    const dropText = 'DROP\n中文 🥟\r\n'
    const data = { items: [{ mimeType: 'text/plain', data: dropText }], dragOperationsMask: 1 }
    try {
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
        await cdp.send('Input.dispatchDragEvent', {
          type,
          x: dropPoint.x + 1,
          y: dropPoint.y + dropPoint.height / 2,
          data
        })
      const droppedSource = 'DROP\r\n中文 🥟\r\n' + replacedSource
      await expect.poll(() => readFile(interactionsPath, 'utf8'), { timeout: 15_000 }).toBe(droppedSource)
      await expect(firstInteractionRow).toHaveText('DROP')
      await interactions.press('ControlOrMeta+z')
      await expect.poll(() => readFile(interactionsPath, 'utf8'), { timeout: 15_000 }).toBe(replacedSource)
      await interactions.press('ControlOrMeta+Shift+z')
      await expect.poll(() => readFile(interactionsPath, 'utf8'), { timeout: 15_000 }).toBe(droppedSource)
      await page.getByRole('radio', { name: '预览', exact: true }).click()
      const readOnly = page.getByRole('textbox', { name: /[/\\]interactions\.ts$/ })
      await expect(readOnly).toHaveAttribute('aria-readonly', 'true')
      await readOnly.locator('[data-line="1"]').click({ position: { x: 2, y: 2 } })
      const readOnlyPoint = await readOnly.locator('[data-line="1"]').boundingBox()
      if (!readOnlyPoint) throw new Error('Missing read-only drop target')
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
        await cdp.send('Input.dispatchDragEvent', {
          type,
          x: readOnlyPoint.x + 1,
          y: readOnlyPoint.y + readOnlyPoint.height / 2,
          data
        })
      await readOnly.press('ControlOrMeta+a')
      await readOnly.press('ControlOrMeta+c')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(droppedSource)
      expect(await readFile(interactionsPath, 'utf8')).toBe(droppedSource)
    } finally {
      await cdp.detach()
    }

    await page.getByRole('treeitem', { name: 'large.ts', exact: true }).click()
    await page.getByRole('radio', { name: '预览', exact: true }).click()
    const viewer = page.getByRole('textbox', { name: /[/\\]large\.ts$/ })
    await expect(viewer).toHaveAttribute('aria-readonly', 'true')
    await expect(viewer).toHaveAttribute('contenteditable', 'false')
    await viewer.click()
    await viewer.press('ControlOrMeta+Home')
    await viewer.press('ControlOrMeta+Shift+End')
    await expect(viewer).toBeFocused()
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await viewer.press('ControlOrMeta+c')
    await expect.poll(async () => digest(await page.evaluate(() => navigator.clipboard.readText()))).toBe(largeDigest)

    for (const gesture of ['shift-click', 'drag']) {
      await viewer.press('ControlOrMeta+Home')
      const firstRow = viewer.locator('[data-line="1"]')
      await expect(firstRow).toBeVisible()
      const start = await firstRow.boundingBox()
      if (!start) throw new Error('Missing first source row')
      await page.mouse.click(start.x + 2, start.y + start.height / 2)
      if (gesture === 'drag') {
        await page.mouse.down()
        await page.mouse.move(start.x + 60, start.y + start.height / 2, { steps: 3 })
        await viewer.evaluate(() => new Promise(requestAnimationFrame))
      }
      await viewer.evaluate((node) => {
        let scroll = (node.getRootNode() as ShadowRoot).host.parentElement
        while (scroll && !/(auto|scroll|overlay)/.test(getComputedStyle(scroll).overflowY))
          scroll = scroll.parentElement
        if (!scroll) throw new Error('Missing source viewport')
        scroll.scrollTop = scroll.scrollHeight
      })
      await expect(firstRow).toHaveCount(0)
      const end = await viewer.locator('[data-line]').evaluateAll((rows) => {
        let scroll = (rows[0]?.getRootNode() as ShadowRoot).host.parentElement
        while (scroll && !/(auto|scroll|overlay)/.test(getComputedStyle(scroll).overflowY))
          scroll = scroll.parentElement
        if (!scroll) throw new Error('Missing source viewport')
        const viewport = scroll.getBoundingClientRect()
        const visible = rows
          .map((row) => row.getBoundingClientRect())
          .filter(
            (rect) => rect.top >= Math.max(0, viewport.top) && rect.bottom <= Math.min(innerHeight, viewport.bottom)
          )
        const last = visible.at(-1)
        if (!last) throw new Error('Missing visible source row')
        return { x: last.right - 2, y: last.top + last.height / 2 }
      })
      if (gesture === 'drag') {
        await page.mouse.move(end.x, end.y, { steps: 3 })
        await page.mouse.up()
      } else {
        await page.keyboard.down('Shift')
        await page.mouse.click(end.x, end.y)
        await page.keyboard.up('Shift')
      }
      await page.evaluate(() => navigator.clipboard.writeText(''))
      await viewer.press('ControlOrMeta+c')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('row10000 =')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^export const row0 =/)
    }

    await viewer.press('Backspace')
    await viewer.press('ControlOrMeta+x')
    await viewer.press('ControlOrMeta+v')
    await page.keyboard.insertText('readonly mutation')
    await viewer.press('ControlOrMeta+z')
    await viewer.press('ControlOrMeta+/')
    await viewer.press('ControlOrMeta+a')
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await viewer.press('ControlOrMeta+c')
    await expect.poll(async () => digest(await page.evaluate(() => navigator.clipboard.readText()))).toBe(largeDigest)
    expect(digest(await readFile(join(rootPath, 'large.ts'), 'utf8'))).toBe(largeDigest)
    await context.screenshot('file-viewer-virtual-selection')

    await page.getByRole('radio', { name: '编辑', exact: true }).click()
    const largeEditor = page.getByRole('textbox', { name: 'large.ts', exact: true })
    await largeEditor.click()
    let expectedSource = largeSource
    for (const suffix of ['// typed after jump', ' second jump']) {
      await largeEditor.press('ControlOrMeta+Home')
      await largeEditor.press('ControlOrMeta+End')
      await page.keyboard.type(suffix, { delay: 20 })
      expectedSource += suffix
      await expect
        .poll(async () => digest(await readFile(join(rootPath, 'large.ts'), 'utf8')), { timeout: 15_000 })
        .toBe(digest(expectedSource))
    }
  } catch (error) {
    await context.screenshot('file-editor-failure')
    throw error
  } finally {
    const back = page.getByRole('button', { name: '返回', exact: true }).last()
    if (await back.isVisible()) await back.click()
    await expect(page.locator('[data-ui~="skill-file-workspace"]')).toHaveCount(0)
    await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), originalTheme)
    await page.evaluate((theme) => window.api.preference.set('chat.code.viewer.theme_light', theme), originalLightTheme)
    await page.evaluate((value) => navigator.clipboard.writeText(value), originalClipboard)
    if (skillId) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible()
      await page.evaluate((id) => window.api.ipcApi.request('skill.uninstall', { skillId: id }), skillId)
    }
    await rm(fixture, { recursive: true, force: true })
  }
}
