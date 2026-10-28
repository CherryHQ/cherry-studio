import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function polishPrompt(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    defaultModel: await window.api.preference.get('chat.default_model_id'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const real = app.config.customProvider
  const providerIds: string[] = []
  const name = app.resourceName('Polish prompt assistant')
  let assistantId: string | undefined

  try {
    // Success uses a real provider; only malformed-variable and error responses use the HTTP fixture.
    const modelIds: string[] = []
    for (const [index, config] of [
      real,
      { baseUrl: server.baseUrl, apiKey: 'mock-key', chatModel: server.modelId }
    ].entries()) {
      const providerId = `mp16-${Date.now()}-${index}`
      providerIds.push(providerId)
      const created = await page.evaluate(
        ({ providerId, config }) =>
          window.api.dataApi.request({
            id: `${providerId}-create`,
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: `MP16 provider ${providerId}`,
              defaultChatEndpoint: 'openai-chat-completions',
              endpointConfigs: { 'openai-chat-completions': { baseUrl: config.baseUrl } },
              apiKeys: [{ id: 'mp16-key', key: config.apiKey, isEnabled: true }]
            }
          }),
        { providerId, config }
      )
      expect(created.status).toBe(201)
      const enabled = await page.evaluate(
        (providerId) =>
          window.api.dataApi.request({
            id: 'mp16-enable',
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
            id: 'mp16-model',
            method: 'POST',
            path: '/models',
            body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
          }),
        { providerId, modelId: config.chatModel }
      )
      expect(models.status).toBe(201)
      modelIds.push(createUniqueModelId(providerId, config.chatModel))
    }
    const created = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp16-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name, modelId: modelIds[0] }
    )
    expect(created.status).toBe(201)
    assistantId = AssistantSchema.parse(created.data).id
    await page.evaluate(
      (modelId) =>
        window.api.preference.setMultiple({
          'chat.default_model_id': modelId,
          'menu.presentation_mode': 'cherry'
        }),
      modelIds[0]
    )
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const row = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
    const dialog = page.getByRole('dialog', { name: 'Edit Assistant', exact: true })
    const openEditor = async () => {
      await expect(row).toBeVisible()
      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Edit Assistant', exact: true }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('tab', { name: 'System Prompt', exact: true }).click()
      const edit = dialog.getByRole('button', { name: 'Edit', exact: true })
      if (await edit.isVisible()) await edit.click()
    }
    await openEditor()
    const editor = dialog.locator('.cm-content')
    const polish = dialog.getByRole('button', { name: 'Polish prompt', exact: true })
    const rough = '你是测试助手，回答简短'
    await editor.fill(rough)
    await polish.click()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await attachScreenshot('MP-16 real polish running')
    await expect
      .soft(editor, 'Prompt editor must lock while the real request is pending')
      .toHaveAttribute('contenteditable', 'false', { timeout: 1000 })
    await expect(polish).toBeVisible({ timeout: 70_000 })
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    const polished = (await editor.innerText()).trim()
    expect(polished.length, 'Real model must return a nonempty rewritten prompt').toBeGreaterThan(0)
    expect(polished).not.toBe(rough)
    await attachScreenshot('MP-16 real polished result')

    await page.evaluate((modelId) => window.api.preference.set('chat.default_model_id', modelId), modelIds[1])
    const withVariable = `${polished}\n今天是 {{date}}。`
    await editor.fill(withVariable)
    await polish.click()
    const invalid = await server.nextRequest()
    expect(JSON.stringify(invalid.body.messages)).toContain('{{date}}')
    await expect
      .soft(editor, 'Prompt editor must be locked during polishing')
      .toHaveAttribute('contenteditable', 'false', { timeout: 1000 })
    const beforeTyping = await editor.innerText()
    await editor.click()
    await page.keyboard.type('MP16_LOCK_PROBE')
    await expect.soft
      .poll(() => editor.innerText(), { message: 'Typing while polishing must not change the prompt', timeout: 1000 })
      .toBe(beforeTyping)
    // Restore only after recording a lock failure so the independent variable guard can still be exercised.
    if ((await editor.innerText()) !== beforeTyping) await editor.fill(beforeTyping)
    invalid.complete('A rewritten prompt that omitted the date variable.')
    await expect(page.getByText('Could not apply polished prompt', { exact: true })).toBeVisible()
    await expect(
      page.getByText('The polished result changed or removed prompt variables. Try again.', { exact: true })
    ).toBeVisible()
    await expect.poll(() => editor.innerText()).toBe(withVariable)
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await attachScreenshot('MP-16 rejected changed variable without data loss')

    await polish.click()
    const failed = await server.nextRequest()
    failed.complete('')
    await expect(page.getByText('Failed to polish prompt', { exact: true })).toBeVisible()
    await expect(page.getByText('Check or change the default model, then try again.', { exact: true })).toBeVisible()
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await expect.poll(() => editor.innerText()).toBe(withVariable)
    await attachScreenshot('MP-16 failed polish retains final prompt')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    const readPrompt = async () => {
      const saved = await page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: 'mp16-read',
            method: 'GET',
            path: `/assistants/${id}`
          }),
        assistantId!
      )
      expect(saved.status).toBe(200)
      return AssistantSchema.parse(saved.data).prompt
    }
    await expect.poll(readPrompt).toBe(withVariable)
    await openEditor()
    await expect.poll(() => editor.innerText()).toBe(withVariable)
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await attachScreenshot('MP-16 saved prompt after reopening')
    await page.keyboard.press('Escape')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ preferences, assistantId, providerIds }) => {
        await window.api.preference.setMultiple({
          'chat.default_model_id': preferences.defaultModel,
          'menu.presentation_mode': preferences.menuMode
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        for (const id of providerIds)
          await window.api.dataApi.request({
            id: 'mp16-cleanup-provider',
            method: 'DELETE',
            path: `/providers/${id}`
          })
      },
      { preferences, assistantId, providerIds }
    )
  }
}
