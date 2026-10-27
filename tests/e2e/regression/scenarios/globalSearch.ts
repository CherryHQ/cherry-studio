import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AgentEntitySchema } from '@shared/data/api/schemas/agents'
import { AssistantSchema } from '@shared/data/types/assistant'
import { KnowledgeBaseSchema } from '@shared/data/types/knowledge'
import { MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { setOwnedMainWindowFocus } from '../../../../scripts/e2e/regression/debugBridge'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function globalSearch(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const token = `MP129Search${Date.now()}`
  const assistantName = `${token} Assistant`
  const topicName = `${token} Conversation`
  const knowledgeName = `${token} Knowledge`
  const taskName = `${token} Task`
  const marker = `${token} needle in the conversation body`
  const providerId = `mp129-${Date.now()}`
  const modelId = createUniqueModelId(providerId, 'search-fixture')
  let assistantId: string | undefined
  let knowledgeId: string | undefined
  let agentId: string | undefined
  const originalShortcut = await page.evaluate(() => window.api.preference.get('shortcut.app.search'))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const search = page.getByRole('dialog', { name: 'Open global search', exact: true })
  const input = search.getByRole('combobox')
  const openSearch = async () => {
    await setOwnedMainWindowFocus(app.record, true)
    await page.bringToFront()
    await page.keyboard.press('ControlOrMeta+Shift+F')
    await expect(search).toBeVisible()
    try {
      await expect(input).toBeFocused()
    } catch (error) {
      const focusState = await page.evaluate(() => ({
        documentFocused: document.hasFocus(),
        activeTag: document.activeElement?.tagName,
        activeRole: document.activeElement?.getAttribute('role'),
        activeLabel: document.activeElement?.getAttribute('aria-label'),
        dialogs: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
          .filter((element) => element.getClientRects().length)
          .map((element) => ({
            state: element.getAttribute('data-state'),
            title: document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent
          }))
      }))
      await testInfo.attach('MP-129 focus diagnostics', {
        body: JSON.stringify(focusState),
        contentType: 'application/json'
      })
      throw error
    }
  }
  const group = (label: string, count: number) =>
    search.locator('[role="presentation"]').filter({ hasText: new RegExp(`^${label}\\s*·\\s*${count}$`) })

  try {
    await page.evaluate(() =>
      window.api.preference.set('shortcut.app.search', {
        binding: ['CommandOrControl', 'Shift', 'F'],
        enabled: true
      })
    )
    const provider = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp129-provider',
          method: 'POST',
          path: '/providers',
          body: { providerId, name: 'MP129 fixture' }
        }),
      providerId
    )
    expect(provider.status).toBe(201)
    const model = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp129-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: 'search-fixture' }]
        }),
      providerId
    )
    expect(model.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp129-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp129-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id
    // Persisted fixtures exercise the real search index; no search results or model replies are mocked.
    const message = await page.evaluate(
      ({ topicId, marker }) =>
        window.api.dataApi.request({
          id: 'mp129-message',
          method: 'POST',
          path: `/topics/${topicId}/messages`,
          body: { role: 'user', data: { parts: [{ type: 'text', text: marker }] }, status: 'success' }
        }),
      { topicId, marker }
    )
    expect(message.status).toBe(201)
    const messageId = MessageSchema.parse(message.data).id
    const knowledge = await page.evaluate(
      (name) => window.api.ipcApi.request('knowledge.create_base', { base: { name } }),
      knowledgeName
    )
    expect(knowledge).toMatchObject({ ok: true })
    knowledgeId = KnowledgeBaseSchema.parse((knowledge as { data: unknown }).data).id
    const agent = await page.evaluate(
      ({ model, name }) =>
        window.api.ipcApi.request('ai.agent.create', {
          name,
          model,
          type: 'pi'
        }),
      { model: modelId, name: `MP129 task owner ${Date.now()}` }
    )
    expect(agent).toMatchObject({ ok: true })
    agentId = AgentEntitySchema.parse((agent as { data: unknown }).data).id
    const task = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: 'mp129-task',
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId, name: taskName }
    )
    expect(task.status, JSON.stringify(task)).toBe(201)

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await openSearch()
    await input.fill(assistantName)
    await expect(group('Assistant', 1)).toBeVisible()
    const assistantResult = search.getByRole('option').filter({ hasText: assistantName })
    await expect(assistantResult).toHaveCount(1)
    await assistantResult.click()
    const editDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('textbox', { name: 'Name', exact: true }) })
      .last()
    await expect(editDialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(assistantName)
    await page.keyboard.press('Escape')
    await expect(editDialog).toBeHidden()

    await input.fill(knowledgeName)
    await expect(group('Knowledge', 1)).toBeVisible()
    await search.getByRole('option').filter({ hasText: knowledgeName }).click()
    await expect(search).toBeHidden()
    await expect(
      page.locator('[data-ui~="knowledge.content"]').getByText(knowledgeName, { exact: true }).first()
    ).toBeVisible()

    await openSearch()
    await input.fill(token)
    for (const label of ['Conversation', 'Task', 'Messages', 'Assistant', 'Knowledge']) {
      await expect(async () => {
        if (!(await group(label, 1).isVisible())) {
          await search.getByRole('listbox').evaluate((element) => {
            element.scrollTop += 180
          })
        }
        await expect(group(label, 1)).toBeVisible({ timeout: 500 })
      }).toPass({ timeout: 10_000 })
    }
    await search.getByRole('listbox').evaluate((element) => {
      element.scrollTop = 0
    })
    await screenshot('MP-129 cross-type results and counts')
    await search.getByRole('option').filter({ hasText: topicName }).first().click()
    await expect(search).toBeHidden()
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chat.getByTestId('topic-list-row').filter({ hasText: topicName })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(chat.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)).toContainText(marker)

    await openSearch()
    await input.fill(taskName)
    await expect(group('Task', 1)).toBeVisible()
    await search.getByRole('option').filter({ hasText: taskName }).click()
    await expect(search).toBeHidden()
    const agentView = page.locator('[data-ui~="agent.view"]:visible')
    await expect(agentView).toBeVisible()
    await expect(agentView.getByText(taskName, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    const gatewayDialog = page.getByRole('dialog', { name: 'Enable the API Gateway?', exact: true })
    if (await gatewayDialog.isVisible())
      await gatewayDialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    await openSearch()
    await input.fill(`${token}missing`)
    await expect(search.getByText('No results', { exact: true })).toBeVisible()
    await expect(search.getByRole('option')).toHaveCount(0)
    await input.fill('')
    const typingStart = Date.now()
    await input.pressSequentially(token, { delay: 15 })
    await expect(input).toHaveValue(token)
    expect(Date.now() - typingStart, 'Search must accept continuous typing without blocking').toBeLessThan(3000)
    await expect(input).toBeFocused()
    await search.getByRole('radio', { name: 'Messages', exact: true }).click()
    await input.fill(marker)
    await expect(search.locator('[role="presentation"]').filter({ hasText: topicName })).toContainText(
      'Conversation messages·1'
    )
    const messageResult = search.getByRole('option').filter({ hasText: marker })
    await expect(messageResult).toHaveCount(1)
    await screenshot('MP-129 message content search')
    await messageResult.hover()
    await messageResult.getByRole('button', { name: 'Jump to message', exact: true }).click()
    await expect(search).toBeHidden()
    const target = chat.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)
    await expect(target).toContainText(marker)
    await expect(target).toBeInViewport()
    await expect(target.locator('.animation-locate-highlight')).toBeVisible()
    await screenshot('MP-129 located message after jump')
  } finally {
    await page.evaluate(
      async ({ assistantId, knowledgeId, agentId, providerId, originalShortcut }) => {
        await window.api.preference.set('shortcut.app.search', originalShortcut)
        if (knowledgeId) await window.api.ipcApi.request('knowledge.delete_base', { baseId: knowledgeId })
        if (agentId) {
          const deletedAgent = (await window.api.ipcApi.request('ai.agent.delete_permanently', {
            agentId,
            deleteSessions: true
          })) as IpcResult<{ deleted: boolean }>
          if (!deletedAgent.ok || !deletedAgent.data.deleted) throw new Error('cleanup left the case agent active')
        }
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp129-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, knowledgeId, agentId, providerId, originalShortcut }
    )
  }
}
