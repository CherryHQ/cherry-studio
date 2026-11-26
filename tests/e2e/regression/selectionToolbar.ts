import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { sendChatMarker, submitChatMarker } from './helpers/chat'
import { selectSidebarApp } from './helpers/navigation'
import type { RegressionApp } from './RegressionApp'

export async function selectionToolbar(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const notesPath = join(app.paths.evidence, 'MP-149-notes')
  await mkdir(notesPath, { recursive: true })
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    notesPath: await window.api.preference.get('feature.notes.path')
  }))
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  testInfo.annotations.push(
    {
      type: 'uncovered',
      description: 'Note write failure: no deterministic isolated filesystem-failure fixture is configured.'
    },
    {
      type: 'uncovered',
      description: 'Window blur: no isolated second native window is available for a safe focus transfer.'
    },
    { type: 'uncovered', description: 'Multi-model grid: this scenario configures only one mock model.' }
  )
  const providerId = `regression-mp149-${Date.now()}`
  const topicName = app.resourceName('MP149 message operations')
  const assistantName = app.resourceName('MP149 message operations assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(
      (notesPath) =>
        window.api.preference.setMultiple({
          'topic.naming.enabled': false,
          'menu.presentation_mode': 'cherry',
          'feature.notes.path': notesPath
        }),
      notesPath
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP149 message operations mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp149-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp149-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const showSidebar = chat.getByRole('button', { name: 'Show Sidebar', exact: true })
    if (await showSidebar.isVisible()) await showSidebar.click()
    const assistantRow = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(assistantRow).toBeVisible({ timeout: 30_000 })
    await assistantRow.hover()
    const expand = assistantRow.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible().catch(() => false)) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const selected = 'MP149 selection text'
    const reply = async (prompt: string, answer: string) => {
      await Promise.all([
        sendChatMarker(page, prompt, answer),
        (async () => {
          const request = await server.nextRequest()
          request.complete(answer)
        })()
      ])
    }
    await reply('First question', 'First completed response.')
    await reply('Second question', selected)
    const paragraph = chat
      .locator('[data-ui~="chat.message"]')
      .filter({ hasText: selected })
      .getByText(selected, { exact: true })
      .last()
    const toolbar = page
      .locator('[data-radix-popper-content-wrapper]')
      .filter({ has: page.getByRole('button', { name: 'Save to Notes', exact: true }) })
    const composer = chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    const drag = async () => {
      await paragraph.scrollIntoViewIfNeeded()
      const box = await paragraph.boundingBox()
      if (!box) throw new Error('Cannot measure reply text')
      await chat.locator('[data-ui~="chat.message-list"]').click({ position: { x: 40, y: 5 } })
      await page.mouse.move(box.x + 1, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 20 })
      await page.mouse.up()
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected)
      await expect(toolbar).toBeVisible()
      const toolbarBox = await toolbar.boundingBox()
      const selectionTop = await page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().top)
      expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(selectionTop)
      await expect(toolbar.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
      await expect(toolbar.getByRole('button', { name: 'Quote', exact: true })).toBeVisible()
    }
    await drag()
    const path = testInfo.outputPath('MP-149 selection toolbar.png')
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach('MP-149 selection toolbar', { path, contentType: 'image/png' })
    await toolbar.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(page.getByText('Copied!', { exact: true })).toBeVisible()
    await composer.click()
    await page.keyboard.press('ControlOrMeta+V')
    await expect(composer).toHaveText(selected)
    await page.keyboard.press('ControlOrMeta+A')
    await expect(toolbar).toHaveCount(0)
    await page.keyboard.press('Backspace')
    await drag()
    await toolbar.getByRole('button', { name: 'Quote', exact: true }).click()
    const quote = chat.locator('[data-ui~="chat.composer"] [data-composer-token-kind="quote"]')
    await expect(quote).toBeVisible()
    await quote.hover()
    await expect(page.getByRole('tooltip')).toContainText(selected)
    await composer.click()
    await composer.press('End')
    await page.keyboard.type(' Please explain')
    await Promise.all([
      submitChatMarker(page, 'Quoted response.'),
      (async () => {
        const request = await server.nextRequest()
        request.complete('Quoted response.')
      })()
    ])
    const sent = chat.locator('[data-ui~="chat.message"]').filter({ hasText: 'Please explain' }).last()
    const sentQuote = sent.locator('[data-composer-token-kind="quote"]')
    await expect(sentQuote).toBeVisible()
    await sentQuote.hover()
    await expect(page.getByRole('tooltip')).toContainText(selected)
    await drag()
    await page.keyboard.press('Escape')
    await expect(toolbar).toHaveCount(0)
    await drag()
    await chat.locator('[data-ui~="chat.message-list"]').click({ position: { x: 40, y: 5 } })
    await expect(toolbar).toHaveCount(0)
    await drag()
    const list = chat.locator('[data-message-virtual-list-scroller]')
    const scrollTop = await list.evaluate((element) => element.scrollTop)
    await list.hover()
    await page.mouse.wheel(0, -500)
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeLessThan(scrollTop)
    await expect(toolbar).toHaveCount(0)
    await drag()
    await paragraph.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()
    await composer.click()
    await page.keyboard.press('ControlOrMeta+V')
    await expect(composer).toHaveText(selected)
    await composer.fill('')
    await drag()
    await paragraph.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Quote', exact: true }).click()
    await expect(quote).toBeVisible()
    await quote.hover()
    await expect(page.getByRole('tooltip')).toContainText(selected)
    await composer.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await drag()
    await toolbar.getByRole('button', { name: 'Save to Notes', exact: true }).click()
    await expect(page.getByText('Successfully exported to notes', { exact: true })).toBeVisible()
    await expect(chat).toBeVisible()
    await expect.poll(() => readFile(join(notesPath, `${selected}.md`), 'utf8').catch(() => '')).toContain(selected)
    await page.getByRole('button', { name: 'Open note', exact: true }).click()
    await expect(page.locator('[data-ui~="notes.view"]:visible')).toBeVisible()
    await expect(page.locator('[data-ui~="notes.editor"]:visible')).toContainText(selected)
    await selectSidebarApp(page, 'Chat')
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    await paragraph.scrollIntoViewIfNeeded()
    const firstCharacter = await paragraph.evaluate((element) => {
      const range = document.createRange()
      range.setStart(element.firstChild!, 0)
      range.setEnd(element.firstChild!, 1)
      const rect = range.getBoundingClientRect()
      return { x: rect.x, y: rect.y + rect.height / 2, right: rect.right }
    })
    await page.mouse.move(firstCharacter.x + 1, firstCharacter.y)
    await page.mouse.down()
    await page.mouse.move(firstCharacter.right - 0.5, firstCharacter.y, { steps: 5 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected[0])
    await page.keyboard.down('Shift')
    for (let i = 1; i < selected.length; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Shift')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected)
    await expect(toolbar).toBeVisible()
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode,
          'feature.notes.path': preferences.notesPath
        })
        if (assistantId) {
          const result = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!result.ok || !result.data.deleted) throw new Error('cleanup left assistant in trash')
        }
        await window.api.dataApi.request({
          id: `${providerId}-delete`,
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { assistantId, providerId, preferences }
    )
  }
}
