import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { openAttachmentPicker, submitChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import { revealVirtualized } from '../helpers/virtualList'
import type { RegressionApp } from '../RegressionApp'

export async function notesAndExport(app: RegressionApp, initialPage: Page, testInfo: TestInfo): Promise<void> {
  let page = initialPage
  const directory = join(app.paths.evidence, 'MP-11')
  const notesDirectory = join(directory, 'notes')
  // Leftover notes and timestamped exports from an earlier phase run would break the rerun.
  await rm(directory, { recursive: true, force: true })
  await mkdir(notesDirectory, { recursive: true })
  const original = await page.evaluate(async () => ({
    path: await window.api.preference.get('feature.notes.path'),
    view: await window.api.preference.get('feature.notes.default_view_mode'),
    edit: await window.api.preference.get('feature.notes.default_edit_mode'),
    exportPath: await window.api.preference.get('data.export.markdown.path'),
    naming: await window.api.preference.get('topic.naming.enabled'),
    menu: await window.api.preference.get('menu.presentation_mode')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const server = await startMockChatServer()
  const providerId = `mp11-${Date.now()}`
  const title = app.resourceName('MP11 language note')
  const topicName = app.resourceName('MP11 export conversation')
  const assistantName = app.resourceName('MP11 mock assistant')
  const code = 'print("MP11 persistent code")'
  const body = 'MP11 note body remains complete.'
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNQTX79HwAElwJzdIqk6AAAAABJRU5ErkJggg=='
  const answer = `MP11 completed answer\n\n\`\`\`python\n${code}\n\`\`\``
  let assistantId: string | undefined
  const notes = () => page.locator('[data-ui~="notes.view"]')
  const editor = () => page.locator('[data-ui~="notes.editor"][data-file-edit]')
  const openNote = async () => {
    await selectSidebarApp(page, 'Notes')
    await notes().getByText(title, { exact: true }).click()
    await expect(editor().locator('pre')).toHaveText(code)
    await expect(editor()).toContainText(body)
    await expect(editor().getByRole('button', { name: 'Language', exact: true })).toHaveText('python')
  }
  try {
    await page.evaluate(async (path) => {
      await window.api.preference.setMultiple({
        'feature.notes.path': path,
        'feature.notes.default_view_mode': 'edit',
        'feature.notes.default_edit_mode': 'source',
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry'
      })
    }, notesDirectory)
    await page.reload()
    await selectSidebarApp(page, 'Notes')
    await notes().getByRole('button', { name: 'Create a new note', exact: true }).first().click()
    const nameInput = notes().locator('input')
    await nameInput.fill(title)
    await nameInput.press('Enter')
    await editor().locator('.cm-content').fill(`${body}\n\n\`\`\`text\n${code}\n\`\`\``)
    const modeSelector = notes().locator('[data-ui~="notes.editor-footer"]').getByRole('combobox')
    await modeSelector.click()
    await page.getByRole('option', { name: 'Source code mode', exact: true }).click()
    await expect(modeSelector).toHaveAccessibleName('Source code mode')
    await modeSelector.click()
    await page.getByRole('option', { name: 'Live preview', exact: true }).click()
    await expect(modeSelector).toHaveAccessibleName('Live preview')
    await editor().getByRole('button', { name: 'Language', exact: true }).click()
    const language = page.getByRole('dialog')
    await language.getByRole('combobox').fill('pyth')
    await expect(language.getByRole('option', { name: 'python', exact: true })).toBeVisible()
    await expect(language.getByRole('option', { name: 'javascript', exact: true })).toHaveCount(0)
    await screenshot('MP-11 filtered code language')
    await language.getByRole('option', { name: 'python', exact: true }).click()
    await expect.poll(() => readFile(join(notesDirectory, `${title}.md`), 'utf8')).toContain('```python')
    await page.evaluate(() => window.api.preference.set('feature.notes.default_edit_mode', 'preview'))
    await selectSidebarApp(page, 'Chat')
    await openNote()
    await screenshot('MP-11 saved note reopened')

    // Mock supplies deterministic content; the real UI, persistence and exporter remain under test.
    const setup = await page.evaluate(
      async ({ providerId, baseUrl, modelId, assistantName, topicName, uniqueModel }) => {
        const request = window.api.dataApi.request
        const provider = await request({
          id: 'mp11-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP11 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await request({
          id: 'mp11-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await request({
          id: 'mp11-model',
          method: 'POST',
          path: '/models',
          body: [
            { providerId, modelId, endpointTypes: ['openai-chat-completions'], inputModalities: ['text', 'image'] }
          ]
        })
        const assistant = await request({
          id: 'mp11-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name: assistantName, modelId: uniqueModel }
        })
        const assistantId = (assistant.data as { id: string }).id
        const topic = await request({
          id: 'mp11-topic',
          method: 'POST',
          path: '/topics',
          body: { name: topicName, assistantId }
        })
        return {
          statuses: [provider.status, enabled.status, model.status, assistant.status, topic.status],
          assistantId
        }
      },
      {
        providerId,
        baseUrl: server.baseUrl,
        modelId: server.modelId,
        assistantName,
        topicName,
        uniqueModel: createUniqueModelId(providerId, server.modelId)
      }
    )
    assistantId = setup.assistantId
    expect(setup.statuses).toEqual([201, 200, 201, 201, 201])
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const showSidebar = chat.getByRole('button', { name: 'Show Sidebar', exact: true })
    if (await showSidebar.isVisible()) await showSidebar.click()
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await revealVirtualized(page, chat.locator('[data-virtual-scrolling]').first(), group)
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    const topicRow = chat.getByTestId('topic-list-row').filter({ hasText: topicName })
    await topicRow.click()
    const imageName = 'mp11-export-image.png'
    const imagePath = join(app.paths.fixtures, imageName)
    await writeFile(imagePath, Buffer.from(png, 'base64'))
    const composer = chat.locator('[data-ui~="chat.composer"]')
    await composer.locator('[contenteditable="true"]').first().fill('MP11 provide code for the attached image.')
    await openAttachmentPicker(page, composer)
    chooseNativeFile(app.record.platform, app.paths, imagePath)
    await expect(
      chat.locator('[data-ui~="chat.composer"] [data-composer-token-kind="file"]').filter({ hasText: imageName })
    ).toBeVisible()
    const [messageId] = await Promise.all([
      submitChatMarker(page, 'MP11 completed answer'),
      server.nextRequest().then((request) => {
        expect(request.body.messages).toContainEqual(
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([expect.objectContaining({ type: 'image_url' })])
          })
        )
        request.complete(answer)
      })
    ])
    const message = chat.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)
    await expect(message.locator('pre')).toContainText(code)
    const before = await readdir(notesDirectory)
    await message.hover()
    await message.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Save', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Save to Notes', exact: true }).click()
    await expect
      .poll(async () => (await readdir(notesDirectory)).filter((name) => !before.includes(name)).length)
      .toBe(1)
    const savedName = (await readdir(notesDirectory)).find((name) => !before.includes(name))!
    const savedContent = await readFile(join(notesDirectory, savedName), 'utf8')
    expect(savedContent.trim()).toContain(answer)
    await selectSidebarApp(page, 'Notes')
    await notes().getByText(savedName.replace(/\.md$/, ''), { exact: true }).click()
    await expect(editor()).toContainText('MP11 completed answer')
    await expect(editor().locator('pre')).toHaveText(code)
    await screenshot('MP-11 completed message saved to Notes')

    for (const [mode, label] of [
      ['embed', 'Embed in file (default)'],
      ['folder', 'Export as image folder'],
      ['none', 'Without images']
    ] as const) {
      const exportDirectory = join(directory, mode)
      // ExportService stamps Markdown file names, so a previous run would leave several exports.
      await rm(exportDirectory, { recursive: true, force: true })
      await mkdir(exportDirectory, { recursive: true })
      await page.evaluate((path) => window.api.preference.set('data.export.markdown.path', path), exportDirectory)
      await selectSidebarApp(page, 'Chat')
      await topicRow.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Export', exact: true }).hover()
      await page.getByRole('menuitem', { name: 'Export as Markdown', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Export images', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByText(label, { exact: true }).click()
      await screenshot(`MP-11 export image option ${mode}`)
      await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
      await expect
        .poll(async () => (await readdir(exportDirectory)).filter((name) => name.endsWith('.md')).length)
        .toBe(1)
      const file = (await readdir(exportDirectory)).find((name) => name.endsWith('.md'))!
      const path = join(exportDirectory, file)
      const markdown = await readFile(path, 'utf8')
      expect(markdown).toContain('MP11 completed answer')
      expect(markdown).toContain('```python\n' + code + '\n```')
      if (mode === 'embed') expect(markdown).toContain(`data:image/png;base64,${png}`)
      if (mode === 'none') expect(markdown).not.toMatch(/!\[|data:image/)
      if (mode === 'folder') {
        const image = markdown.match(/!\[[^\]]*\]\(([^)]+)\)/)
        expect(image).not.toBeNull()
        await expect
          .poll(async () => (await readFile(resolve(exportDirectory, image![1]))).toString('base64'))
          .toBe(png)
      }
      await testInfo.attach(`MP-11 ${mode} exported Markdown`, { path, contentType: 'text/markdown' })
      await page.evaluate((path) => window.api.preference.set('feature.notes.path', path), exportDirectory)
      await page.reload()
      await selectSidebarApp(page, 'Notes')
      await notes().getByText(file.replace(/\.md$/, ''), { exact: true }).click()
      await expect(editor()).toContainText('MP11 completed answer')
      await expect(editor().locator('pre')).toHaveText(code)
      if (mode !== 'none') {
        await expect
          .poll(() =>
            editor()
              .locator('img')
              .evaluateAll(
                (images) =>
                  images.every(
                    (image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
                  ) && images.length > 0
              )
          )
          .toBe(true)
      } else await expect(editor().locator('img')).toHaveCount(0)
      await screenshot(`MP-11 opened ${mode} export`)
    }
    await page.evaluate((path) => window.api.preference.set('feature.notes.path', path), notesDirectory)
    page = await app.restart()
    await openNote()
    await editor().locator('[contenteditable="true"]').press('ControlOrMeta+End')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('MP11 editable after restart')
    await expect(editor()).toContainText('MP11 editable after restart')
    await expect
      .poll(() => readFile(join(notesDirectory, `${title}.md`), 'utf8'))
      .toContain('MP11 editable after restart')
    await expect(editor().locator('pre')).toContainText(code)
    await screenshot('MP-11 persisted and editable after restart')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ original, assistantId, providerId }) => {
        await window.api.preference.setMultiple({
          'feature.notes.path': original.path,
          'feature.notes.default_view_mode': original.view,
          'feature.notes.default_edit_mode': original.edit,
          'data.export.markdown.path': original.exportPath,
          'topic.naming.enabled': original.naming,
          'menu.presentation_mode': original.menu
        })
        if (assistantId) {
          const deleted = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<unknown>
          if (!deleted.ok) throw new Error(deleted.error.message)
        }
        await window.api.dataApi.request({ id: 'mp11-delete', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { original, assistantId, providerId }
    )
  }
}
