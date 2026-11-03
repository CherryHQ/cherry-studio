import { writeFile } from 'node:fs/promises'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { type Topic, TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { expect, test } from '../fixture'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp, dismissOnboarding } from '../helpers/navigation'
import { topicGrouping } from '../scenarios/topicGrouping'

test(...caseDefinition('MP-43'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    quickModel: await window.api.preference.get('feature.quick_assistant.model_id'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const providerId = `regression-mp43-${Date.now()}`
  const assistantName = app.resourceName('Topic naming assistant')
  const initialName = app.resourceName('Topic naming')
  const otherName = app.resourceName('Other topic')
  const quickModel = 'mp43-quick-model'
  const invalidModel = 'mp43-invalid-quick-model'
  const generatedName = 'Kyoto autumn itinerary'
  let assistantId: string | undefined

  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const showTopics = async () => {
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible().catch(() => false)) await expand.click()
    return chat
  }

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp43-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-43 mock provider',
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
          id: 'mp43-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelIds }) =>
        window.api.dataApi.request({
          id: 'mp43-models',
          method: 'POST',
          path: '/models',
          body: modelIds.map((modelId) => ({ providerId, modelId, endpointTypes: ['openai-chat-completions'] }))
        }),
      { providerId, modelIds: [server.modelId, quickModel, invalidModel] }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp43-assistant',
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
          id: 'mp43-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: initialName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id
    const other = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp43-other',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: otherName, assistantId }
    )
    expect(other.status).toBe(201)
    const readTopic = async () => {
      const response = await page.evaluate(
        (topicId) =>
          window.api.dataApi.request({
            id: 'mp43-read',
            method: 'GET',
            path: `/topics/${topicId}`
          }),
        topicId
      )
      expect(response.status).toBe(200)
      return TopicSchema.parse(response.data)
    }

    await page.reload()
    let chat = await showTopics()
    let row = chat.getByTestId('topic-list-row').filter({ hasText: initialName })
    await row.click()
    const prompt = 'Plan a three-day autumn itinerary in Kyoto with temples and maple leaves.'
    const answer = 'Visit Kiyomizu-dera, Arashiyama and Tofuku-ji to enjoy Kyoto autumn maple leaves.'
    await Promise.all([
      sendChatMarker(page, prompt, answer),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(server.modelId)
        request.complete(answer)
      })()
    ])
    await row.getByText(initialName, { exact: true }).dblclick()
    let inputs = page.getByRole('textbox', { name: 'Edit conversation name', exact: true })
    await expect(inputs).toHaveCount(1)
    await chat.getByTestId('topic-list-row').getByText(otherName, { exact: true }).dblclick()
    await expect(inputs).toHaveCount(1)
    await row.getByText(initialName, { exact: true }).dblclick()
    await expect(inputs).toHaveCount(1)
    await inputs.fill('QA-改名')
    await inputs.press('Enter')
    await expect(inputs).toHaveCount(0)
    row = chat.getByTestId('topic-list-row').filter({ hasText: 'QA-改名' })
    await expect(row.getByText('QA-改名', { exact: true })).toBeVisible()
    await expect.poll(readTopic).toMatchObject({ name: 'QA-改名', isNameManuallyEdited: true })
    await screenshot('MP-43 inline rename')

    page = await app.restart()
    await dismissOnboarding(page)
    chat = await showTopics()
    row = chat.getByTestId('topic-list-row').filter({ hasText: 'QA-改名' })
    await expect(row.getByText('QA-改名', { exact: true })).toBeVisible()
    expect((await readTopic()).name).toBe('QA-改名')
    await page.evaluate(
      (modelId) => window.api.preference.set('feature.quick_assistant.model_id', modelId),
      createUniqueModelId(providerId, quickModel)
    )
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Generate conversation name', exact: true }).click()
    const namingRequest = await server.nextRequest()
    // The mock only supplies text; the real request must use the quick model and carry the conversation.
    expect(namingRequest.body.model).toBe(quickModel)
    expect(JSON.stringify(namingRequest.body.messages)).toContain(prompt)
    expect(JSON.stringify(namingRequest.body.messages)).toContain(answer)
    namingRequest.complete(generatedName)
    row = chat.getByTestId('topic-list-row').filter({ hasText: generatedName })
    await expect(row.getByText(generatedName, { exact: true })).toBeVisible()
    await expect.poll(readTopic).toMatchObject({ name: generatedName })
    await screenshot('MP-43 quick model generated name')

    page = await app.restart()
    await dismissOnboarding(page)
    chat = await showTopics()
    row = chat.getByTestId('topic-list-row').filter({ hasText: generatedName })
    await expect(row.getByText(generatedName, { exact: true })).toBeVisible()
    expect((await readTopic()).name).toBe(generatedName)
    await page.evaluate(
      (modelId) => window.api.preference.set('feature.quick_assistant.model_id', modelId),
      createUniqueModelId(providerId, invalidModel)
    )
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Generate conversation name', exact: true }).click()
    const failedRequest = await server.nextRequest()
    expect(failedRequest.body.model).toBe(invalidModel)
    failedRequest.fail('MP-43 invalid quick model: model does not exist')
    await expect(page.getByText(/Failed to name the conversation/)).toBeVisible()
    await expect(row.getByText(generatedName, { exact: true })).toBeVisible()
    expect((await readTopic()).name).toBe(generatedName)
    inputs = page.getByRole('textbox', { name: 'Edit conversation name', exact: true })
    await expect(inputs).toHaveCount(0)
    await screenshot('MP-43 failure preserves name')
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'feature.quick_assistant.model_id': preferences.quickModel,
          'menu.presentation_mode': preferences.menuMode
        })
        if (assistantId) {
          const permanentlyDeletedAssistant2 = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant2.ok) {
            // This case archived the assistant itself, and the trash route deletes active rows only.
            // The trash route only removes active rows, so purge the archived assistant through its
            // DataApi route: the query belongs in `params`, and the handler reports the removal.
            const purge = await window.api.dataApi.request({
              id: 'cleanup-assistant-purge',
              method: 'DELETE',
              path: `/assistants/${assistantId}`,
              params: { permanent: true }
            })
            if (purge.status !== 200 || (purge.data as { deleted?: boolean } | null)?.deleted !== true)
              throw new Error('cleanup left the case assistant in the trash')
            const reread = await window.api.dataApi.request({
              id: 'cleanup-assistant-verify',
              method: 'GET',
              path: `/assistants/${assistantId}`
            })
            if (reread.status !== 404) throw new Error('cleanup left the case assistant readable')
          }
        }
        await window.api.dataApi.request({ id: 'mp43-delete', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, providerId, preferences }
    )
  }
})

test(...caseDefinition('MP-44'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const assistantName = app.resourceName('Topic ordering assistant')
  const preferences = await page.evaluate(async () => ({
    displayMode: await window.api.preference.get('topic.tab.display_mode'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  let assistantId: string | undefined
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const chat = () => page.locator('[data-ui~="chat.view"]:visible')
  const rows = () => chat().getByTestId('topic-list-row').filter({ hasText: 'MP-44' })
  const row = (name: string) => rows().filter({ hasText: name })
  const expandAssistant = async () => {
    const header = chat().locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(header).toBeVisible()
    await header.hover()
    const expand = header.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
  }

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.tab.display_mode': 'time', 'menu.presentation_mode': 'cherry' })
    )
    const assistant = await page.evaluate(
      (name) =>
        window.api.dataApi.request({ id: 'mp44-assistant', method: 'POST', path: '/assistants', body: { name } }),
      assistantName
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topics: Topic[] = []
    for (let index = 1; index <= 4; index++) {
      const response = await page.evaluate(
        ({ name, assistantId }) =>
          window.api.dataApi.request({
            id: 'mp44-topic',
            method: 'POST',
            path: '/topics',
            body: { name, assistantId }
          }),
        { name: app.resourceName(`Ordering topic ${index}`), assistantId }
      )
      expect(response.status).toBe(201)
      topics.push(TopicSchema.parse(response.data))
    }
    const chronologicalNames = topics.toReversed().map(({ name }) => name)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await expect(rows()).toHaveText(chronologicalNames)
    const oldest = topics[0].name
    await row(oldest).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin Conversation', exact: true }).click()
    await expect(chat().getByTestId('topic-list-row').first()).toContainText(oldest)
    const pinIndicator = row(oldest).getByRole('button', { name: 'Unpin Conversation', exact: true })
    await expect(pinIndicator).toBeVisible()
    await expect(pinIndicator).toHaveAttribute('aria-pressed', 'true')
    await attachScreenshot('MP-44 pinned conversation at top')

    await row(oldest).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Unpin Conversation', exact: true }).click()
    await expect(rows()).toHaveText(chronologicalNames)
    await expect(row(oldest).getByRole('button', { name: 'Pin Conversation', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await attachScreenshot('MP-44 unpinned chronological position')

    await page.evaluate(() => window.api.preference.set('topic.tab.display_mode', 'assistant'))
    await expandAssistant()
    await expect(rows()).toHaveCount(4)
    const before = await rows().allTextContents()
    const activeName = before[3].trim()
    await row(activeName).click()
    await expect(row(activeName)).toHaveAttribute('aria-selected', 'true')
    const source = rows().nth(1)
    const target = rows().nth(0)
    const sourceBox = await source.boundingBox()
    const targetBox = await target.boundingBox()
    if (!sourceBox || !targetBox) throw new Error('Topic drag rows have no visible bounds')
    const x = sourceBox.x + sourceBox.width / 2
    await page.bringToFront()
    await page.mouse.move(x, sourceBox.y + sourceBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(x + 12, sourceBox.y + sourceBox.height / 2, { steps: 5 })
    await expect(chat().locator('[data-dragging="true"]').first()).toBeVisible()
    await expect(row(activeName)).toHaveAttribute('aria-selected', 'true')
    await page.mouse.move(x, targetBox.y + targetBox.height * 0.2)
    await expect(chat().locator('[data-drop-indicator="before"]')).toBeVisible()
    await expect(row(activeName)).toHaveAttribute('aria-selected', 'true')
    await page.mouse.up()
    const reordered = [before[1], before[0], before[2], before[3]]
    await expect(rows()).toHaveText(reordered)
    await expect(row(activeName)).toHaveAttribute('aria-selected', 'true')
    await attachScreenshot('MP-44 dragged order without opening another conversation')

    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    await selectSidebarApp(page, 'Chat')
    await expandAssistant()
    await expect(rows()).toHaveText(reordered)
    await attachScreenshot('MP-44 order preserved after restart')
  } finally {
    page = await app.mainWindow()
    await page.evaluate(
      async ({ assistantId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.tab.display_mode': preferences.displayMode,
          'menu.presentation_mode': preferences.menuMode
        })
        if (assistantId) {
          const permanentlyDeletedAssistant3 = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant3.ok) {
            // This case archived the assistant itself, and the trash route deletes active rows only.
            // The trash route only removes active rows, so purge the archived assistant through its
            // DataApi route: the query belongs in `params`, and the handler reports the removal.
            const purge = await window.api.dataApi.request({
              id: 'cleanup-assistant-purge',
              method: 'DELETE',
              path: `/assistants/${assistantId}`,
              params: { permanent: true }
            })
            if (purge.status !== 200 || (purge.data as { deleted?: boolean } | null)?.deleted !== true)
              throw new Error('cleanup left the case assistant in the trash')
            const reread = await window.api.dataApi.request({
              id: 'cleanup-assistant-verify',
              method: 'GET',
              path: `/assistants/${assistantId}`
            })
            if (reread.status !== 404) throw new Error('cleanup left the case assistant readable')
          }
        }
      },
      { assistantId, preferences }
    )
  }
})

test(...caseDefinition('MP-45'), async ({ app, mainWindow }, testInfo) => {
  await topicGrouping(app, mainWindow, testInfo)
})
