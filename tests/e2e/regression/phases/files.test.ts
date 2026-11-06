import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile, access, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

import * as XLSX from '@e965/xlsx'
import type { Locator } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'

import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { AssistantSchema } from '@shared/data/types/assistant'
import { FileEntrySchema, InternalEntrySchema } from '@shared/data/types/file'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { InputFor, OutputFor } from '@shared/ipc/types'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { evaluateCdpExpression } from '../../../../scripts/e2e/regression/cdpClient'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { expect, test } from '../fixture'
import { createRtfPreviewFixtures } from '../fixtures/rtfPreviewFixtures'
import { openAttachmentPicker, submitChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection } from '../helpers/settings'
import { collectVirtualizedText } from '../helpers/virtualList'

test(...caseDefinition('MP-150'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const fixtures = await createRtfPreviewFixtures(join(app.paths.fixtures, 'MP-150'))
  testInfo.annotations.push({
    type: 'coverage-note',
    description: 'Chat transport uses the repository mock; Files preview rendering is real.'
  })
  testInfo.annotations.push({
    type: 'uncovered',
    description:
      'Ordinary Chat opens RTF attachments through the native file handler; it has no RTF side panel. A 360px side panel and Shift-JIS/Big5 fixtures are not covered.'
  })
  const preferences = await page.evaluate(async () => ({
    theme: await window.api.preference.get('ui.theme_mode'),
    naming: await window.api.preference.get('topic.naming.enabled'),
    browser: await window.api.preference.get('app.browser.open_links_in_browser')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const upload = async (name: string, button: Locator) => {
    await button.click({ noWaitAfter: true })
    chooseNativeFile(app.record.platform, app.paths, fixtures[name])
  }
  const filesView = () => page.locator('[data-ui~="files.view"]:visible')
  const filePreview = (name: string) => filesView().getByRole('region', { name, exact: true })
  const previewEntryIds = new Map<string, string>()
  const openLibraryFile = async (name: string) => {
    let id = previewEntryIds.get(name)
    if (!id) {
      let matches: { id: string }[] = []
      await expect
        .poll(async () => {
          matches = (await entries()).filter(
            (entry) => !originalIds.has(entry.id) && `${entry.name}.${entry.ext}` === name
          )
          return matches.length
        }, `The first preview must identify one newly imported ${name}`)
        .toBe(1)
      id = matches[0].id
      previewEntryIds.set(name, id)
    }
    await filesView()
      .locator(`[data-ui~="files.row"][data-file-entry-id="${id}"]:visible`)
      .getByText(name, { exact: true })
      .click()
    await expect(filePreview(name)).toBeVisible()
  }
  const assertRichDocument = async (preview: Locator) => {
    await expect(preview.getByText('中文富文本预览', { exact: true })).toBeVisible()
    await expect(preview).not.toContainText('\\rtf1')
    await expect(preview.getByText('Bold MP150', { exact: true })).toHaveCSS('font-weight', /^(bold|[7-9]00)$/)
    await expect(preview.getByText('Italic MP150', { exact: true })).toHaveCSS('font-style', 'italic')
    await expect(preview.locator('[contenteditable="true"], textarea, input')).toHaveCount(0)
    const image = preview.getByRole('img').first()
    await expect(image).toBeVisible()
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0))
      .toBe(true)
  }
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const providerId = `mp150-${Date.now()}`
  let assistantId: string | undefined
  let inspectorUrl: string | undefined
  const entries = async () => {
    const items: { id: string; name: string; ext: string | null }[] = []
    let cursor: string | undefined
    do {
      const response = await page.evaluate(
        (cursor) =>
          window.api.dataApi.request({
            id: 'mp150-read-files',
            method: 'GET',
            path: '/files/entries',
            params: { limit: 100, cursor }
          }),
        cursor
      )
      expect(response.status).toBe(200)
      const data = response.data as { items: typeof items; nextCursor?: string }
      items.push(...data.items)
      cursor = data.nextCursor
    } while (cursor)
    return items
  }
  const originalIds = new Set((await entries()).map(({ id }) => id))
  try {
    await test.step('1. Upload simple.rtf through Files and assert formatted read-only content', async () => {
      await selectSidebarApp(page, 'Files')
      const back = filesView().getByRole('button', { name: 'Back', exact: true })
      if (await back.isVisible()) await back.click()
      await upload('simple.rtf', filesView().getByRole('button', { name: 'Upload files', exact: true }))
      await openLibraryFile('simple.rtf')
      await screenshot('MP-150 Files RTF preview')
      await assertRichDocument(filePreview('simple.rtf'))
    })

    await test.step('2. Preserve RTF and image attachments when sending a new conversation', async () => {
      const seeded = await page.evaluate(
        async ({ providerId, baseUrl, modelId }) => {
          const request = window.api.dataApi.request
          const provider = await request({
            id: 'mp150-provider',
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: 'MP150 mock',
              defaultChatEndpoint: 'openai-chat-completions',
              endpointConfigs: { 'openai-chat-completions': { baseUrl } },
              apiKeys: [{ id: 'mock', key: 'mock-key', isEnabled: true }]
            }
          })
          const enabled = await request({
            id: 'mp150-provider-enable',
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: { isEnabled: true }
          })
          const models = await request({
            id: 'mp150-model',
            method: 'POST',
            path: '/models',
            body: [
              { providerId, modelId, endpointTypes: ['openai-chat-completions'], capabilities: ['image-recognition'] }
            ]
          })
          const assistant = await request({
            id: 'mp150-assistant',
            method: 'POST',
            path: '/assistants',
            body: { name: 'MP150 RTF assistant', modelId: `${providerId}::${modelId}` }
          })
          return { provider, enabled, models, assistant }
        },
        { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
      )
      expect(seeded.provider.status).toBe(201)
      expect(seeded.enabled.status).toBe(200)
      expect((seeded.enabled.data as { isEnabled: boolean }).isEnabled).toBe(true)
      expect(seeded.models.status).toBe(201)
      expect(createUniqueModelId(providerId, server.modelId)).toBe(`${providerId}::${server.modelId}`)
      assistantId = AssistantSchema.parse(seeded.assistant.data).id
      const topic = await page.evaluate(async (assistantId) => {
        await window.api.preference.set('topic.naming.enabled', false)
        return window.api.dataApi.request({
          id: 'mp150-topic',
          method: 'POST',
          path: '/topics',
          body: { name: 'MP150 RTF topic', assistantId }
        })
      }, assistantId)
      expect(topic.status).toBe(201)
      TopicSchema.parse(topic.data)
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      const group = page
        .locator('[data-ui~="chat.view"]:visible [data-ui~="chat.group-header"][data-ui~="part:context-menu-trigger"]')
        .filter({ hasText: 'MP150 RTF assistant' })
      await group.hover()
      const expand = group.getByRole('button', { name: 'Expand', exact: true })
      if (await expand.isVisible()) await expand.click()
      await page.getByTestId('topic-list-row').filter({ hasText: 'MP150 RTF topic' }).click()
      await page
        .locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]')
        .fill('Read the attached documents.')
      for (const name of ['simple.rtf', 'contrast.png', 'gbk.rtf']) {
        await openAttachmentPicker(page, page.locator('[data-ui~="chat.composer"]:visible'))
        chooseNativeFile(app.record.platform, app.paths, fixtures[name])
        await expect(page.locator('[data-ui~="chat.composer"]').getByText(name, { exact: true })).toBeVisible()
      }
      await Promise.all([
        submitChatMarker(page, 'MP150 attachments received'),
        (async () => {
          const request = await server.nextRequest()
          expect(JSON.stringify(request.body.messages), 'The sent draft must retain its image attachment').toContain(
            'image_url'
          )
          request.complete('MP150 attachments received')
        })()
      ])
      const messages = page.locator('[data-ui~="chat.message"]:visible')
      for (const name of ['simple', 'gbk'])
        await expect(messages.getByRole('button', { name, exact: true })).toBeVisible()
      await screenshot('MP-150 sent RTF attachment cards')
    })

    await test.step('3. Decode an actual GBK document', async () => {
      await selectSidebarApp(page, 'Files')
      await openLibraryFile('gbk.rtf')
      const preview = filePreview('gbk.rtf')
      await expect(preview.getByText('中文旧文档', { exact: true })).toBeVisible()
      await expect(preview).not.toContainText('�')
      await preview.getByRole('button', { name: 'Back', exact: true }).click()
    })

    await test.step('4. Reject oversized and truncated RTF without a blank screen or crash', async () => {
      await selectSidebarApp(page, 'Files')
      for (const name of ['big.rtf', 'truncated.rtf']) {
        await upload(name, filesView().getByRole('button', { name: 'Upload files', exact: true }))
        await openLibraryFile(name)
        const error = filePreview(name).getByRole('alert')
        await expect(error).toBeVisible()
        await expect(error).toContainText(/large|limit|corrupt|invalid|unsupported|cannot|failed|unable|error/i)
        await screenshot(`MP-150 ${name} readable error`)
        await filePreview(name).getByRole('button', { name: 'Back', exact: true }).click()
        await expect(filesView().getByRole('button', { name: 'Upload files', exact: true })).toBeVisible()
      }
    })

    await test.step('5. Switch documents and images without stale content', async () => {
      for (const name of ['simple.rtf', 'gbk.rtf']) {
        await openLibraryFile(name)
        const preview = filePreview(name)
        if (name === 'simple.rtf') await assertRichDocument(preview)
        else {
          await expect(preview.getByText('Bold MP150', { exact: true })).toHaveCount(0)
          await expect(preview.getByText('中文旧文档', { exact: true })).toBeVisible()
        }
        await preview.getByRole('button', { name: 'Back', exact: true }).click()
      }
      await filesView().getByText('contrast.png', { exact: true }).click()
      const imageDialog = page.getByTestId('image-preview-dialog')
      const image = imageDialog.getByTestId('image-preview-viewport').locator('img')
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
      await imageDialog.getByRole('button', { name: 'Close Preview', exact: true }).click()
    })

    await test.step('6. Keep light and dark Files previews readable', async () => {
      await openLibraryFile('simple.rtf')
      const preview = filePreview('simple.rtf')
      for (const theme of [ThemeMode.light, ThemeMode.dark]) {
        await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), theme)
        await assertRichDocument(preview)
        const text = preview.getByText('中文富文本预览', { exact: true })
        await expect(text).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)')
        await expect(preview).toHaveCSS('filter', 'none')
        await screenshot(`MP-150 ${theme} Files preview`)
      }
    })

    await test.step('7. Dispatch safe external links and block unsafe protocols', async () => {
      await page.evaluate(() => window.api.preference.set('app.browser.open_links_in_browser', false))
      const inspectorArg = app.record.args.find((arg) => /^--inspect(?:-brk)?=/.test(arg))
      const port = inspectorArg?.split('=').at(-1)?.split(':').at(-1) ?? '9229'
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        type: string
        webSocketDebuggerUrl: string
      }>
      inspectorUrl = targets.find((target) => target.type === 'node')?.webSocketDebuggerUrl
      expect(inspectorUrl).toBeTruthy()
      // Observe the actual OS dispatch boundary; never replace the parser, sanitization or link handlers.
      await evaluateCdpExpression(
        inspectorUrl!,
        `(() => { const { shell } = process.mainModule.require('electron'); globalThis.__mp150 = { original: shell.openExternal, urls: [] }; shell.openExternal = async (url) => { globalThis.__mp150.urls.push(url) } })()`
      )
      const preview = filePreview('simple.rtf')
      const originalUrl = page.url()
      for (const [label, url] of [
        ['HTTPS MP150', 'https://example.com/mp150'],
        ['HTTP MP150', 'http://example.com/mp150'],
        ['Email MP150', 'mailto:mp150@example.com']
      ]) {
        await preview.getByRole('link', { name: label, exact: true }).click()
        await expect
          .poll(() => evaluateCdpExpression<string[]>(inspectorUrl!, 'globalThis.__mp150.urls'))
          .toContain(url)
      }
      const safe = await evaluateCdpExpression<string[]>(inspectorUrl!, 'globalThis.__mp150.urls')
      for (const label of ['Unsafe JS MP150', 'Unsafe File MP150'])
        await preview.getByText(label, { exact: true }).click()
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      )
      expect(await evaluateCdpExpression(inspectorUrl!, 'globalThis.__mp150.urls')).toEqual(safe)
      expect(page.url()).toBe(originalUrl)
      await assertRichDocument(preview)
      await evaluateCdpExpression(
        inspectorUrl!,
        `(() => { process.mainModule.require('electron').shell.openExternal = globalThis.__mp150.original; delete globalThis.__mp150 })()`
      )
      inspectorUrl = undefined
    })

    await test.step('8. Restart Electron and reopen the persisted RTF', async () => {
      page = await app.restart()
      await selectSidebarApp(page, 'Files')
      const restoredPreview = filePreview('simple.rtf')
      await expect(restoredPreview).toBeVisible()
      await restoredPreview.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(restoredPreview).toBeHidden()
      await openLibraryFile('simple.rtf')
      await assertRichDocument(filePreview('simple.rtf'))
      await screenshot('MP-150 formatted RTF after restart')
    })
  } finally {
    await server.close()
    if (inspectorUrl)
      await evaluateCdpExpression(
        inspectorUrl,
        `(() => { if (globalThis.__mp150) { process.mainModule.require('electron').shell.openExternal = globalThis.__mp150.original; delete globalThis.__mp150 } })()`
      )
    await page.evaluate(
      async ({ preferences, assistantId, providerId }) => {
        await window.api.preference.setMultiple({
          'ui.theme_mode': preferences.theme,
          'topic.naming.enabled': preferences.naming,
          'app.browser.open_links_in_browser': preferences.browser
        })
        if (assistantId) {
          const deleted = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<unknown>
          if (!deleted.ok) throw new Error(deleted.error.message)
        }
        await window.api.dataApi.request({
          id: 'mp150-delete-provider',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { preferences, assistantId, providerId }
    )
    // Files-page uploads are internal entries, so automatic cleanup never removes them.
    const owned = (await entries()).filter(({ id }) => !originalIds.has(id)).map(({ id }) => id)
    if (owned.length) {
      const trashed = (await page.evaluate(
        (ids) => window.api.ipcApi.request('file.batch_trash', { ids }),
        owned
      )) as IpcResult<OutputFor<'file.batch_trash'>>
      if (!trashed.ok) throw new Error(trashed.error.message)
      expect(trashed.data.failed, 'Trashing the uploaded RTF entries must not fail').toEqual([])
      const purged = (await page.evaluate(
        (ids) => window.api.ipcApi.request('file.batch_permanent_delete_from_trash', { ids }),
        owned
      )) as IpcResult<OutputFor<'file.batch_permanent_delete_from_trash'>>
      if (!purged.ok) throw new Error(purged.error.message)
      expect(purged.data.failed, 'Permanent deletion must not fail for any uploaded RTF entry').toEqual([])
    }
  }
})

test(...caseDefinition('MP-68'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const root = await mkdtemp(join(process.cwd(), 'tests/e2e/regression/mp68-assets-'))
  const upload = join(root, 'upload')
  const documents = app.fixturesPath('documents')
  const images = app.fixturesPath('images')
  const video = join(root, 'video')
  await Promise.all([upload, documents, images, video].map((path) => mkdir(path, { recursive: true })))
  const movie = join(video, 'sample-5s.mp4')
  await copyFile(app.fixturesPath('media', 'sample-5s.mp4'), movie)
  await copyFile(join(documents, 'sample.pdf'), join(upload, 'sample.pdf'))
  await copyFile(join(images, 'sample.png'), join(upload, 'sample.png'))
  const fixtures = [
    { name: 'sample.pdf', path: join(documents, 'sample.pdf'), category: 'Document', format: 'PDF' },
    { name: 'sample.png', path: join(images, 'sample.png'), category: 'Image', format: 'PNG' },
    { name: 'sample-5s.mp4', path: movie, category: 'Video', format: 'MP4' }
  ]
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const view = () => page.locator('[data-ui~="files.view"]')
  const row = (name: string) =>
    view()
      .locator('[data-ui~="files.row"]')
      .filter({ has: page.getByText(name, { exact: true }) })
  const entries = async () => {
    const items: { id: string; name: string; ext: string; size: number; origin: string }[] = []
    let cursor: string | undefined
    do {
      const response = await page.evaluate(
        (cursor) =>
          window.api.dataApi.request({
            id: 'mp68-read-files',
            method: 'GET',
            path: '/files/entries',
            params: { limit: 100, cursor }
          }),
        cursor
      )
      expect(response.status).toBe(200)
      const data = response.data as { items: typeof items; nextCursor?: string }
      items.push(...data.items)
      cursor = data.nextCursor
    } while (cursor)
    return items
  }
  const drop = async (path: string, removeBeforeDrop = false) => {
    // A browser-backed File retains its real path; a synthetic new File does not in Electron.
    const input = await page.evaluateHandle(() => {
      const input = document.createElement('input')
      input.type = 'file'
      document.body.append(input)
      return input
    })
    try {
      await input.asElement()!.setInputFiles(path)
      if (removeBeforeDrop) await rm(path)
      await view()
        .locator('[data-ui~="files.content"]')
        .evaluate((target, input) => {
          const dataTransfer = new DataTransfer()
          dataTransfer.items.add(input.files![0])
          target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
        }, input)
    } finally {
      await input.evaluate((element) => element.remove())
      await input.dispose()
    }
  }
  const originalIds = new Set((await entries()).map(({ id }) => id))
  try {
    const chooseFiles = async (path: string, multiple: boolean) => {
      await view().getByRole('button', { name: 'Upload files', exact: true }).click()
      if (app.record.platform !== 'macos') throw new Error('MP-68 multi-file native chooser requires macOS automation')
      const script = [
        'on run argv',
        'tell application "System Events"',
        'tell (first application process whose unix id is (item 2 of argv as integer))',
        'set frontmost to true',
        'log "MP-68 waiting for native Open dialog"',
        'repeat 100 times',
        'if exists (first button of splitter group 1 of window 1 whose name is "Open" or name is "打开") then exit repeat',
        'delay 0.1',
        'end repeat',
        'if not (exists (first button of splitter group 1 of window 1 whose name is "Open" or name is "打开")) then error "Native file dialog was not found"',
        'log "MP-68 native dialog found"',
        'keystroke "g" using {command down, shift down}',
        'repeat 100 times',
        'if exists text field 1 of sheet 1 of window 1 then exit repeat',
        'delay 0.1',
        'end repeat',
        'if not (exists text field 1 of sheet 1 of window 1) then error "Go to Folder input was not found"',
        'keystroke "a" using command down',
        'keystroke (item 1 of argv)',
        'delay 0.5',
        'key code 36',
        'repeat 100 times',
        'if not (exists sheet 1 of window 1) then exit repeat',
        'delay 0.1',
        'end repeat',
        'delay 1',
        ...(multiple ? ['key code 36', 'delay 0.5', 'keystroke "a" using command down'] : []),
        'delay 0.3',
        'click (first button of splitter group 1 of window 1 whose name is "Open" or name is "打开")',
        'end tell',
        'end tell',
        'end run'
      ].join('\n')
      execFileSync('osascript', ['-e', script, '--', multiple ? `${path}/` : path, String(app.record.electronPid)], {
        timeout: 45_000,
        stdio: 'inherit'
      })
    }
    await selectSidebarApp(page, 'Files')
    await expect(view()).toBeVisible()
    await screenshot('MP-68 file library before upload')
    await chooseFiles(upload, true)
    await expect(row('sample.pdf')).toBeVisible()
    await expect(row('sample.png')).toBeVisible()
    await drop(movie)
    await expect(row('sample-5s.mp4')).toBeVisible()
    await screenshot('MP-68 document image and video uploaded')
    for (const fixture of fixtures) {
      const size = (await stat(fixture.path)).size
      const stored = (await entries()).filter((entry) => `${entry.name}.${entry.ext}` === fixture.name)
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({ origin: 'internal', size })
      await expect(row(fixture.name)).toContainText(fixture.format)
      const sizeText = await row(fixture.name).locator('[data-ui~="part:file-size"]').innerText()
      const match = /^(\d+(?:\.\d+)?) (B|KB|MB|GB)$/.exec(sizeText)
      expect(match, `Visible size for ${fixture.name}`).not.toBeNull()
      const factor = 1024 ** ['B', 'KB', 'MB', 'GB'].indexOf(match![2])
      const precision = match![1].includes('.') ? 0.1 : 1
      expect(Math.abs(Number(match![1]) * factor - size)).toBeLessThanOrEqual((factor * precision) / 2)
      await view().locator('[data-ui~="files.navigation"]').getByText(fixture.category, { exact: true }).click()
      await expect(view().getByText(fixture.name, { exact: true })).toBeVisible()
      for (const other of fixtures.filter((other) => other !== fixture)) {
        await expect(view().getByText(other.name, { exact: true })).toHaveCount(0)
      }
      await view().locator('[data-ui~="files.navigation"]').getByText('All Files', { exact: true }).click()
    }
    const pdfId = (await entries()).find((entry) => entry.ext === 'pdf' && entry.name === 'sample')!.id
    await chooseFiles(join(documents, 'sample.pdf'), false)
    await expect
      .poll(async () => (await entries()).filter((entry) => entry.ext === 'pdf' && entry.name === 'sample').length)
      .toBe(2)
    await expect(row('sample.pdf')).toHaveCount(2)
    const pdfIds = (await entries())
      .filter((entry) => entry.ext === 'pdf' && entry.name === 'sample')
      .map(({ id }) => id)
    expect(new Set(pdfIds).size).toBe(2)
    expect(pdfIds).toContain(pdfId)
    const interrupted = join(root, 'interrupted.pdf')
    await copyFile(join(documents, 'sample.pdf'), interrupted)
    await drop(interrupted, true)
    await expect(page.getByText(/Failed to import files|Some files could not be imported/)).toBeVisible()
    await expect(view().getByText('interrupted.pdf', { exact: true })).toHaveCount(0)
    await screenshot('MP-68 failed import reports an error')
    const before = (await entries()).filter((entry) =>
      fixtures.some((fixture) => `${entry.name}.${entry.ext}` === fixture.name)
    )
    expect(before).toHaveLength(4)
    expect(before.map(({ id }) => id)).toEqual(expect.arrayContaining(pdfIds))
    await page.reload()
    await selectSidebarApp(page, 'Files')
    for (const fixture of fixtures) await expect(row(fixture.name)).toHaveCount(fixture.name === 'sample.pdf' ? 2 : 1)
    expect((await entries()).filter((entry) => before.some(({ id }) => id === entry.id))).toEqual(before)
    page = await app.restart()
    await selectSidebarApp(page, 'Files')
    for (const fixture of fixtures) await expect(row(fixture.name)).toHaveCount(fixture.name === 'sample.pdf' ? 2 : 1)
    expect((await entries()).filter((entry) => before.some(({ id }) => id === entry.id))).toEqual(before)
    await screenshot('MP-68 files persist after restart')
  } finally {
    try {
      const ids = (await entries()).filter(({ id }) => !originalIds.has(id)).map(({ id }) => id)
      if (ids.length) {
        // Uploads here are internal entries, which only leave through trash and permanent deletion.
        const trashed = (await page.evaluate(
          (ids) => window.api.ipcApi.request('file.batch_trash', { ids }),
          ids
        )) as IpcResult<OutputFor<'file.batch_trash'>>
        if (!trashed.ok) throw new Error(trashed.error.message)
        expect(trashed.data.failed, 'Trashing the uploaded entries must not fail for any entry').toEqual([])
        const purged = (await page.evaluate(
          (ids) => window.api.ipcApi.request('file.batch_permanent_delete_from_trash', { ids }),
          ids
        )) as IpcResult<OutputFor<'file.batch_permanent_delete_from_trash'>>
        if (!purged.ok) throw new Error(purged.error.message)
        expect(purged.data.failed, 'Permanent deletion must not fail for any uploaded entry').toEqual([])
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test(...caseDefinition('MP-69'), async ({ app, mainWindow: page }, testInfo) => {
  const root = await mkdtemp(join(process.cwd(), 'tests/e2e/regression/mp69-assets-'))
  const prefix = `mp69-${Date.now()}`
  const fixtures = [
    { name: `${prefix}-sample.pdf`, type: 'document', label: 'Document' },
    { name: `${prefix}-sample.png`, type: 'image', label: 'Image' },
    { name: `${prefix}-sample.mp4`, type: 'video', label: 'Video' },
    { name: `${prefix}-sample.wav`, type: 'audio', label: 'Audio' },
    { name: `${prefix}-sample.bin`, type: 'other', label: 'Other' },
    { name: `${prefix}-control.pdf`, type: 'document', label: 'Document' }
  ] as const
  const ids: string[] = []
  const view = page.locator('[data-ui~="files.view"]')
  const navigation = view.locator('[data-ui~="files.navigation"]')
  const content = view.locator('[data-ui~="files.content"]')
  const fileRequest = async <
    R extends 'file.batch_create_internal_entries' | 'file.batch_trash' | 'file.batch_permanent_delete_from_trash'
  >(
    route: R,
    input: InputFor<R>
  ) => {
    const result = (await page.evaluate(({ route, input }) => window.api.ipcApi.request(route, input), {
      route,
      input
    })) as IpcResult<OutputFor<R>>
    if (!result.ok) throw new Error(`${route}: ${result.error.message}`)
    return result.data
  }
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readFiles = async (type?: string) => {
    const response = await page.evaluate(
      (type) =>
        window.api.dataApi.request({
          id: 'mp69-read-files',
          method: 'GET',
          path: '/files/entries',
          params: { limit: 100, inTrash: false, ...(type ? { fileType: type } : {}) }
        }),
      type
    )
    expect(response.status).toBe(200)
    return response.data as {
      items: { id: string; name: string; ext: string | null }[]
      total: number
      nextCursor?: string
    }
  }

  try {
    // Real files establish the precondition; filtering and searching use the application UI.
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText(`MP-69 sample ${prefix}`)
    await writeFile(join(root, fixtures[0].name), await pdf.save())
    const control = await PDFDocument.create()
    control.addPage().drawText(`MP-69 nonmatching control ${prefix}`)
    await writeFile(join(root, fixtures[5].name), await control.save())
    await writeFile(
      join(root, fixtures[1].name),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNQTX79HwAElwJzdIqk6AAAAABJRU5ErkJggg==',
        'base64'
      )
    )
    await copyFile(app.fixturesPath('media', 'sample-5s.mp4'), join(root, fixtures[2].name))
    await copyFile(app.fixturesPath('media', 'sample.wav'), join(root, fixtures[3].name))
    await writeFile(join(root, fixtures[4].name), Buffer.from(`MP-69 binary ${prefix}\0`))
    for (const fixture of fixtures) {
      const result = await fileRequest('file.batch_create_internal_entries', {
        items: [
          { source: 'path', path: AbsoluteFilePathSchema.parse(join(root, fixture.name)), cleanupPolicy: 'manual' }
        ]
      })
      ids.push(...result.succeeded.map(({ id }) => id))
      expect(result.failed).toEqual([])
      expect(result.succeeded).toHaveLength(1)
    }
    await selectSidebarApp(page, 'Files')
    await expect(view).toBeVisible()
    await screenshot('MP-69 file library with seeded files')
    const all = await readFiles()
    expect(all.nextCursor, 'All fixtures and existing files must fit in the verification page').toBeUndefined()
    const allNames = all.items.map(({ name, ext }) => (ext ? `${name}.${ext}` : name))
    // The library renders only its visible window, so it is read while scrolling.
    const scroller = content.locator('[data-scrolling]').first()
    const listedText = () => collectVirtualizedText(page, scroller)
    const expectListed = async (names: string[], message: string) => {
      const text = await listedText()
      expect(
        names.filter((name) => !text.includes(name)),
        message
      ).toEqual([])
    }
    await expectListed(allNames, 'Every stored file must be listed')
    await expect(navigation.getByRole('button', { name: /^All Files/ })).toContainText(String(all.total))

    await test.step('Each category shows only its files and the correct count', async () => {
      for (const fixture of fixtures.slice(0, 5)) {
        const expected = await readFiles(fixture.type)
        const category = navigation.getByRole('button', { name: new RegExp(`^${fixture.label}`) })
        await expect(category).toHaveText(new RegExp(`^${fixture.label}\\s*${expected.total}$`))
        await category.click()
        const listed = await listedText()
        const names = expected.items.map(({ name, ext }) => (ext ? `${name}.${ext}` : name))
        expect(
          names.filter((name) => !listed.includes(name)),
          `Every ${fixture.label} file must be listed`
        ).toEqual([])
        for (const other of fixtures.filter(({ type }) => type !== fixture.type)) {
          expect(listed, `${other.name} must not be listed under ${fixture.label}`).not.toContain(other.name)
        }
        await screenshot(`MP-69 ${fixture.label} filter and count`)
      }
    })

    await navigation.getByText('All Files', { exact: true }).click()
    await expectListed(allNames, 'Every stored file must be listed again after clearing the filter')
    await screenshot('MP-69 all files after clearing filters')
    testInfo.annotations.push({
      type: 'uncovered',
      description:
        'The file library has no filename-search control. This case verifies category filtering and counts; filename search, highlighting, and no-match states are not implemented.'
    })
  } finally {
    if (ids.length) {
      const trashed = await fileRequest('file.batch_trash', { ids })
      const deleted = await fileRequest('file.batch_permanent_delete_from_trash', { ids: trashed.succeeded })
      expect([...trashed.failed, ...deleted.failed]).toEqual([])
    }
    await rm(root, { recursive: true, force: true })
  }
})

test(...caseDefinition('MP-70'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const directory = join(app.paths.fixtures, 'MP-70')
  await mkdir(directory, { recursive: true })
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const number of [1, 2]) {
    pdf.addPage([612, 792]).drawText(`MP70 searchable page ${number}`, { x: 72, y: 700, font, size: 20 })
  }
  await writeFile(join(directory, 'sample.pdf'), await pdf.save())
  await sharp({ create: { width: 320, height: 180, channels: 3, background: '#b53035' } })
    .png()
    .toFile(join(directory, 'sample.png'))
  await copyFile(app.fixturesPath('media', 'sample-5s.mp4'), join(directory, 'sample-5s.mp4'))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['MP70 workbook', 'Amount'],
      ['Preview value', 70]
    ]),
    'MP70 sheet'
  )
  XLSX.writeFile(workbook, join(directory, 'sample.xlsx'))
  const paths = ['sample.pdf', 'sample.png', 'sample-5s.mp4', 'sample.xlsx'].map((name) =>
    AbsoluteFilePathSchema.parse(join(directory, name))
  )
  const importResult = await page.evaluate(
    (paths) =>
      window.api.ipcApi.request('file.batch_create_internal_entries', {
        items: paths.map((path) => ({ source: 'path' as const, path, cleanupPolicy: 'manual' as const }))
      }) as Promise<IpcResult<OutputFor<'file.batch_create_internal_entries'>>>,
    paths
  )
  expect(importResult.ok).toBe(true)
  if (!importResult.ok) throw new Error(JSON.stringify(importResult.error))
  const imported = importResult.data
  expect(imported.failed).toEqual([])
  expect(imported.succeeded).toHaveLength(4)
  const ids = imported.succeeded.map(({ id }) => id)
  try {
    await selectSidebarApp(page, 'Files')
    const files = page.locator('[data-ui~="files.view"]')
    const back = files.getByRole('button', { name: 'Back', exact: true })
    await files.getByText('sample.pdf', { exact: true }).click()
    const pdfPreview = files.getByTestId('pdf-file-preview')
    await expect(pdfPreview).toBeVisible()
    await expect(pdfPreview.locator('.textLayer').getByText('MP70 searchable page 1', { exact: true })).toBeVisible()
    await files.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(files.getByTestId('pdf-preview-page-indicator').getByRole('textbox')).toHaveValue('2')
    await expect(
      pdfPreview.locator('.page[data-page-number="2"] .textLayer').getByText('MP70 searchable page 2', { exact: true })
    ).toBeVisible()
    await attachScreenshot('MP-70 PDF page 2 text layer')
    await back.click()

    await files.getByText('sample.png', { exact: true }).click()
    const imageDialog = page.getByTestId('image-preview-dialog')
    const image = imageDialog.getByTestId('image-preview-viewport').locator('img')
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(320)
    const bounds = await image.boundingBox()
    expect(bounds).not.toBeNull()
    await imageDialog.getByRole('button', { name: 'Zoom In', exact: true }).click()
    await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(bounds!.width)
    const enlarged = await image.boundingBox()
    await imageDialog.getByRole('button', { name: 'Rotate Right', exact: true }).click()
    await expect.poll(async () => Math.abs((await image.boundingBox())!.width - enlarged!.height)).toBeLessThan(1)
    await attachScreenshot('MP-70 image zoomed and rotated')
    await imageDialog.getByRole('button', { name: 'Close Preview', exact: true }).click()
    await expect(imageDialog).toBeHidden()

    await files.getByText('sample-5s.mp4', { exact: true }).click()
    const video = files.locator('video')
    await expect.soft(video, 'MP4 must offer native video playback').toBeVisible({ timeout: 10_000 })
    if (await video.isVisible()) {
      await expect(video).toHaveJSProperty('controls', true)
      await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
      await video.focus()
      await page.keyboard.press('Space')
      await expect
        .poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(3)
      expect(await video.evaluate((video: HTMLVideoElement) => video.error)).toBeNull()
    }
    await attachScreenshot('MP-70 video preview result')
    await back.click()

    const pdfId = imported.succeeded.find(({ sourceRef }) => sourceRef === '#0')!.id
    const physicalResult = await page.evaluate(
      (id) =>
        window.api.ipcApi.request('file.batch_get_physical_paths', { ids: [id] }) as Promise<
          IpcResult<OutputFor<'file.batch_get_physical_paths'>>
        >,
      pdfId
    )
    expect(physicalResult.ok).toBe(true)
    if (!physicalResult.ok) throw new Error(JSON.stringify(physicalResult.error))
    const pdfPath = physicalResult.data[pdfId]
    expect(pdfPath).toBeTruthy()
    await files.getByText('sample.pdf', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show in folder', exact: true }).click()
    if (app.record.platform === 'macos') {
      let selectedPath: string | undefined
      const finderSelection = () => {
        selectedPath = execFileSync(
          'osascript',
          [
            '-e',
            [
              'tell application "Finder"',
              'set selectedPaths to {}',
              'repeat with selectedItem in (get selection)',
              'set end of selectedPaths to POSIX path of (selectedItem as alias)',
              'end repeat',
              'return selectedPaths as text',
              'end tell'
            ].join('\n')
          ],
          { encoding: 'utf8', timeout: 10_000 }
        ).trim()
        return selectedPath
      }
      await expect.soft.poll(finderSelection, { timeout: 15_000 }).toBe(pdfPath)
      if (selectedPath === pdfPath) {
        const finderDirectory = execFileSync(
          'osascript',
          ['-e', 'tell application "Finder" to get POSIX path of (target of front window as alias)'],
          { encoding: 'utf8', timeout: 10_000 }
        )
          .trim()
          .replace(/\/$/, '')
        expect(finderDirectory).toBe(dirname(pdfPath!))
        await testInfo.attach('MP-70 Finder location', {
          body: JSON.stringify({ selected: finderSelection(), directory: finderDirectory }),
          contentType: 'application/json'
        })
      }
    } else {
      // "Show in folder" hands the path to the platform file manager; the selection readback
      // above is Finder-only, so other platforms record the action without claiming a result.
      await testInfo.attach('MP-70 file manager location', {
        body: JSON.stringify({ platform: app.record.platform, expectedPath: pdfPath, selectionVerified: false }),
        contentType: 'application/json'
      })
    }
    await page.bringToFront()
    await attachScreenshot('MP-70 PDF reveal action completed')

    await files.getByText('sample.xlsx', { exact: true }).click()
    const spreadsheet = files.getByTestId('spreadsheet-file-preview')
    const unsupported = files.getByText('This file type cannot be previewed yet.', { exact: true })
    await expect(spreadsheet.or(unsupported)).toBeVisible()
    if (await spreadsheet.isVisible()) {
      await expect(spreadsheet.getByRole('tab', { name: 'MP70 sheet', exact: true })).toBeVisible()
      await expect(spreadsheet.getByText('MP70 workbook', { exact: true })).toBeVisible()
      await expect(spreadsheet.getByText('Preview value', { exact: true })).toBeVisible()
      await expect(spreadsheet.getByText('70', { exact: true })).toBeVisible()
    } else {
      await expect(files.getByRole('button', { name: 'Open with default app', exact: true })).toBeEnabled()
    }
    await attachScreenshot('MP-70 spreadsheet preview result')
    await back.click()
  } finally {
    await page.keyboard.press('Escape')
    await page.evaluate(async (ids) => {
      await window.api.ipcApi.request('file.batch_trash', { ids })
      await window.api.ipcApi.request('file.batch_permanent_delete_from_trash', { ids })
    }, ids)
  }
})

test(...caseDefinition('MP-71'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const directory = await mkdtemp(join(app.paths.fixtures, 'MP-71-'))
  const source = AbsoluteFilePathSchema.parse(join(directory, 'sample.txt'))
  const renamedPath = join(directory, 'QA-renamed.txt')
  const internalSource = AbsoluteFilePathSchema.parse(join(directory, 'MP71-internal.txt'))
  const externalContent = 'MP-71 external original must survive library removal.\n'
  const internalContent = 'MP-71 internal content must survive archive and restore.\n'
  await writeFile(source, externalContent)
  await writeFile(internalSource, internalContent)
  // Seed real files through production APIs; all tested mutations use the application UI.
  const internal = FileEntrySchema.parse(
    await page.evaluate(
      (path) => window.api.file.createInternalEntry({ source: 'path', path, cleanupPolicy: 'manual' }),
      internalSource
    )
  )
  const external = FileEntrySchema.parse(
    await page.evaluate(
      (path) => window.api.file.ensureExternalEntry({ externalPath: path, cleanupPolicy: 'manual' }),
      source
    )
  )
  const readEntry = async (id: string) => {
    const result = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'MP71-read', method: 'GET', path: `/files/entries/${id}` }),
      id
    )
    expect(result.status).toBe(200)
    return FileEntrySchema.parse(result.data)
  }
  const internalPath = await page.evaluate((id) => window.api.file.getPhysicalPath({ id }), internal.id)
  try {
    await selectSidebarApp(page, 'Files')
    const files = page.locator('[data-ui~="files.view"]')
    await files.getByText('sample.txt', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const rename = files.getByRole('textbox').filter({ visible: true })
    await rename.fill('QA-renamed.txt')
    await rename.press('Enter')
    await expect(files.getByText('QA-renamed.txt', { exact: true })).toBeVisible()
    await expect(files.getByText('sample.txt', { exact: true })).toHaveCount(0)
    await expect.poll(() => readFile(renamedPath, 'utf8')).toBe(externalContent)
    await expect(access(source)).rejects.toThrow()
    expect(await readEntry(external.id)).toMatchObject({
      origin: 'external',
      name: 'QA-renamed',
      externalPath: renamedPath
    })
    await attachScreenshot('MP-71 renamed file matches disk')

    await files.getByText('MP71-internal.txt', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    // An internal-only selection archives immediately; only external entries raise a confirmation.
    await expect(files.getByText('MP71-internal.txt', { exact: true })).toHaveCount(0)
    await attachScreenshot('MP-71 internal file archived')
    await expect
      .poll(async () => InternalEntrySchema.parse(await readEntry(internal.id)).deletedAt)
      .toEqual(expect.any(Number))
    expect(await readFile(internalPath, 'utf8')).toBe(internalContent)
    await openSettingsSection(page, 'Archive')
    await page.getByRole('tab', { name: 'Files', exact: true }).click()
    const archived = page.locator('[data-slot="item"]').filter({ hasText: 'MP71-internal.txt' })
    await expect(archived).toBeVisible()
    await attachScreenshot('MP-71 internal file in Archive')
    await archived.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(archived).toHaveCount(0)
    await expect.poll(async () => InternalEntrySchema.parse(await readEntry(internal.id)).deletedAt).toBeUndefined()
    expect(await readFile(internalPath, 'utf8')).toBe(internalContent)
    await selectSidebarApp(page, 'Files')
    await expect(files.getByText('MP71-internal.txt', { exact: true })).toBeVisible()

    await files.getByText('QA-renamed.txt', { exact: true }).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Remove from library', exact: true }).click()
    const removal = page.getByRole('dialog', { name: 'Remove from library?', exact: true })
    await expect(removal).toBeVisible()
    await expect(removal).toContainText('The original files on disk will not be affected.')
    await attachScreenshot('MP-71 external removal confirmation preserves disk original')
    await removal.getByRole('button', { name: 'Remove from library', exact: true }).click()
    await expect(removal).toBeHidden()
    await expect(files.getByText('QA-renamed.txt', { exact: true })).toHaveCount(0)
    const removed = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'MP71-removed', method: 'GET', path: `/files/entries/${id}` }),
      external.id
    )
    expect(removed.status).toBe(404)
    expect(await readFile(renamedPath, 'utf8')).toBe(externalContent)
    await page.reload()
    await selectSidebarApp(page, 'Files')
    await expect(files.getByText('QA-renamed.txt', { exact: true })).toHaveCount(0)
    await expect(files.getByText('MP71-internal.txt', { exact: true })).toBeVisible()
    expect(await readFile(renamedPath, 'utf8')).toBe(externalContent)
    await attachScreenshot('MP-71 removal persisted and internal file restored')
    await testInfo.attach('MP-71 disk evidence', {
      body: JSON.stringify({ renamedPath, externalContent: await readFile(renamedPath, 'utf8'), internalPath }),
      contentType: 'application/json'
    })
  } finally {
    await page.keyboard.press('Escape')
    await page.evaluate(
      async ({ internalId, externalId }) => {
        await window.api.ipcApi.request('file.batch_remove_from_library', { ids: [externalId] })
        await window.api.ipcApi.request('file.batch_trash', { ids: [internalId] })
        await window.api.ipcApi.request('file.batch_permanent_delete_from_trash', { ids: [internalId] })
      },
      { internalId: internal.id, externalId: external.id }
    )
    await rm(directory, { recursive: true, force: true })
  }
})

test(...caseDefinition('MP-72'), async () => {
  test.skip(
    true,
    'UNCOVERED: referencing library files in chat has no supported UI entry point. The attachment button opens a native file picker, and library rows do not provide file-reference drag data.'
  )
})
