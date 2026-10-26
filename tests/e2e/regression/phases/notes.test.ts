import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir, stat, utimes, readFile, readdir } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { saveNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { expect, test } from '../fixture'
import { openLaunchpadApp, selectSidebarApp } from '../helpers/navigation'
import { noteKnowledgeExport } from '../scenarios/noteKnowledgeExport'
import { notesAndExport } from '../scenarios/notesAndExport'
function appleScript(script: string, ...args: string[]): string {
  return execFileSync('osascript', ['-e', script, '--', ...args], { encoding: 'utf8', timeout: 20_000 }).trim()
}

test(...caseDefinition('MP-11'), async ({ app, mainWindow }, testInfo) => {
  await notesAndExport(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-74'), async ({ mainWindow: page }, testInfo) => {
  testInfo.annotations.push({
    type: 'uncovered',
    description:
      'Notes has no explicit saved-status indicator. Autosave is verified by the bytes on disk and the rendered content instead.'
  })
  // Catch lost autosaves, broken Markdown rendering, and silent overwrites of external edits.
  const directory = await mkdtemp(join(process.cwd(), 'tests/e2e/regression/mp74-'))
  const name = 'MP-74 Markdown conflict'
  const notePath = join(directory, `${name}.md`)
  const original = '# Existing note\n\nExisting content.\n'
  const markdown = [
    '# MP-74 Markdown',
    '',
    '- First list item',
    '- Second list item',
    '',
    '```javascript',
    'const answer = 42;',
    'console.log("MP74", answer);',
    '```',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| Autosave | Verified |'
  ].join('\n')
  const preferences = await page.evaluate(async () => ({
    path: await window.api.preference.get('feature.notes.path'),
    view: await window.api.preference.get('feature.notes.default_view_mode'),
    edit: await window.api.preference.get('feature.notes.default_edit_mode')
  }))
  const screenshot = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }

  try {
    await writeFile(notePath, original)
    await page.evaluate(
      (path) =>
        window.api.preference.setMultiple({
          'feature.notes.path': path,
          'feature.notes.default_view_mode': 'edit',
          'feature.notes.default_edit_mode': 'source'
        }),
      directory
    )
    await page.reload()
    await selectSidebarApp(page, 'Notes')
    const notes = page.locator('[data-ui~="notes.view"]:visible')
    const editor = notes.locator('[data-ui~="notes.editor"][data-file-edit]')
    const source = editor.locator('[contenteditable="true"]')
    await screenshot('MP-74 existing note precondition')
    await notes.getByText(name, { exact: true }).click()
    await expect(source).toContainText('Existing content.')
    await source.fill(markdown)
    await expect(notes.getByText(`Characters: ${markdown.length}`, { exact: true })).toBeVisible()
    await expect.poll(() => readFile(notePath, 'utf8')).toBe(markdown)
    await screenshot('MP-74 autosaved source and character count')

    await notes.getByRole('combobox', { name: 'Source code mode', exact: true }).click()
    await page.getByRole('option', { name: 'Reading mode', exact: true }).click()
    await expect(editor.getByRole('heading', { name: 'MP-74 Markdown', exact: true })).toBeVisible()
    await expect(editor.getByRole('listitem')).toHaveText(['First list item', 'Second list item'])
    const table = editor.getByRole('table')
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Value'])
    await expect(table.getByRole('cell')).toHaveText(['Autosave', 'Verified'])
    const code = editor.locator('pre code')
    await expect(code).toContainText('const answer = 42;')
    await expect(code).toContainText('console.log("MP74", answer);')
    // Distinct visible token colors prove syntax highlighting, rather than just a code container.
    await expect
      .poll(() =>
        code
          .locator('span')
          .evaluateAll(
            (tokens) =>
              new Set(tokens.filter((token) => token.textContent?.trim()).map((token) => getComputedStyle(token).color))
                .size
          )
      )
      .toBeGreaterThan(1)
    await screenshot('MP-74 rendered Markdown with highlighted code')

    await notes.getByRole('combobox', { name: 'Reading mode', exact: true }).click()
    await page.getByRole('option', { name: 'Source code mode', exact: true }).click()
    await expect(source).toContainText('MP-74 Markdown')
    const draft = `${markdown}\n\nUNSAVED_LOCAL_MP74`
    const external = '# External version MP74\n\nWritten by an external editor.\n'
    await source.fill(draft)
    // A real independent filesystem write races the 800 ms autosave debounce; no watcher events are faked.
    await writeFile(notePath, external)
    const conflict = page.getByRole('dialog', { name: 'Note changed on disk', exact: true })
    await expect(conflict).toBeVisible()
    await expect(conflict).toContainText('your unsaved edits will be discarded')
    await expect(conflict.getByRole('button', { name: 'Keep editing', exact: true })).toBeVisible()
    await expect(conflict.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
    await expect(source).toContainText('UNSAVED_LOCAL_MP74')
    expect(await readFile(notePath, 'utf8')).toBe(external)
    await screenshot('MP-74 external conflict and discard warning')
    await conflict.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect(conflict).toBeHidden()
    await expect(source).toContainText('Written by an external editor.')
    await expect(source).not.toContainText('UNSAVED_LOCAL_MP74')
    expect(await readFile(notePath, 'utf8')).toBe(external)

    const keptDraft = `${external}\nKEEP_LOCAL_MP74`
    const secondExternal = '# Second external version MP74\n\nExternal changes must survive.\n'
    await source.fill(keptDraft)
    await writeFile(notePath, secondExternal)
    await expect(conflict).toBeVisible()
    await conflict.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(conflict).toBeHidden()
    await expect(source).toContainText('KEEP_LOCAL_MP74')
    await screenshot('MP-74 keep editing preserves local draft')
    await expect.poll(() => readFile(notePath, 'utf8')).toBe(keptDraft)
    await source.press('End')
    await source.press('Enter')
    await source.pressSequentially('Continued local edit')
    await expect(source).toContainText('Continued local edit')
    await expect.poll(() => readFile(notePath, 'utf8')).toContain('Continued local edit')
  } finally {
    await page.evaluate(
      ({ path, view, edit }) =>
        window.api.preference.setMultiple({
          'feature.notes.path': path,
          'feature.notes.default_view_mode': view,
          'feature.notes.default_edit_mode': edit
        }),
      preferences
    )
    await page.reload()
    await rm(directory, { recursive: true, force: true })
  }
})

test(...caseDefinition('MP-75'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await attachScreenshot('MP-75 application before Markdown import')
  const source = app.fixturesPath('documents/sample-note.md')
  const vault = app.fixturesPath('imports/obsidian-vault')
  const readMarkdown = async (directory: string): Promise<{ path: string; content: string }[]> => {
    const files: { path: string; content: string }[] = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) files.push(...(await readMarkdown(path)))
      else if (entry.name.endsWith('.md')) files.push({ path, content: await readFile(path, 'utf8') })
    }
    return files
  }
  const single = { path: source, content: await readFile(source, 'utf8') }
  const vaultFiles = await readMarkdown(vault)
  expect(vaultFiles.length, 'The source vault must contain Markdown notes').toBeGreaterThan(0)
  const absoluteLinks = [single, ...vaultFiles].flatMap(({ content }) =>
    [...content.matchAll(/\]\(((?:file:\/\/|\/)[^)]+)\)/g)].map((match) => match[1])
  )
  expect(absoluteLinks.length, 'Fixtures must exercise absolute path links').toBeGreaterThan(0)
  const directory = join(app.paths.evidence, 'MP-75')
  const notesDirectory = join(directory, 'notes')
  // The case recreates its own notes folder; a previous run's notes would break the exact-one-file check.
  await rm(directory, { recursive: true, force: true })
  await mkdir(notesDirectory, { recursive: true })
  const invalidPath = join(directory, 'MP-75-invalid.txt')
  await writeFile(invalidPath, 'MP-75 unsupported text file')
  const original = await page.evaluate(async () => ({
    path: await window.api.preference.get('feature.notes.path'),
    view: await window.api.preference.get('feature.notes.default_view_mode')
  }))
  const navigation = page.locator('[data-ui~="notes.navigation"]')
  const drop = async (path: string) => {
    const bounds = await navigation.boundingBox()
    expect(bounds).not.toBeNull()
    const session = await page.context().newCDPSession(page)
    try {
      const data = { items: [], files: [path], dragOperationsMask: 1 }
      const position = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height - 50 }
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
        await session.send('Input.dispatchDragEvent', { type, ...position, data })
      }
    } finally {
      await session.detach()
    }
  }
  const verifyImported = async (expected: { path: string; content: string }[]) => {
    await expect.poll(async () => (await readMarkdown(notesDirectory)).length).toBe(expected.length)
    const imported = await readMarkdown(notesDirectory)
    for (const file of expected) {
      const heading = file.content.match(/^#\s+(.+)$/m)?.[1]
      const matching = imported.filter((note) => note.content === file.content)
      expect(matching, `Imported content must equal ${file.path}`).toHaveLength(1)
      const title = basename(matching[0].path, '.md')
      expect([basename(file.path, '.md'), heading]).toContain(title)
      const relativeFolder = dirname(matching[0].path).slice(notesDirectory.length)
      for (const folder of relativeFolder.split(/[\\/]+/).filter(Boolean)) {
        const row = navigation.getByRole('treeitem').filter({ has: page.getByText(folder, { exact: true }) })
        if ((await row.getAttribute('aria-expanded')) === 'false') await row.click()
      }
      await navigation.getByText(title, { exact: true }).click()
      const editor = page.locator('[data-ui~="notes.editor"][data-file-edit]')
      await expect(editor).toHaveAttribute('data-note-id', matching[0].path.replaceAll('\\', '/'))
      const firstText = file.content
        .split('\n')
        .find((line) => /^#\s+/.test(line))
        ?.replace(/^#\s+/, '')
      if (firstText) await expect(editor).toContainText(firstText)
      for (const match of file.content.matchAll(/\]\(((?:file:\/\/|\/)[^)]+)\)/g)) {
        expect(matching[0].content).toContain(`](${match[1]})`)
      }
    }
  }
  try {
    await page.evaluate(
      (path) =>
        window.api.preference.setMultiple({
          'feature.notes.path': path,
          'feature.notes.default_view_mode': 'read'
        }),
      notesDirectory
    )
    await page.reload()
    await openLaunchpadApp(page, 'Notes')
    await expect(navigation).toBeVisible()
    await drop(source)
    await verifyImported([single])
    await attachScreenshot('MP-75 single Markdown imported')
    await drop(vault)
    await verifyImported([single, ...vaultFiles])
    await attachScreenshot('MP-75 directory imported with original contents and links')
    const before = await readMarkdown(notesDirectory)
    await drop(invalidPath)
    await expect(page.getByText('No valid file was uploaded', { exact: true }).last()).toBeVisible()
    expect(await readMarkdown(notesDirectory)).toEqual(before)
    expect(await readdir(notesDirectory, { recursive: true })).not.toContain(basename(invalidPath))
    await attachScreenshot('MP-75 unsupported TXT rejected')
  } finally {
    await page.evaluate(
      (original) =>
        window.api.preference.setMultiple({
          'feature.notes.path': original.path,
          'feature.notes.default_view_mode': original.view
        }),
      original
    )
  }
})

test(...caseDefinition('MP-76'), async ({ mainWindow: page }, testInfo) => {
  test.setTimeout(120_000)
  const root = await mkdtemp(join(process.cwd(), 'tests/e2e/regression/mp76-notes-'))
  const fixtures = [
    { name: 'Field journal', content: 'First line\nSecond line\nThe marker is canary-seven at line three.' },
    { name: 'canary title only', content: 'An ordinary title match with no bird in its body.' },
    { name: 'canary both', content: 'Both fields contain canary-seven.' },
    { name: 'Shopping list', content: 'Bread, milk, eggs.' },
    { name: 'Meeting minutes', content: 'Discuss the release schedule.' }
  ]
  const originalPath = await page.evaluate(() => window.api.preference.get('feature.notes.path'))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }

  try {
    await Promise.all(fixtures.map(({ name, content }) => writeFile(join(root, `${name}.md`), content)))
    await page.evaluate((path) => window.api.preference.set('feature.notes.path', path), root)
    await page.reload()
    await openLaunchpadApp(page, 'Notes')
    const navigation = page.locator('[data-ui~="notes.navigation"]')
    const result = (name: string) => navigation.getByText(name, { exact: true })
    await screenshot('MP-76 five-note fixture directory')
    for (const { name } of fixtures) await expect(result(name)).toBeVisible()
    await navigation.getByRole('button', { name: 'Search', exact: true }).click()
    const search = navigation.getByRole('textbox')

    const started = Date.now()
    const [frameGaps] = await Promise.all([
      page.evaluate(async () => {
        const gaps: number[] = []
        const start = performance.now()
        let previous = start
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            gaps.push(now - previous)
            previous = now
            if (now - start >= 1000) resolve()
            else requestAnimationFrame(frame)
          }
          requestAnimationFrame(frame)
        })
        return gaps
      }),
      (async () => {
        await search.fill('canary')
        for (const name of ['Field journal', 'canary title only', 'canary both']) {
          await expect(result(name)).toBeVisible({ timeout: 3000 })
        }
        await expect(result('Shopping list')).toHaveCount(0)
        await expect(result('Meeting minutes')).toHaveCount(0)
        expect(Date.now() - started, 'Search results should arrive within 3 seconds').toBeLessThan(3000)
      })()
    ])
    expect(Math.max(...frameGaps), 'Searching must not stall rendering for 500ms').toBeLessThan(500)
    await screenshot('MP-76 canary name and content results')

    const row = (name: string) =>
      navigation.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) })
    await expect(row('Field journal').getByText('Content', { exact: true })).toBeVisible()
    await expect(row('canary both').getByText('Name+Content', { exact: true })).toBeVisible()
    await expect(row('canary title only').getByText(/^(Name\+Content|Content)$/)).toHaveCount(0)
    await expect(navigation.getByText('Found 3 results (Name: 1, Content: 2)', { exact: true })).toBeVisible()
    await result('Field journal').click()
    const editor = page.locator('[data-ui~="notes.editor"][data-file-edit]')
    await expect(editor).toContainText('The marker is canary-seven at line three.')
    await expect(editor.getByText('The marker is canary-seven at line three.', { exact: true })).toBeInViewport()
    await screenshot('MP-76 content result opened at matching text')

    await search.fill('mp76-no-such-word-8f3c9e')
    await expect(navigation.getByText(/Found \d+ results/)).toHaveCount(0, { timeout: 3000 })
    for (const { name } of fixtures) await expect(result(name)).toHaveCount(0)
    await expect(navigation.getByRole('treeitem')).toHaveCount(0)
    await expect(search).toBeEditable()
    await expect(search).toHaveValue('mp76-no-such-word-8f3c9e')
    await screenshot('MP-76 nonexistent keyword empty state')

    await search.fill('title only')
    await expect(result('canary title only')).toBeVisible()
    await expect(navigation.getByRole('treeitem')).toHaveCount(1)
    await search.fill('canary-seven')
    await expect(result('Field journal')).toBeVisible()
    await expect(result('canary both')).toBeVisible()
    await expect(navigation.getByRole('treeitem')).toHaveCount(2)
    await screenshot('MP-76 name and content searches recover after empty results')
  } finally {
    await selectSidebarApp(page, 'Chat')
    await page.evaluate((path) => window.api.preference.set('feature.notes.path', path), originalPath)
    await rm(root, { recursive: true, force: true })
  }
})

test(...caseDefinition('MP-77'), async ({ app, mainWindow: page }, testInfo) => {
  test.skip(app.record.platform !== 'macos', 'PDF/Word inspection and print automation require macOS Preview and Pages')
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const directory = join(app.paths.evidence, 'MP-77')
  const notesDirectory = join(directory, 'notes')
  await mkdir(notesDirectory, { recursive: true })
  const title = 'MP-77 中文导出核对'
  const code = 'const greeting = "你好，世界";'
  const markdown = [
    '# 中文标题',
    '中文段落：笔记导出应保留清晰的文字与正确顺序。',
    '```typescript\n' + code + '\nconsole.log(greeting);\n```',
    '| 项目 | 数量 |\n| --- | --- |\n| 苹果 | 12 |\n| 香蕉 | 34 |',
    ...Array.from({ length: 70 }, (_, index) => `分页段落 ${index + 1}：检查跨页后的中文内容与段落顺序。`),
    'MP77_END'
  ].join('\n\n')
  await writeFile(join(notesDirectory, `${title}.md`), markdown)
  await writeFile(join(notesDirectory, 'MP-77 空笔记.md'), '')
  const original = await page.evaluate(async () => ({
    path: await window.api.preference.get('feature.notes.path'),
    view: await window.api.preference.get('feature.notes.default_view_mode')
  }))
  const menuAction = async (name: string) => {
    await page.locator('[data-ui~="notes.view"]').getByRole('button', { name: 'More', exact: true }).click()
    await page.getByText(name, { exact: true }).click()
  }
  try {
    await page.evaluate(async (path) => {
      await window.api.preference.setMultiple({ 'feature.notes.path': path, 'feature.notes.default_view_mode': 'read' })
    }, notesDirectory)
    await page.reload()
    await openLaunchpadApp(page, 'Notes')
    await page.getByText(title, { exact: true }).click()
    const editor = page.locator('[data-ui~="notes.editor"][data-file-edit]')
    await expect(editor).toContainText('中文标题')
    await expect(editor.locator('table')).toContainText('苹果')
    await expect(editor.locator('pre')).toContainText(code)
    await attachScreenshot('MP-77 source note with Chinese code and table')

    const pdfPath = join(directory, 'MP-77.pdf')
    await menuAction('Export to PDF')
    saveNativeFile('macos', app.paths, pdfPath)
    await expect.poll(async () => (await stat(pdfPath).catch(() => undefined))?.size ?? 0).toBeGreaterThan(0)
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: true }).promise
    expect(pdf.numPages).toBeGreaterThan(1)
    const texts: string[] = []
    for (let index = 1; index <= pdf.numPages; index++) {
      const pdfPage = await pdf.getPage(index)
      const content = await pdfPage.getTextContent()
      const items = content.items.filter((item) => 'str' in item)
      const text = items.map((item) => item.str).join(' ')
      texts.push(text)
      expect(text.trim()).not.toBe('')
      expect(text).not.toContain('\uFFFD')
      for (const item of items) {
        if (item.str.includes('const greeting')) {
          expect(content.styles[item.fontName].fontFamily).toMatch(/monospace/i)
        }
      }
    }
    const pdfText = texts.join(' ')
    for (const expected of ['中文标题', '苹果', '12', '香蕉', '34', code, 'MP77_END']) {
      expect(pdfText).toContain(expected)
    }
    execFileSync('open', ['-a', 'Preview', pdfPath])
    expect(appleScript('tell application "Preview" to get name of every document')).toContain('MP-77.pdf')
    await testInfo.attach('Exported PDF', { path: pdfPath, contentType: 'application/pdf' })

    const wordPath = join(directory, 'MP-77.docx')
    await menuAction('Export to Word')
    saveNativeFile('macos', app.paths, wordPath)
    await expect.poll(async () => (await stat(wordPath).catch(() => undefined))?.size ?? 0).toBeGreaterThan(0)
    const xml = execFileSync('unzip', ['-p', wordPath, 'word/document.xml'], { encoding: 'utf8' })
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('苹果')
    expect(xml).toContain('中文标题')
    const edited = appleScript(
      [
        'on run argv',
        'tell application "Pages"',
        'set doc to open POSIX file (item 1 of argv)',
        'repeat 100 times',
        'if exists body text of doc then exit repeat',
        'delay 0.1',
        'end repeat',
        'set originalText to body text of doc as text',
        'set paragraph 1 of body text of doc to "MP77_EDITED_PARAGRAPH" & return',
        'tell table 1 of doc',
        'set value of cell "B2" to "MP77_EDITED_CELL"',
        'set cellValue to value of cell "B2"',
        'end tell',
        'set resultText to originalText & return & (body text of doc as text) & return & cellValue',
        'close doc saving no',
        'return resultText',
        'end tell',
        'end run'
      ].join('\n'),
      wordPath
    )
    expect(edited).toContain('中文标题')
    expect(edited).toContain('MP77_EDITED_PARAGRAPH')
    expect(edited).toContain('MP77_EDITED_CELL')
    await testInfo.attach('Exported editable Word', {
      path: wordPath,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })

    await menuAction('Print')
    const preview = () =>
      appleScript(
        [
          'on run argv',
          'tell application "System Events"',
          'tell (first application process whose unix id is (item 1 of argv as integer))',
          'set resultText to ""',
          'repeat with element in entire contents of window 1',
          'try',
          'set resultText to resultText & (description of element as text) & " " & (value of element as text) & return',
          'end try',
          'end repeat',
          'return resultText',
          'end tell',
          'end tell',
          'end run'
        ].join('\n'),
        String(app.record.electronPid)
      )
    await expect.poll(preview).toMatch(/page|页/i)
    const previewText = preview()
    await testInfo.attach('Native print preview accessibility', { body: previewText, contentType: 'text/plain' })
    expect(previewText).toMatch(new RegExp(`(?:of|共|/)\\s*${pdf.numPages}(?:\\D|$)`))
    appleScript(
      'on run argv\ntell application "System Events" to tell (first application process whose unix id is (item 1 of argv as integer))\nset frontmost to true\nkey code 53\nend tell\nend run',
      String(app.record.electronPid)
    )
    await pdf.destroy()
    await attachScreenshot('MP-77 note after exports and print preview')

    await page.getByText('MP-77 空笔记', { exact: true }).click()
    await expect(editor).not.toContainText('中文标题')
    const before = (await readdir(directory)).sort()
    for (const action of ['Export to PDF', 'Export to Word']) {
      await menuAction(action)
      await expect(page.getByText('No content to export', { exact: true }).last()).toBeVisible()
      expect((await readdir(directory)).sort()).toEqual(before)
    }
    await attachScreenshot('MP-77 empty note refuses export')
  } finally {
    await page.evaluate(async (original) => {
      await window.api.preference.setMultiple({
        'feature.notes.path': original.path,
        'feature.notes.default_view_mode': original.view
      })
    }, original)
  }
})

test(...caseDefinition('MP-78'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    notesPath: await window.api.preference.get('feature.notes.path'),
    sortType: await window.api.preference.get('feature.notes.sort_type')
  }))
  const notesPath = testInfo.outputPath('mp78-notes')
  const alpha = 'MP78 Alpha'
  const middle = 'MP78 Middle'
  const zulu = 'MP78 Zulu'
  const createdOrder = [zulu, alpha, middle]
  await mkdir(notesPath, { recursive: true })
  for (const name of createdOrder) {
    await writeFile(join(notesPath, `${name}.md`), `# ${name}\nMP-78 sorting fixture\n`)
    await setTimeout(25)
  }
  const births = await Promise.all(
    createdOrder.map(async (name) => (await stat(join(notesPath, `${name}.md`))).birthtimeMs)
  )
  expect(births[0]).toBeLessThan(births[1])
  expect(births[1]).toBeLessThan(births[2])
  for (const [index, name] of [alpha, middle, zulu].entries()) {
    const modified = new Date(Date.UTC(2026, 0, index + 1))
    await utimes(join(notesPath, `${name}.md`), modified, modified)
  }

  const navigation = () => page.locator('[data-ui~="notes.navigation"]')
  const rows = () => navigation().getByRole('treeitem')
  const row = (name: string) => rows().filter({ hasText: name })
  const favorites = () => navigation().getByRole('button', { name: 'Show favorite notes', exact: true })
  const back = () => navigation().getByRole('button', { name: 'Back', exact: true })
  const sorting = () => navigation().getByRole('button', { name: 'Sorting', exact: true })

  try {
    await page.evaluate((notesPath) => window.api.preference.set('feature.notes.path', notesPath), notesPath)
    await page.reload()
    await selectSidebarApp(page, 'Notes')
    await screenshot('MP-78 notes directory initialization')
    const tree = await page.evaluate(async (rootPath) => {
      const result = (await window.api.ipcApi.request('file.tree.create', { rootPath })) as {
        ok: boolean
        data?: { treeId: string }
        error?: unknown
      }
      if (result.data) await window.api.ipcApi.request('file.tree.dispose', { treeId: result.data.treeId })
      return result
    }, notesPath)
    expect(tree.ok, `The real notes directory must load: ${JSON.stringify(tree)}`).toBe(true)
    await expect(rows()).toHaveCount(3)
    for (const name of [alpha, zulu]) {
      await row(name).click()
      const favorite = page.getByRole('button', { name: 'Favorite note', exact: true })
      await expect(favorite).toHaveAttribute('aria-pressed', 'false')
      await favorite.click()
      await expect(page.getByRole('button', { name: 'Unfavorite', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    }
    await favorites().click()
    await expect(rows()).toHaveCount(2)
    await expect(row(alpha)).toBeVisible()
    await expect(row(zulu)).toBeVisible()
    await expect(row(middle)).toHaveCount(0)
    await screenshot('MP-78 two favorite notes only')

    const orders = [
      { label: 'File name (A-Z)', names: [alpha, middle, zulu] },
      { label: 'File name (Z-A)', names: [zulu, middle, alpha] },
      { label: 'Creation time (oldest first)', names: [zulu, alpha, middle] },
      { label: 'Creation time (newest first)', names: [middle, alpha, zulu] },
      { label: 'Update time (oldest first)', names: [alpha, middle, zulu] },
      { label: 'Update time (newest first)', names: [zulu, middle, alpha] }
    ]
    for (const { label, names } of orders) {
      await back().click()
      await sorting().click()
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect(rows()).toHaveText(names)
      await favorites().click()
      await expect(rows()).toHaveText(names.filter((name) => name !== middle))
    }
    await screenshot('MP-78 favorites sorted by update newest first')

    page = await app.restart('authenticated')
    await selectSidebarApp(page, 'Notes')
    await expect(navigation()).toBeVisible()
    // The favorites view is a transient filter that starts closed on every launch, so a restart shows
    // the whole tree again while the star flags themselves stay persisted.
    await screenshot('MP-78 notes immediately after restart')

    if (await back().isVisible()) await back().click()
    await expect(rows()).toHaveText([zulu, middle, alpha])
    await sorting().click()
    await expect(page.getByRole('button', { name: 'Update time (newest first)', exact: true })).toHaveAttribute(
      'data-active',
      'true'
    )
    await page.keyboard.press('Escape')
    for (const name of [alpha, zulu]) {
      await row(name).click()
      await expect(page.getByRole('button', { name: 'Unfavorite', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    }
    await row(middle).click()
    await expect(page.getByRole('button', { name: 'Favorite note', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await favorites().click()
    await expect(rows()).toHaveText([zulu, alpha])
    await screenshot('MP-78 persisted stars and sorting')
  } finally {
    await page.evaluate(
      ({ notesPath, sortType }) =>
        window.api.preference.setMultiple({ 'feature.notes.path': notesPath, 'feature.notes.sort_type': sortType }),
      preferences
    )
  }
})

test(...caseDefinition('MP-79'), async ({ app, mainWindow }, testInfo) => {
  await noteKnowledgeExport(app, mainWindow, testInfo)
})
