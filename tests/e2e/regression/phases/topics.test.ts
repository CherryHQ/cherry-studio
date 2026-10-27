import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, type Message, MessageSchema } from '@shared/data/types/message'
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
import { collectVirtualizedText, revealVirtualized } from '../helpers/virtualList'
import { exportTopicFiles } from '../scenarios/exportTopicFiles'
import { topicGrouping } from '../scenarios/topicGrouping'

test(...caseDefinition('MP-05'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const server = await startMockChatServer()
  const providerId = `regression-topics-${Date.now()}`
  const assistantName = app.resourceName('Persistence assistant')
  let assistantId: string | undefined
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const chat = () => page.locator('[data-ui~="chat.view"]:visible')
  const rows = () => chat().getByTestId('topic-list-row')
  const row = (name: string) => rows().filter({ has: page.getByText(name, { exact: true }) })
  const messages = () => chat().locator('[data-ui~="chat.message"][data-message-id]:visible')
  const expandAssistant = async () => {
    const header = chat().locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(header).toBeVisible()
    await header.hover()
    const expand = header.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
  }
  const readMessages = async (topicId: string) => {
    const response = await page.evaluate(
      (topicId) => window.api.dataApi.request({ id: 'mp05-read', method: 'GET', path: `/topics/${topicId}/messages` }),
      topicId
    )
    expect(response.status).toBe(200)
    const branch = response.data as BranchMessagesResponse
    expect(branch.nextCursor).toBeUndefined()
    return branch.items.map(({ message }) => MessageSchema.parse(message))
  }
  // Only the provider boundary is mocked; UI actions, SQLite and process restart are real.
  const send = async (
    prompt: string,
    answer: string,
    history: { role: string; content: string; reasoning_content?: string }[]
  ) => {
    await Promise.all([
      sendChatMarker(page, prompt, answer),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(server.modelId)
        expect(request.body.messages.filter((message) => (message as { role: string }).role !== 'system')).toEqual([
          ...history,
          { role: 'user', content: prompt }
        ])
        request.complete(answer)
      })()
    ])
  }
  const databasePath = () =>
    join(
      app.paths.profiles,
      app.record.profile,
      ...(app.record.mode === 'branch' ? ['userData'] : []),
      'Data',
      'cherrystudio.sqlite'
    )
  const query = (sql: string, parameters: string[] = []) => {
    const database = new DatabaseSync(databasePath(), { readOnly: true })
    try {
      return database.prepare(sql).all(...parameters)
    } finally {
      database.close()
    }
  }
  const checkAgentSessions = async () => {
    const sessions = query(
      "SELECT id, name FROM agent_session WHERE deleted_at IS NULL AND type = 'conversation' ORDER BY id"
    ) as { id: string; name: string }[]
    await selectSidebarApp(page, 'Work')
    const view = page.locator('[data-ui~="agent.view"]:visible')
    const showSidebar = view.getByRole('button', { name: 'Show Sidebar', exact: true })
    if (await showSidebar.isVisible()) await showSidebar.click()
    const displayMode = view.getByRole('button', { name: 'Display mode', exact: true })
    await displayMode.click()
    await page.locator('[data-slot="menu-item"]').getByText('Agent', { exact: true }).click()
    await displayMode.click()
    const collapseAll = page.getByRole('button', { name: 'Collapse all', exact: true })
    if (await collapseAll.isVisible()) {
      await collapseAll.click()
      await displayMode.click()
    }
    await page.getByRole('button', { name: 'Expand all', exact: true }).click()
    const sessionScroller = view.locator('[data-virtual-scrolling]').first()
    const showMore = view.getByRole('button', { name: 'Show more', exact: true }).first()
    for (let step = 0; step < sessions.length; step += 1) {
      await revealVirtualized(page, sessionScroller, showMore)
      if (!(await showMore.isVisible())) break
      await showMore.click()
    }
    // The session list renders only its visible window, so every stored session is
    // matched against the text the list shows while it is scrolled.
    const firstSession = page.getByTestId('agent-session-row').first()
    if ((await firstSession.count()) > 0) {
      const scroller = firstSession.locator('xpath=ancestor::*[@data-virtual-scrolling][1]')
      const listed =
        (await scroller.count()) > 0
          ? await collectVirtualizedText(page, scroller)
          : await page.evaluate(() => document.body.innerText)
      expect(
        sessions.filter(({ name }) => !listed.includes(name)).map(({ name }) => name),
        'Every stored session must be listed'
      ).toEqual([])
    } else {
      expect(sessions, 'Sessions must be listed once the store holds any').toEqual([])
    }
    await selectSidebarApp(page, 'Chat')
    return sessions
  }

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp05-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-05 mock',
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
          id: 'mp05-enable',
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
          id: 'mp05-model',
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
          id: 'mp05-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topics: Topic[] = []
    for (const label of ['Existing', 'A', 'B', 'C']) {
      const response = await page.evaluate(
        ({ name, assistantId }) =>
          window.api.dataApi.request({
            id: 'mp05-topic',
            method: 'POST',
            path: '/topics',
            body: { name, assistantId }
          }),
        { name: app.resourceName(`QA-${label}`), assistantId }
      )
      expect(response.status).toBe(201)
      topics.push(TopicSchema.parse(response.data))
    }
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const initialSessions = await checkAgentSessions()
    await expandAssistant()
    const turns = ['A', 'B', 'C'].map((label, index) => ({
      topic: topics[index + 1],
      prompt: `MP-05 ${label} unique message`,
      answer: `MP-05 ${label} unique reply`
    }))
    for (const turn of turns) {
      await row(turn.topic.name).click()
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
      await send(turn.prompt, turn.answer, [])
      await expect(messages()).toHaveCount(2)
    }
    await row(turns[1].topic.name).getByText(turns[1].topic.name, { exact: true }).dblclick()
    const rename = page.getByRole('textbox', { name: 'Edit conversation name', exact: true })
    await rename.fill('QA-renamed')
    await rename.press('Enter')
    await expect(row('QA-renamed')).toBeVisible()
    await row(turns[2].topic.name).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Pin Conversation', exact: true }).click()
    const ownedRows = () => rows().filter({ hasText: /QA-(?:Existing|A|B|C).*MP-05|QA-renamed/ })
    await expect(ownedRows().first()).toContainText(turns[2].topic.name)
    const assertTurn = async (turn: (typeof turns)[number]) => {
      await row(turn.topic.name).focus()
      await row(turn.topic.name).press('Enter')
      await expect(messages()).toHaveCount(2)
      await expect(messages().nth(0).getByText(turn.prompt, { exact: true })).toBeVisible()
      await expect(messages().nth(1).getByText(turn.answer, { exact: true })).toBeVisible()
      for (const other of turns.filter((other) => other !== turn)) {
        await expect(messages().getByText(other.prompt, { exact: true })).toHaveCount(0)
        await expect(messages().getByText(other.answer, { exact: true })).toHaveCount(0)
      }
      const stored = await readMessages(turn.topic.id)
      expect(stored.map(({ role }) => role)).toEqual(['user', 'assistant'])
      expect(
        stored.map(({ data }) =>
          (data.parts ?? [])
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')
        )
      ).toEqual([turn.prompt, turn.answer])
      expect(stored.every((message) => message.topicId === turn.topic.id)).toBe(true)
      return stored
    }
    await screenshot('MP-05 renamed and pinned topics using mock provider')
    await assertTurn(turns[0])
    await row('QA-renamed').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
    await expect(row('QA-renamed')).toHaveCount(0)
    const beforeOrder = await ownedRows().allTextContents()
    expect(beforeOrder).toHaveLength(3)
    const survivors = [turns[2], turns[0]]
    const beforeMessages: Message[][] = []
    for (const turn of survivors) beforeMessages.push(await assertTurn(turn))
    const beforeTopics = query('SELECT id, name, order_key, deleted_at FROM topic WHERE assistant_id = ? ORDER BY id', [
      assistantId
    ])
    expect(beforeTopics.filter((topic) => topic.deleted_at === null)).toHaveLength(3)
    expect(beforeTopics.find((topic) => topic.id === turns[1].topic.id)).toMatchObject({
      name: 'QA-renamed',
      deleted_at: expect.any(Number)
    })
    const beforePins = query("SELECT * FROM pin WHERE entity_type = 'topic' AND entity_id = ?", [turns[2].topic.id])
    expect(beforePins).toHaveLength(1)
    const beforePath = databasePath()
    const beforeRecord = app.record
    await screenshot('MP-05 state before complete application restart')

    page = await app.restart()
    expect(app.record.electronPid).not.toBe(beforeRecord.electronPid)
    expect(app.record.restartCount).toBe(beforeRecord.restartCount + 1)
    expect(databasePath()).toBe(beforePath)
    expect(await checkAgentSessions()).toEqual(initialSessions)
    await expandAssistant()
    await expect(ownedRows()).toHaveCount(3)
    expect(await ownedRows().allTextContents()).toEqual(beforeOrder)
    await expect(ownedRows().first()).toContainText(turns[2].topic.name)
    await expect(row('QA-renamed')).toHaveCount(0)
    expect(
      query('SELECT id, name, order_key, deleted_at FROM topic WHERE assistant_id = ? ORDER BY id', [assistantId])
    ).toEqual(beforeTopics)
    expect(query("SELECT * FROM pin WHERE entity_type = 'topic' AND entity_id = ?", [turns[2].topic.id])).toEqual(
      beforePins
    )
    for (const [index, turn] of survivors.entries()) expect(await assertTurn(turn)).toEqual(beforeMessages[index])
    await assertTurn(turns[2])
    await assertTurn(turns[0])
    await screenshot('MP-05 restored history and topic order')
    await send('MP-05 A continue after restart', 'MP-05 A continued reply', [
      { role: 'user', content: turns[0].prompt },
      { role: 'assistant', content: turns[0].answer, reasoning_content: '' }
    ])
    await expect(messages()).toHaveCount(4)
    const continued = await readMessages(turns[0].topic.id)
    expect(continued.map(({ role }) => role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(continued.slice(0, 2)).toEqual(beforeMessages[1])
    expect(continued[3].status).toBe('success')
    expect(new Set(continued.map(({ id }) => id)).size).toBe(4)
    await expect(messages().nth(2).getByText('MP-05 A continue after restart', { exact: true })).toBeVisible()
    await expect(messages().nth(3).getByText('MP-05 A continued reply', { exact: true })).toBeVisible()
    expect(await assertTurn(turns[2])).toEqual(beforeMessages[0])
    await row(turns[0].topic.name).click()
    await expect(messages()).toHaveCount(4)
    await screenshot('MP-05 old topic continued after restart')
    await testInfo.attach('MP-05 persistence counts (mock HTTP provider)', {
      body: JSON.stringify({ topicCount: 3, agentSessionCount: initialSessions.length, database: beforeTopics }),
      contentType: 'application/json'
    })
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok) {
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
        await window.api.dataApi.request({ id: 'mp05-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, providerId, preferences }
    )
  }
})

test(...caseDefinition('MP-43'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    quickModel: await window.api.preference.get('feature.quick_assistant.model_id'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const server = await startMockChatServer()
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

test(...caseDefinition('MP-46'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const prefix = app.resourceName(`Bulk topics ${Date.now()}`)
  const assistantIds: string[] = []
  const topics: { id: string; name: string; messages: unknown[] }[] = []
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readTopic = (id: string) =>
    page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp46-read-topic', method: 'GET', path: `/topics/${id}` }),
      id
    )
  const readMessages = async (id: string) => {
    const response = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp46-read-messages', method: 'GET', path: `/topics/${id}/messages` }),
      id
    )
    expect(response.status).toBe(200)
    const branch = response.data as BranchMessagesResponse
    expect(branch.nextCursor).toBeUndefined()
    return branch.items.map(({ message }) => MessageSchema.parse(message))
  }
  const history = () => page.getByRole('region', { name: 'History', exact: true })
  const openHistory = async () => {
    await selectSidebarApp(page, 'Chat')
    await page.getByRole('button', { name: 'Display mode', exact: true }).click()
    await page.getByRole('button', { name: 'History', exact: true }).click()
    await expect(history()).toBeVisible()
    await history().getByPlaceholder('Search conversations...', { exact: true }).fill(prefix)
  }
  const selectPair = async (pair: typeof topics) => {
    for (const [index, topic] of pair.entries()) {
      const checkbox = history().getByRole('checkbox', { name: `Select ${topic.name}`, exact: true })
      await checkbox.check()
      await expect(checkbox).toBeChecked()
      await expect(history().getByRole('button', { name: `Batch Move (${index + 1})`, exact: true })).toBeEnabled()
      await expect(history().getByRole('button', { name: `Batch Archive (${index + 1})`, exact: true })).toBeEnabled()
    }
    await expect(history().getByRole('checkbox', { checked: true })).toHaveCount(2)
  }
  const openMoveDialog = async () => {
    await history().getByRole('button', { name: 'Batch Move (2)', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Move selected conversations', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { expanded: false }).click()
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button')
      .filter({ hasText: `${prefix} destination` })
      .click()
    return dialog
  }

  try {
    // Seed persisted fixtures only; batch actions and their feedback use the real UI.
    for (const name of [`${prefix} source`, `${prefix} destination`]) {
      const response = await page.evaluate(
        (name) =>
          window.api.dataApi.request({ id: 'mp46-assistant', method: 'POST', path: '/assistants', body: { name } }),
        name
      )
      expect(response.status).toBe(201)
      assistantIds.push(AssistantSchema.parse(response.data).id)
    }
    for (let index = 0; index < 6; index++) {
      const name = `${prefix} topic ${index + 1}`
      const response = await page.evaluate(
        ({ name, assistantId }) =>
          window.api.dataApi.request({
            id: 'mp46-topic',
            method: 'POST',
            path: '/topics',
            body: { name, assistantId }
          }),
        { name, assistantId: assistantIds[0] }
      )
      expect(response.status).toBe(201)
      const topicId = TopicSchema.parse(response.data).id
      for (const role of ['user', 'assistant'] as const) {
        const message = await page.evaluate(
          ({ topicId, role, text }) =>
            window.api.dataApi.request({
              id: 'mp46-body',
              method: 'POST',
              path: `/topics/${topicId}/messages`,
              body: { role, data: { parts: [{ type: 'text', text }] }, status: 'success' }
            }),
          { topicId, role, text: `${name}: ${role} 正文\nSecond line with **formatting** and code 731.` }
        )
        expect(message.status).toBe(201)
      }
      const messages = await readMessages(topicId)
      expect(messages.map(({ role }) => role)).toEqual(['user', 'assistant'])
      topics.push({ id: topicId, name, messages })
    }
    await page.reload()
    await openHistory()
    await selectPair(topics.slice(0, 2))
    await attachScreenshot('MP-46 two conversations selected')

    await test.step('Batch archive moves both conversations to the recycle bin and offers undo', async () => {
      const archived = topics.slice(0, 2)
      await history().getByRole('button', { name: 'Batch Archive (2)', exact: true }).click()
      await expect(
        page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo', exact: true }).last(),
        'Archiving must offer an undo action'
      ).toBeVisible({ timeout: 10_000 })
      for (const topic of archived) {
        await expect(history().getByRole('checkbox', { name: `Select ${topic.name}`, exact: true })).toHaveCount(0)
        await expect.poll(async () => (await readTopic(topic.id)).status).toBe(404)
      }
      const retained = await page.evaluate(
        (ids) =>
          window.api.dataApi.request({
            id: 'mp46-archived-storage',
            method: 'GET',
            path: '/topics',
            params: { ids, inTrash: true }
          }),
        archived.map(({ id }) => id)
      )
      expect(retained.status).toBe(200)
      expect(
        (retained.data as { items: Array<{ id: string }> }).items.map(({ id }) => id).sort(),
        'Archived conversations must stay in the recycle bin until they are purged'
      ).toEqual(archived.map(({ id }) => id).sort())
      await attachScreenshot('MP-46 archived conversations in the recycle bin')
    })

    await test.step('Undo restores the archived conversations', async () => {
      const archived = topics.slice(0, 2)
      await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo', exact: true }).last().click()
      for (const topic of archived) await expect.poll(async () => (await readTopic(topic.id)).status).toBe(200)
      await expect(history().getByRole('checkbox', { name: `Select ${archived[0].name}`, exact: true })).toBeVisible()
      await attachScreenshot('MP-46 archived conversations restored from undo')
    })

    await test.step('Emptying the recycle bin removes the archived rows permanently', async () => {
      const archived = topics.slice(0, 2)
      await selectPair(archived)
      await history().getByRole('button', { name: 'Batch Archive (2)', exact: true }).click()
      for (const topic of archived) await expect.poll(async () => (await readTopic(topic.id)).status).toBe(404)
      const purge = (await page.evaluate(() => window.api.ipcApi.request('trash.purge_now'))) as {
        ok: boolean
        data: { status: string }
      }
      expect(purge.ok, 'Emptying the recycle bin must succeed').toBe(true)
      expect(purge.data.status, 'Emptying the recycle bin must finish').toBe('completed')
      await expect
        .poll(
          async () => {
            const rows = await page.evaluate(
              (ids) =>
                window.api.dataApi.request({
                  id: 'mp46-purged-storage',
                  method: 'GET',
                  path: '/topics',
                  params: { ids, inTrash: true }
                }),
              archived.map(({ id }) => id)
            )
            return (rows.data as { items: unknown[] }).items.length
          },
          { message: 'Purging the recycle bin must delete the archived rows' }
        )
        .toBe(0)
      await attachScreenshot('MP-46 recycle bin emptied')
    })

    await test.step('Move two conversations and preserve their full message records across restart', async () => {
      await selectPair(topics.slice(2, 4))
      const dialog = await openMoveDialog()
      await dialog.getByRole('button', { name: 'Move', exact: true }).click()
      await expect(dialog).toBeHidden()
      for (const topic of topics.slice(2, 4)) {
        const response = await readTopic(topic.id)
        expect(response.status).toBe(200)
        expect(TopicSchema.parse(response.data).assistantId).toBe(assistantIds[1])
        expect(await readMessages(topic.id)).toEqual(topic.messages)
        await expect(history().getByRole('row').filter({ hasText: topic.name })).toContainText(`${prefix} destination`)
      }
      page = await app.restart()
      await openHistory()
      for (const topic of topics.slice(0, 2)) {
        expect((await readTopic(topic.id)).status).toBe(404)
        await expect(history().getByRole('checkbox', { name: `Select ${topic.name}`, exact: true })).toHaveCount(0)
      }
      for (const topic of topics.slice(2, 4)) {
        const response = await readTopic(topic.id)
        expect(response.status).toBe(200)
        expect(TopicSchema.parse(response.data).assistantId).toBe(assistantIds[1])
        expect(await readMessages(topic.id)).toEqual(topic.messages)
        await expect(history().getByRole('row').filter({ hasText: topic.name })).toContainText(`${prefix} destination`)
      }
      await attachScreenshot('MP-46 moved conversations after restart')
    })

    await test.step('Each failed batch move identifies the affected conversation', async () => {
      const failed = topics.slice(4, 6)
      await selectPair(failed)
      const dialog = await openMoveDialog()
      // Reproduce a destination deleted concurrently, submitting before React replaces the stale target.
      const archived = await dialog
        .getByRole('button', { name: 'Move', exact: true })
        .evaluate(async (button, assistantId) => {
          const result = await window.api.ipcApi.request('trash.assistant.archive', {
            assistantId,
            deleteTopics: false
          })
          ;(button as HTMLButtonElement).click()
          return result
        }, assistantIds[1])
      expect(archived).toMatchObject({ ok: true, data: { deleted: true } })
      await expect(dialog).toBeHidden()
      await expect(page.getByRole('region', { name: 'notifications' }).getByRole('alert')).toBeVisible()
      await attachScreenshot('MP-46 failed batch move feedback')
      for (const topic of failed) {
        const response = await readTopic(topic.id)
        expect(response.status).toBe(200)
        expect(TopicSchema.parse(response.data).assistantId).toBe(assistantIds[0])
        expect(await readMessages(topic.id)).toEqual(topic.messages)
        await expect
          .soft(
            page.getByRole('region', { name: 'notifications' }).getByRole('alert').filter({ hasText: topic.name }),
            `Failed move must identify conversation ${topic.name}`
          )
          .toBeVisible({ timeout: 5_000 })
      }
    })
  } finally {
    if (!page.isClosed()) {
      await page.evaluate(async (assistantIds) => {
        for (const assistantId of assistantIds) {
          const permanentlyDeletedAssistant4 = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant4.ok) {
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
      }, assistantIds)
    }
  }
})

test(...caseDefinition('MP-47'), async ({ app, mainWindow }, testInfo) => {
  await exportTopicFiles(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-48'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const server = await startMockChatServer()
  const providerId = `regression-draft-${Date.now()}`
  const assistantName = app.resourceName('Draft assistant')
  const draft = 'MP-48 会话草稿：这段文字尚未发送。'
  const answer = 'MP-48 draft received successfully.'
  let assistantId: string | undefined
  const namingEnabled = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  const chat = () => page.locator('[data-ui~="chat.view"]:visible')
  const composer = () => chat().locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  const row = (name: string) =>
    chat()
      .getByTestId('topic-list-row')
      .filter({ has: page.getByText(name, { exact: true }) })
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const openTopics = async () => {
    await selectSidebarApp(page, 'Chat')
    const header = chat().locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(header).toBeVisible()
    await header.hover()
    const expand = header.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
  }
  const readMessages = async (topicId: string) => {
    const response = await page.evaluate(
      (topicId) => window.api.dataApi.request({ id: 'mp48-read', method: 'GET', path: `/topics/${topicId}/messages` }),
      topicId
    )
    expect(response.status).toBe(200)
    const branch = response.data as BranchMessagesResponse
    expect(branch.nextCursor).toBeUndefined()
    return branch.items.map(({ message }) => MessageSchema.parse(message))
  }

  try {
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    // Only the model HTTP endpoint is mocked; draft persistence and Electron restart remain real.
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp48-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-48 mock',
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
          id: 'mp48-enable',
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
          id: 'mp48-model',
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
          id: 'mp48-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topics: Topic[] = []
    for (const label of ['Existing draft topic', 'Other topic']) {
      const response = await page.evaluate(
        ({ name, assistantId }) =>
          window.api.dataApi.request({
            id: 'mp48-topic',
            method: 'POST',
            path: '/topics',
            body: { name, assistantId }
          }),
        { name: app.resourceName(label), assistantId }
      )
      expect(response.status).toBe(201)
      topics.push(TopicSchema.parse(response.data))
    }
    const [topic, otherTopic] = topics
    await page.reload()
    await openTopics()
    await row(topic.name).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    await composer().fill(draft)
    await expect(composer()).toHaveText(draft)
    expect(await readMessages(topic.id)).toEqual([])

    await row(otherTopic.name).click()
    await expect(composer()).toHaveText('')
    await expect(row(topic.name).getByRole('img', { name: 'Draft', exact: true })).toBeVisible()
    await row(topic.name).click()
    await expect(composer()).toHaveText(draft)
    await composer().focus()
    await screenshot('MP-48 draft restored after topic switch')
    await expect.soft
      .poll(
        () =>
          composer().evaluate((editor) => {
            const selection = window.getSelection()
            if (
              !selection ||
              selection.rangeCount === 0 ||
              !selection.isCollapsed ||
              !editor.contains(selection.anchorNode)
            ) {
              return null
            }
            const beforeCaret = selection.getRangeAt(0).cloneRange()
            beforeCaret.selectNodeContents(editor)
            beforeCaret.setEnd(selection.anchorNode!, selection.anchorOffset)
            return beforeCaret.toString().length
          }),
        { timeout: 5_000, message: 'Returning to a draft should restore the caret at its previous end position' }
      )
      .toBe(draft.length)
    expect(await readMessages(topic.id)).toEqual([])

    const beforeRestart = app.record
    page = await app.restart()
    expect(app.record.electronPid).not.toBe(beforeRestart.electronPid)
    expect(app.record.restartCount).toBe(beforeRestart.restartCount + 1)
    await openTopics()
    await row(topic.name).click()
    await screenshot('MP-48 draft after full application restart')
    await expect(composer(), 'Unsent text must survive a complete application restart').toHaveText(draft)
    expect(await readMessages(topic.id)).toEqual([])

    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const request = await server.nextRequest()
    expect(request.body.model).toBe(server.modelId)
    expect(request.body.messages.filter((message) => (message as { role: string }).role !== 'system')).toEqual([
      { role: 'user', content: draft }
    ])
    request.complete(answer)
    const messages = chat().locator('[data-ui~="chat.message"][data-message-id]:visible')
    await expect(messages).toHaveCount(2)
    await expect(messages.first().getByText(draft, { exact: true })).toBeVisible()
    await expect(messages.last().getByText(answer, { exact: true })).toBeVisible()
    await expect
      .poll(async () => (await readMessages(topic.id)).map(({ role, status }) => ({ role, status })))
      .toEqual([
        { role: 'user', status: 'success' },
        { role: 'assistant', status: 'success' }
      ])
    const stored = await readMessages(topic.id)
    expect(
      stored.map(({ data }) =>
        (data.parts ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('')
      )
    ).toEqual([draft, answer])
    await expect(composer()).toHaveText('')
    await row(otherTopic.name).click()
    await expect(row(topic.name).getByRole('img', { name: 'Draft', exact: true })).toHaveCount(0)
    expect(await readMessages(otherTopic.id)).toEqual([])
    await row(topic.name).click()
    await expect(composer()).toHaveText('')
    await expect(messages).toHaveCount(2)
    await screenshot('MP-48 draft sent and cleared using mock provider')
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.evaluate(
      async ({ assistantId, providerId, namingEnabled }) => {
        await window.api.preference.set('topic.naming.enabled', namingEnabled)
        if (assistantId) {
          const permanentlyDeletedAssistant5 = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant5.ok) {
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
        await window.api.dataApi.request({ id: 'mp48-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, providerId, namingEnabled }
    )
  }
})
