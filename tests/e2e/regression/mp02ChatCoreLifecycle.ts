import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from './helpers/navigation'
import { revealVirtualized } from './helpers/virtualList'
import type { RegressionApp } from './RegressionApp'

export async function mp02ChatCoreLifecycle(app: RegressionApp, initialPage: Page, testInfo: TestInfo): Promise<void> {
  let page = initialPage
  const server = await startMockChatServer()
  const providerId = `regression-mp02-${Date.now()}`
  const assistantName = app.resourceName('Streaming assistant')
  const prompt = 'hello, answer in one sentence'
  const partial = 'Hello, this is a streaming'
  const answer = 'Hello, this is a complete answer.'
  let assistantId: string | undefined
  const preferences = await page.evaluate(async () => ({
    naming: await window.api.preference.get('topic.naming.enabled'),
    menu: await window.api.preference.get('menu.presentation_mode')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  testInfo.annotations.push({
    type: 'data-source',
    description: 'Loopback mock chat server and real Electron UI and persistence.'
  })

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    const statuses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp02-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-02 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp02-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp02-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, enabled.status, models.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(statuses).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp02-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const setupTopic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: 'mp02-setup-topic',
          method: 'POST',
          path: '/topics',
          body: { assistantId, name }
        }),
      { assistantId, name: app.resourceName('Setup') }
    )
    expect(setupTopic.status).toBe(201)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const topics = chat.locator('[data-ui~="chat.topic-list"]:visible')
    if (!(await topics.isVisible())) await chat.getByRole('button', { name: 'Show Sidebar', exact: true }).click()
    await expect(topics).toBeVisible()
    const setupName = app.resourceName('Setup')
    const setupRow = chat.getByTestId('topic-list-row').filter({ hasText: setupName }).first()
    await revealVirtualized(page, chat.locator('[data-virtual-scrolling]').first(), setupRow)
    await setupRow.click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const composer = () => page.locator('[data-ui~="chat.composer"]:visible')
    const editor = () => composer().locator('[contenteditable="true"]').first()
    const messages = () => page.locator('[data-ui~="chat.message"][data-message-id]:visible')
    await editor().fill(prompt)
    const started = performance.now()
    await composer().getByRole('button', { name: 'Send', exact: true }).click()
    const request = await server.nextRequest()
    expect(request.body).toMatchObject({
      model: server.modelId,
      stream: true,
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
    })
    request.sendText('Hello,')
    await expect(messages().last().getByText('Hello,', { exact: true })).toBeVisible({ timeout: 5000 })
    const firstSeconds = (performance.now() - started) / 1000
    expect(firstSeconds).toBeLessThanOrEqual(5)
    request.sendText(' this is a streaming')
    await expect(messages().last().getByText(partial, { exact: true })).toBeVisible()
    await screenshot('MP-02 streaming partial response')
    await composer().locator('[data-ui~="chat.composer.action.pause"]').click()
    await request.closed
    await expect(composer().locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
    await expect(composer().getByRole('button', { name: 'Send', exact: true })).toBeVisible()
    const response = messages().last()
    const responseId = await response.getAttribute('data-message-id')
    if (!responseId) throw new Error('Streaming response has no message ID')
    await expect(response.getByText(partial, { exact: true })).toBeVisible()
    const observed = await response.innerText()
    const changes = await response.evaluate(
      (element) =>
        new Promise<string[]>((resolve) => {
          const samples: string[] = []
          const observer = new MutationObserver(() => samples.push((element as HTMLElement).innerText))
          observer.observe(element, { subtree: true, childList: true, characterData: true })
          setTimeout(() => {
            observer.disconnect()
            resolve(samples)
          }, 10_000)
        })
    )
    expect(changes.every((text) => text === observed)).toBe(true)
    expect(await response.innerText()).toBe(observed)
    await editor().fill(prompt)
    await expect(composer().getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    const secondStarted = performance.now()
    await composer().getByRole('button', { name: 'Send', exact: true }).click()
    const second = await server.nextRequest()
    expect(second.body).toMatchObject({
      model: server.modelId,
      stream: true,
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
    })
    second.complete(answer)
    await expect(messages().last().getByText(answer, { exact: true })).toBeVisible()
    await expect(composer().getByRole('button', { name: 'Send', exact: true })).toBeVisible()
    const totalSeconds = (performance.now() - secondStarted) / 1000
    process.stdout.write(
      `MP-02 first character: ${firstSeconds.toFixed(3)}s; completed response: ${totalSeconds.toFixed(3)}s\n`
    )
    await expect(messages()).toHaveCount(4)
    const ids = await messages().evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-message-id'))
    )
    const stored = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp02-message', method: 'GET', path: `/messages/${id}` }),
      responseId
    )
    expect(stored.status).toBe(200)
    const topicId = (stored.data as { topicId: string }).topicId
    const appInfo = await page.evaluate(async () => {
      const result = (await window.api.ipcApi.request('app.get_info')) as IpcResult<OutputFor<'app.get_info'>>
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    })
    const databasePath = join(appInfo.appDataPath, 'Data', 'cherrystudio.sqlite')
    const expectedRows = ids.map((id, index) => ({
      id,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: [prompt, partial, prompt, answer][index]
    }))
    const readRows = () => {
      const db = new DatabaseSync(databasePath, { readOnly: true })
      try {
        const rows = db
          .prepare("SELECT id, role, data FROM message WHERE topic_id = ? AND role != 'root' AND deleted_at IS NULL")
          .all(topicId) as { id: string; role: string; data: string }[]
        return rows
          .map(({ id, role, data }) => ({
            id,
            role,
            text: (JSON.parse(data).parts as { type: string; text?: string }[])
              .filter((part) => part.type === 'text')
              .map((part) => part.text ?? '')
              .join('')
          }))
          .sort((a, b) => a.id.localeCompare(b.id))
      } finally {
        db.close()
      }
    }
    const expectedDatabaseRows = [...expectedRows].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
    await expect.poll(readRows).toEqual(expectedDatabaseRows)
    await screenshot('MP-02 stopped and completed messages')
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const cache = JSON.parse(localStorage.getItem('cs_cache_persist') ?? '{}')
          return (
            cache['ui.chat.last_used_topic_id'] === id &&
            (cache['ui.tab.normal_tabs'] ?? []).some(
              (tab: { url: string; isDormant?: boolean }) => !tab.isDormant && tab.url.includes(`topicId=${id}`)
            )
          )
        }, topicId)
      )
      .toBe(true)
    page = await app.restart('authenticated')
    await selectSidebarApp(page, 'Chat')
    await expect(messages()).toHaveCount(4, { timeout: 30_000 })
    expect(
      await messages().evaluateAll((elements) => elements.map((element) => element.getAttribute('data-message-id')))
    ).toEqual(ids)
    await expect(messages().nth(0).getByText(prompt, { exact: true })).toBeVisible()
    await expect(messages().nth(1).getByText(partial, { exact: true })).toBeVisible()
    await expect(messages().nth(2).getByText(prompt, { exact: true })).toBeVisible()
    await expect(messages().nth(3).getByText(answer, { exact: true })).toBeVisible()
    expect(readRows()).toEqual(expectedDatabaseRows)
    await screenshot('MP-02 messages after restart')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.naming,
          'menu.presentation_mode': preferences.menu
        })
        if (assistantId) {
          const result = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!result.ok || !result.data.deleted) throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp02-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, providerId, preferences }
    )
  }
}
