import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

import { AssistantSchema } from '@shared/data/types/assistant'
import { InternalEntrySchema } from '@shared/data/types/file'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { sendChatMarker } from './chat'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

// Catch lost library references, missing page-two context, duplicate imports and accidental file deletion.
export async function referenceLibraryFile(app: RegressionApp, page: Page, testInfo: TestInfo) {
  const closeNativePicker = () => {
    if (app.record.platform !== 'macos')
      throw new Error('UNCOVERED: native picker inspection requires macOS automation')
    const script = [
      'on run argv',
      'tell application "System Events"',
      'tell (first application process whose unix id is (item 1 of argv as integer))',
      'set labels to {}',
      'repeat with w in windows',
      'if name of w is "Open" or name of w is "打开" then',
      'try',
      'set labels to name of every button of splitter group 1 of w',
      'end try',
      'set frontmost to true',
      'key code 53',
      'return "Native local file picker: " & (labels as text)',
      'end if',
      'end repeat',
      'return "No native file picker"',
      'end tell',
      'end tell',
      'end run'
    ].join('\n')
    return execFileSync('osascript', ['-e', script, '--', String(app.record.electronPid)], {
      encoding: 'utf8',
      timeout: 10_000
    }).trim()
  }
  closeNativePicker()
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    naming: await window.api.preference.get('topic.naming.enabled'),
    pinned: await window.api.preference.get('chat.input.toolbar.pinned_tools')
  }))
  const pdf = await PDFDocument.create()
  pdf.addPage().drawText('Page 1: canary-one')
  pdf.addPage().drawText('Page 2: canary-seven')
  const bytes = Array.from(await pdf.save())
  const imported = await page.evaluate(
    (bytes) =>
      window.api.ipcApi.request('file.batch_create_internal_entries', {
        items: [{ source: 'bytes', data: new Uint8Array(bytes), name: 'sample', ext: 'pdf', cleanupPolicy: 'manual' }]
      }) as Promise<IpcResult<OutputFor<'file.batch_create_internal_entries'>>>,
    bytes
  )
  expect(imported).toMatchObject({ ok: true })
  if (!imported.ok) throw new Error(JSON.stringify(imported.error))
  expect(imported.data.failed).toEqual([])
  expect(imported.data.succeeded).toHaveLength(1)
  const fileId = imported.data.succeeded[0].id
  const readEntry = () =>
    page.evaluate(
      (id) =>
        window.api.dataApi.request({
          id: 'mp72-entry',
          method: 'GET',
          path: `/files/entries/${id}`
        }),
      fileId
    )
  const readBytes = () =>
    page.evaluate(async (entryId) => {
      const result = (await window.api.ipcApi.request('file.read', {
        handle: { kind: 'entry', entryId },
        options: { mode: 'full', encoding: 'binary' }
      })) as IpcResult<OutputFor<'file.read'>>
      if (!result.ok) throw new Error(JSON.stringify(result.error))
      return Array.from(result.data.content)
    }, fileId)
  const providerId = `mp72-${Date.now()}`
  const assistantName = app.resourceName('Library reference')
  const topicName = app.resourceName('Library PDF')
  let assistantId: string | undefined
  try {
    const original = InternalEntrySchema.parse((await readEntry()).data)
    expect(original.deletedAt).toBeUndefined()
    expect(await readBytes()).toEqual(bytes)
    const config = app.config.customProvider
    const seeded = await page.evaluate(
      async ({ providerId, config, assistantName, topicName }) => {
        const request = window.api.dataApi.request
        await window.api.preference.setMultiple({
          'topic.naming.enabled': false,
          'chat.input.toolbar.pinned_tools': ['attachment', 'knowledge-base']
        })
        const provider = await request({
          id: 'mp72-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP72 live provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: config.baseUrl } },
            apiKeys: [{ id: 'mp72-key', key: config.apiKey, isEnabled: true }]
          }
        })
        const enabled = await request({
          id: 'mp72-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await request({
          id: 'mp72-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId: config.chatModel,
              name: config.chatModel,
              endpointTypes: ['openai-chat-completions']
            }
          ]
        })
        const assistant = await request({
          id: 'mp72-assistant',
          method: 'POST',
          path: '/assistants',
          body: {
            name: assistantName,
            modelId: `${providerId}::${config.chatModel}`
          }
        })
        const topic = await request({
          id: 'mp72-topic',
          method: 'POST',
          path: '/topics',
          body: {
            name: topicName,
            assistantId: (assistant.data as { id: string }).id
          }
        })
        return { statuses: [provider.status, enabled.status, model.status], assistant, topic }
      },
      { providerId, config, assistantName, topicName }
    )
    expect(seeded.statuses).toEqual([201, 200, 201])
    assistantId = AssistantSchema.parse(seeded.assistant.data).id
    TopicSchema.parse(seeded.topic.data)
    testInfo.annotations.push({
      type: 'data-source',
      description: 'Real configured chat provider; real two-page PDF. No mocked file extraction or answer.'
    })
    await page.reload()
    await selectSidebarApp(page, 'Files')
    const files = page.locator('[data-ui~="files.view"]:visible')
    const source = files.getByText('sample.pdf', { exact: true }).first()
    await expect(source).toBeVisible()
    await screenshot('MP-72 sample PDF in library')
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    await expect(chat.getByRole('button', { name: 'Selected models', exact: true })).toContainText(config.chatModel)
    expect(createUniqueModelId(providerId, config.chatModel)).toBe(`${providerId}::${config.chatModel}`)
    const composer = page.locator('[data-ui~="chat.composer"]:visible')
    await composer.getByRole('button', { name: 'Upload attachment', exact: true }).click({ noWaitAfter: true })
    const panel = page.locator('[role="menu"]:visible, [data-testid="quick-panel"]:visible, [role="dialog"]:visible')
    const items = await panel.allTextContents()
    await testInfo.attach('MP-72 actual attachment panel', {
      body: JSON.stringify({ items }, null, 2),
      contentType: 'application/json'
    })
    await screenshot('MP-72 attachment entry inspection')
    const libraryChoice = panel.getByText(/^(File Library|From File Library|文件库引用|从资料库选择)$/).first()
    if (await libraryChoice.isVisible()) {
      await libraryChoice.click()
      await page.getByText('sample.pdf', { exact: true }).last().click()
    } else {
      await testInfo.attach('MP-72 native picker items', { body: closeNativePicker(), contentType: 'text/plain' })
      await page.keyboard.press('Escape')
      testInfo.annotations.push({
        type: 'coverage-note',
        description: '入口缺失·预期待确认：附件按钮未提供资料库选择；尝试从资料库拖入。'
      })
      await page.reload()
      await selectSidebarApp(page, 'Files')
      await expect(source).toBeVisible()
      // Capture only a real source drag payload; never fabricate a library reference.
      const transfer = await page.evaluateHandle(() => {
        const result = { value: null as DataTransfer | null }
        document.addEventListener(
          'dragstart',
          (event) => {
            result.value = event.dataTransfer
          },
          { once: true }
        )
        return result
      })
      const box = await source.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.mouse.down()
      await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 40, { steps: 12 })
      const payload = await transfer.evaluateHandle((result) => result.value)
      const hasFile = await payload.evaluate((value) =>
        Boolean(
          value && (value.files.length || value.types.includes('codefiles') || value.types.includes('text/uri-list'))
        )
      )
      await page.mouse.up()
      await screenshot('MP-72 library drag attempt')
      expect(hasFile, '入口缺失·预期待确认：资料库文件未产生文件拖拽数据，不能完成引用；不直接判产品缺陷').toBe(true)
      await selectSidebarApp(page, 'Chat')
      await composer.dispatchEvent('drop', { dataTransfer: payload })
      await transfer.dispose()
      await payload.dispose()
    }
    await expect(composer).toContainText('sample.pdf')
    await screenshot('MP-72 library reference in composer')
    await sendChatMarker(
      page,
      'What is the exact label on the second page of the attached PDF? Answer only with that label.',
      'canary-seven'
    )
    await screenshot('MP-72 page two answer')
    const refs = await page.evaluate(
      (entryId) =>
        window.api.dataApi.request({
          id: 'mp72-refs',
          method: 'GET',
          path: `/files/entries/${entryId}/refs`
        }),
      fileId
    )
    expect(refs.status).toBe(200)
    expect(JSON.stringify(refs.data)).toContain('message')
    await selectSidebarApp(page, 'Files')
    await expect(source).toBeVisible()
    expect(InternalEntrySchema.parse((await readEntry()).data)).toEqual(original)
    expect(await readBytes()).toEqual(bytes)
    await screenshot('MP-72 library and physical PDF retained')
  } finally {
    const retained = await readEntry()
    expect(retained.status).toBe(200)
    expect(InternalEntrySchema.parse(retained.data).deletedAt).toBeUndefined()
    expect(await readBytes()).toEqual(bytes)
    await screenshot('MP-72 retained file evidence before cleanup')
    const trashed = (await page.evaluate(
      (ids) => window.api.ipcApi.request('file.batch_trash', { ids }),
      [fileId]
    )) as IpcResult<OutputFor<'file.batch_trash'>>
    if (!trashed.ok) throw new Error(trashed.error.message)
    expect(trashed.data.failed, 'Trashing the owned PDF must not fail').toEqual([])
    const purged = (await page.evaluate(
      (ids) => window.api.ipcApi.request('file.batch_permanent_delete_from_trash', { ids }),
      trashed.data.succeeded
    )) as IpcResult<OutputFor<'file.batch_permanent_delete_from_trash'>>
    if (!purged.ok) throw new Error(purged.error.message)
    expect(purged.data.failed, 'Permanently deleting the owned PDF must not fail').toEqual([])
    await page.evaluate(
      async ({ preferences, assistantId, providerId }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.naming,
          'chat.input.toolbar.pinned_tools': preferences.pinned
        })
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({ id: 'mp72-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { preferences, assistantId, providerId }
    )
  }
}
