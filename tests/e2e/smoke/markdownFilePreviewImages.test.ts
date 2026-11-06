import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { _electron as electron } from '@playwright/test'

import type { OutputFor } from '../../../src/shared/ipc/types'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: testInfo.outputPath('profile') },
      timeout: 60000
    })
    await use(electronApp)
    await electronApp.close()
  }
})

const DIAGRAM_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAWklEQVR4nO3PsQkAIAxE0eziGtYu5LrWzuEMCQgpHlz9uRdjn9Tumqn97gcAAAAAAAAAAAAAQBnQ7VC2DwAAAAAAAAAAAABQB3Q7lO0DAAAAAAAAAAAAAJT7D27qHQBtvuXpAAAAAElFTkSuQmCC'

test('file manager paints document-relative Markdown images', async ({ mainWindow }, testInfo) => {
  const fixtureDirectory = testInfo.outputPath('markdown-images')
  await mkdir(join(fixtureDirectory, 'images'), { recursive: true })
  const documentPath = join(fixtureDirectory, 'note.md')
  await writeFile(join(fixtureDirectory, 'images/diagram.png'), Buffer.from(DIAGRAM_PNG, 'base64'))
  await writeFile(
    join(fixtureDirectory, 'icon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="20" fill="green"/></svg>'
  )
  await writeFile(
    documentPath,
    '# Issue 21981 local images\n\n![](images/diagram.png)\n\n![](./icon.svg)\n\n![reference][x]\n\n[x]: images/diagram.png\n\n![missing](./images/missing.png)'
  )

  const shell = uiLocator(mainWindow, 'app.shell')
  const languageSelect = mainWindow.locator('[data-onboarding-language-select]')
  await expect(shell.or(languageSelect).first()).toBeVisible()
  if (await languageSelect.isVisible()) {
    await languageSelect.getByRole('combobox').click()
    await mainWindow.getByRole('option', { name: 'English', exact: false }).click()
    await mainWindow.getByRole('button', { name: 'Set up later', exact: true }).click()
  }
  await expect(shell.first()).toBeVisible({ timeout: 60000 })

  const { id, physicalPath } = await mainWindow.evaluate(async (path) => {
    const response = (await window.api.ipcApi.request('file.batch_create_internal_entries', {
      items: [{ source: 'path', path, cleanupPolicy: 'manual' }]
    })) as { ok: boolean; data?: OutputFor<'file.batch_create_internal_entries'>; error?: { message?: string } }
    if (!response.ok || !response.data) throw new Error(JSON.stringify(response.error ?? response))
    const { succeeded, failed } = response.data
    const id = succeeded[0]?.id
    if (!id) throw new Error(JSON.stringify(failed))
    const paths = (await window.api.ipcApi.request('file.batch_get_physical_paths', {
      ids: [id]
    })) as { ok: boolean; data?: OutputFor<'file.batch_get_physical_paths'>; error?: { message?: string } }
    if (!paths.ok || !paths.data) throw new Error(JSON.stringify(paths.error ?? paths))
    const physicalPath = paths.data[id]
    if (!physicalPath) throw new Error('Created document has no physical path')
    return { id, physicalPath }
  }, documentPath)

  const physicalDirectory = dirname(physicalPath)
  await mkdir(join(physicalDirectory, 'images'), { recursive: true })
  await copyFile(join(fixtureDirectory, 'images/diagram.png'), join(physicalDirectory, 'images/diagram.png'))
  await copyFile(join(fixtureDirectory, 'icon.svg'), join(physicalDirectory, 'icon.svg'))
  await mainWindow.evaluate(async (entryId) => {
    const response = (await window.api.ipcApi.request('navigation.open_route_in_main', {
      path: `/app/files?entryId=${encodeURIComponent(entryId)}`
    })) as { ok: boolean; error?: { message?: string } }
    if (!response.ok) throw new Error(JSON.stringify(response.error ?? response))
  }, id)

  const preview = uiLocator(mainWindow, 'file-preview.view').filter({ visible: true }).last()
  await expect(preview.getByRole('heading', { name: 'Issue 21981 local images' })).toBeVisible()
  const images = preview.locator('img')
  await expect(images).toHaveCount(3)
  const expectedSources = [
    pathToFileURL(join(physicalDirectory, 'images/diagram.png')).href,
    pathToFileURL(join(physicalDirectory, 'icon.svg')).href,
    pathToFileURL(join(physicalDirectory, 'images/diagram.png')).href
  ]
  for (const [index, src] of expectedSources.entries()) {
    const image = images.nth(index)
    await expect(image).toHaveAttribute('src', src)
    await expect
      .poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.naturalWidth > 0))
      .toBe(true)
  }
  await expect(preview.getByRole('img', { name: 'missing', exact: true })).toHaveText('missing')
  const screenshotPath = testInfo.outputPath('issue-21981-after.png')
  await preview.screenshot({ path: screenshotPath })
  await testInfo.attach('issue-21981-after', { path: screenshotPath, contentType: 'image/png' })
})
