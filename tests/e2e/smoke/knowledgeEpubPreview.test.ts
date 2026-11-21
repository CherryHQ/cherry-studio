import { writeFile } from 'node:fs/promises'

import JSZip from 'jszip'

import type { OutputFor } from '../../../src/shared/ipc/types'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('knowledge base previews EPUB chapters in spine order', async ({ electronApp, mainWindow }, testInfo) => {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  )
  zip.file(
    'OEBPS/book.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test book</dc:title><dc:language>en</dc:language><dc:identifier id="id">test</dc:identifier></metadata><manifest><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="image" href="image.png" media-type="image/png"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'
  )
  zip.file(
    'OEBPS/one.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title></title></head><body><p>Epub chapter one marker</p><img src="image.png" alt="hidden image"/></body></html>'
  )
  zip.file(
    'OEBPS/two.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title></title></head><body><p>Epub chapter two marker</p></body></html>'
  )
  zip.file(
    'OEBPS/image.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8N8AAAAASUVORK5CYII=',
      'base64'
    )
  )
  const filePath = testInfo.outputPath('knowledge-preview.epub')
  await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  const shell = uiLocator(mainWindow, 'app.content')
  const languageSelect = mainWindow.locator('[data-onboarding-language-select]')
  await expect(shell.or(languageSelect).first()).toBeVisible()
  if (await languageSelect.isVisible()) {
    await languageSelect.getByRole('combobox').click()
    await mainWindow.getByRole('option', { name: 'English', exact: false }).click()
    await mainWindow.getByRole('button', { name: 'Set up later', exact: true }).click()
  }
  await expect(shell.first()).toBeVisible({ timeout: 60000 })
  const baseId = await mainWindow.evaluate(async () => {
    const result = (await window.api.ipcApi.request('knowledge.create_base', {
      base: { name: 'EPUB preview smoke', chunkSize: 128, chunkOverlap: 0 }
    })) as { ok: boolean; data?: OutputFor<'knowledge.create_base'>; error?: unknown }
    if (!result.ok || !result.data) throw new Error(JSON.stringify(result.error))
    return result.data.id
  })
  await mainWindow.evaluate(async (id) => {
    const result = (await window.api.ipcApi.request('navigation.open_route_in_main', {
      path: `/app/knowledge?baseId=${encodeURIComponent(id)}`
    })) as { ok: boolean }
    if (!result.ok) throw new Error(JSON.stringify(result))
  }, baseId)
  const original = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
  try {
    await electronApp.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, filePath)
    await mainWindow.getByRole('button', { name: 'Add Data Source' }).click()
    await mainWindow.getByRole('menuitem', { name: 'File', exact: true }).click()
    await expect(mainWindow.getByRole('row').filter({ hasText: 'knowledge-preview.epub' })).toBeVisible({
      timeout: 60000
    })
  } finally {
    await electronApp.evaluate(({ dialog }, saved) => {
      dialog.showOpenDialog = saved
    }, original)
    await original.dispose()
  }
  const row = mainWindow.getByRole('row').filter({ hasText: 'knowledge-preview.epub' })
  await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 120000 })
  await mainWindow.bringToFront()
  const listShot = testInfo.outputPath('epub-knowledge-list.png')
  await mainWindow.screenshot({ path: listShot })
  await testInfo.attach('epub-knowledge-list', { path: listShot, contentType: 'image/png' })
  await row.getByText('knowledge-preview.epub').click()
  const preview = uiLocator(mainWindow, 'file-preview.view').filter({ visible: true }).last()
  await expect(preview.getByRole('navigation', { name: 'Chapters' })).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Chapter 1' })).toBeVisible()
  await expect(preview.getByText('Epub chapter one marker')).toBeVisible()
  await expect(preview.getByText('Text only.', { exact: false })).toBeVisible()
  await expect(preview.getByText('This file type cannot be previewed yet.', { exact: false })).toHaveCount(0)
  await expect(preview.locator('img')).toHaveCount(0)
  await preview.getByRole('button', { name: 'Chapter 2' }).click()
  await expect(preview.getByText('Epub chapter two marker')).toBeVisible()
  await expect(preview.getByText('Epub chapter one marker')).toHaveCount(0)
  await mainWindow.bringToFront()
  const windowShot = testInfo.outputPath('epub-preview-window.png')
  await mainWindow.screenshot({ path: windowShot })
  await testInfo.attach('epub-preview-window', { path: windowShot, contentType: 'image/png' })
  const screenshot = testInfo.outputPath('epub-preview.png')
  await preview.screenshot({ path: screenshot })
  await testInfo.attach('epub-preview', { path: screenshot, contentType: 'image/png' })
})
