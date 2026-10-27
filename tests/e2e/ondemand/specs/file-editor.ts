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
  const largeSource = Array.from(
    { length: 20_000 },
    (_, index) => `export const row${index} = "中文 🥟 ${index}"; // source fixture\n`
  ).join('')
  const largeDigest = digest(largeSource)
  await writeFile(
    join(fixture, 'SKILL.md'),
    `---\nname: ${name}\ndescription: File editor E2E fixture\n---\n# Fixture\n`
  )
  await writeFile(join(fixture, 'sample.ts'), original)
  await writeFile(join(fixture, 'large.ts'), largeSource)
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
