import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir, stat, utimes, readFile, readdir } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { setTimeout } from 'node:timers/promises'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import { openLaunchpadApp, selectSidebarApp } from '../helpers/navigation'
import { noteKnowledgeExport } from '../scenarios/noteKnowledgeExport'
function appleScript(script: string, ...args: string[]): string {
  return execFileSync('osascript', ['-e', script, '--', ...args], { encoding: 'utf8', timeout: 20_000 }).trim()
}

test(...caseDefinition('MP-75'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await attachScreenshot('MP-75 application before Markdown import')
  const directory = join(app.paths.evidence, 'MP-75')
  const notesDirectory = join(directory, 'notes')
  // The case recreates its own notes folder; a previous run's notes would break the exact-one-file check.
  await rm(directory, { recursive: true, force: true })
  await mkdir(notesDirectory, { recursive: true })
  const source = join(directory, 'sample-note.md')
  await writeFile(
    source,
    `${await readFile(app.fixturesPath('documents/sample-note.md'), 'utf8')}\nMP-75 single import\n`
  )
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
  let singleImportedPath: string | undefined
  const verifyImported = async (expected: { path: string; content: string }[]) => {
    await expect.poll(async () => (await readMarkdown(notesDirectory)).length).toBe(expected.length)
    const imported = await readMarkdown(notesDirectory)
    for (const file of expected) {
      const heading = file.content.match(/^#\s+(.+)$/m)?.[1]
      const matching = imported.filter(
        (note) =>
          note.content === file.content &&
          (!singleImportedPath || (file.path === single.path) === (note.path === singleImportedPath))
      )
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
    singleImportedPath = (await readMarkdown(notesDirectory))[0].path
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
    await expect(editor.getByText('The marker is canary-seven at line three.', { exact: false })).toBeInViewport()
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
  const modificationBase = Date.now()
  for (const [index, name] of [alpha, middle, zulu].entries()) {
    // macOS lowers birthtime when mtime predates it; keep creation and modification orders independent.
    const modified = new Date(modificationBase + index * 1000)
    await utimes(join(notesPath, `${name}.md`), modified, modified)
  }
  expect(
    await Promise.all(createdOrder.map(async (name) => (await stat(join(notesPath, `${name}.md`))).birthtimeMs))
  ).toEqual(births)

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

// 这些 helper 只被尚未合并的用例使用（PR B 恢复用例时会再引用）。
void appleScript
