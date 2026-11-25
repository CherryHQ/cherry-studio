import type { BranchMessagesResponse } from '../../../src/shared/data/types/message'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'
import { waitForAppReady } from './utils/waitHelpers'

for (const branch of [false, true]) {
  const scenario = branch
    ? 'Chat continues the paused queue on its original path after a separate branch completes'
    : 'Chat queued follow-ups append to the same conversation path in order'
  test(scenario, async ({ mainWindow: page }) => {
    test.setTimeout(180_000)
    await waitForAppReady(page)

    const server = await startMockChatServer()
    const providerId = 'chat-followup-test'
    const messages = ['Initial question', 'First queued question', 'Second queued question']
    const answers = ['Initial response', 'First queued response', 'Second queued response']
    if (!branch) {
      messages.push('Third queued question')
      answers.push('Third queued response')
    }

    try {
      const language = page.locator('[data-onboarding-language-select]')
      const sidebar = page.locator('#app-sidebar')
      await expect(sidebar.or(language).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
      if (await language.isVisible()) {
        await language.getByRole('combobox').click()
        await page.getByRole('option', { name: 'English', exact: false }).first().click()
        await page.getByRole('button', { name: 'Set up later', exact: true }).click()
      }
      const fixture = await page.evaluate(
        async ({ providerId, baseUrl, modelId, uniqueModelId }) => {
          const created = await window.api.dataApi.request({
            id: 'followup-provider',
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: 'Chat Follow-up Test',
              defaultChatEndpoint: 'openai-chat-completions',
              endpointConfigs: { 'openai-chat-completions': { baseUrl } },
              apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
            }
          })
          const enabled = await window.api.dataApi.request({
            id: 'followup-provider-enable',
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: { isEnabled: true }
          })
          const models = await window.api.dataApi.request({
            id: 'followup-model',
            method: 'POST',
            path: '/models',
            body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
          })
          const assistant = await window.api.dataApi.request({
            id: 'followup-assistant',
            method: 'POST',
            path: '/assistants',
            body: { name: 'Follow-up QA Assistant', modelId: uniqueModelId }
          })
          const assistantId = (assistant.data as { id: string } | undefined)?.id
          if (!assistantId) throw new Error('Could not prepare the local test assistant')
          const topic = await window.api.dataApi.request({
            id: 'followup-topic',
            method: 'POST',
            path: '/topics',
            body: { name: 'Follow-up QA Chat', assistantId }
          })
          return {
            status: [created.status, enabled.status, models.status, assistant.status, topic.status],
            topicId: (topic.data as { id: string } | undefined)?.id
          }
        },
        {
          providerId,
          baseUrl: server.baseUrl,
          modelId: server.modelId,
          uniqueModelId: createUniqueModelId(providerId, server.modelId)
        }
      )
      expect(fixture.status).toEqual([201, 200, 201, 201, 201])
      expect(fixture.topicId).toBeTruthy()
      const opened = await page.evaluate(
        (topicId) =>
          window.api.ipcApi.request('navigation.open_route_in_main', { path: '/app/chat?topicId=' + topicId }),
        fixture.topicId
      )
      expect(opened).toMatchObject({ ok: true })
      const view = uiLocator(page, 'chat.view').filter({ visible: true })

      const composer = uiLocator(view, 'chat.composer').filter({ visible: true })
      const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]')
      const transcript = view.getByRole('region', { name: 'Messages', exact: true })
      const message = (text: string) => transcript.getByText(text, { exact: true })
      await expect(editor).toBeEditable({ timeout: 45_000 })
      const send = async (text: string) => {
        await editor.fill(text)
        const button = composer.getByRole('button', { name: 'Send', exact: true })
        await expect(button).toHaveAttribute('aria-disabled', 'false')
        await button.click()
        await expect(editor).toHaveText('')
      }
      const readMessages = (messages: MockChatRequest['body']['messages']) =>
        messages.map((raw) => {
          const { role, content } = raw as { role: string; content: string | { type: string; text?: string }[] }
          return {
            role,
            content:
              typeof content === 'string'
                ? content
                : content
                    .filter((part) => part.type === 'text')
                    .map((part) => part.text)
                    .join('')
          }
        })
      const nextTurn = async (text: string) => {
        const request = await server.nextRequest(20_000)
        const users = readMessages(request.body.messages).filter((item) => item.role === 'user')
        expect(users.at(-1)).toMatchObject({ role: 'user', content: text })
        return request
      }

      await send(messages[0])
      const initial = await nextTurn(messages[0])
      initial.sendText(answers[0])
      await expect(transcript).toContainText(answers[0], { timeout: 25_000 })
      await expect(uiLocator(composer, 'chat.composer.action.pause')).toBeVisible()
      for (const [index, text] of messages.slice(1).entries()) {
        await send(text)
        await expect(view.getByRole('button', { name: `Queued (${index + 1})`, exact: true })).toBeVisible()
      }
      initial.complete()

      const branchQuestion = 'Separate branch question'
      const branchAnswer = 'Separate branch answer'
      const branchPanel = view.getByRole('button', { name: 'Branch Management', exact: true })
      const flow = page.getByRole('application')
      const flowNode = (id: string) => flow.locator(`[data-message-id="${id}"]`)
      const messageId = async (text: string) => {
        const id = await uiLocator(transcript, 'chat.message')
          .filter({ has: page.getByText(text, { exact: true }) })
          .getAttribute('data-message-id')
        if (!id) throw new Error('Could not read the visible message ID')
        return id
      }
      let otherReplyId: string | undefined
      const requests: MockChatRequest['body']['messages'][] = []
      for (const [index, text] of messages.slice(1).entries()) {
        const request = await nextTurn(text)
        requests.push(request.body.messages)
        if (!branch || index !== 0) {
          request.complete(answers[index + 1])
          continue
        }

        const dock = view.getByRole('button', { name: 'Queued (1)', exact: true })
        if ((await dock.getAttribute('aria-expanded')) === 'false') await dock.click()
        await view.getByRole('button', { name: 'Pause auto-send', exact: true }).click()
        request.complete(answers[1])
        await expect(message(answers[1])).toBeVisible()
        await expect(uiLocator(composer, 'chat.composer.action.pause')).toBeHidden()
        const initialReplyId = await messageId(answers[0])
        await branchPanel.click()
        await page.getByRole('button', { name: 'Fit View', exact: true }).click()
        await flowNode(initialReplyId).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'New Branch', exact: true }).click()
        await expect(message(answers[1])).toHaveCount(0)
        // The branch-created notification can briefly cover this control.
        await branchPanel.press('Enter')
        await expect(flow).toBeHidden()
        await send(branchQuestion)
        const separate = await nextTurn(branchQuestion)
        separate.complete(branchAnswer)
        await expect(message(branchAnswer)).toBeVisible()
        await expect(uiLocator(composer, 'chat.composer.action.pause')).toBeHidden()
        otherReplyId = await messageId(branchAnswer)
        await expect(dock).toBeVisible()
        await view.getByRole('button', { name: 'Resume auto-send', exact: true }).click()
      }
      await expect(uiLocator(composer, 'chat.composer.action.pause')).toBeHidden()

      // A queue must preserve the completed turns in the wire history and the active conversation.
      const history = messages.flatMap((content, index) => [
        { role: 'user', content },
        { role: 'assistant', content: answers[index] }
      ])
      for (const [index, request] of requests.entries()) {
        expect
          .soft(readMessages(request).filter((item) => item.role !== 'system'))
          .toEqual(history.slice(0, 3 + 2 * index))
      }
      await expect
        .poll(
          async () => {
            const response = await page.evaluate(
              (topicId) =>
                window.api.dataApi.request({
                  id: 'followup-active-branch',
                  method: 'GET',
                  path: '/topics/' + topicId + '/messages'
                }),
              fixture.topicId
            )
            const branch = response.data as BranchMessagesResponse | undefined
            return branch?.items.map(({ message }) => ({
              role: message.role,
              content: message.data.parts?.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
            }))
          },
          { message: 'each question and answer must be present exactly once in the active branch' }
        )
        .toEqual(history)

      const anchors = view.getByRole('navigation', { name: 'Conversation turns' })
      for (const [index, text] of messages.entries()) {
        if (!(await message(text).isVisible()) || !(await message(answers[index]).isVisible())) {
          await anchors.getByRole('button', { name: 'Jump to turn ' + (index + 1), exact: true }).click()
        }
        await expect(message(text)).toHaveCount(1)
        await expect(message(answers[index])).toHaveCount(1)
      }
      await expect(view.getByRole('button', { name: /^Queued \(/ })).toHaveCount(0)
      if (otherReplyId) {
        await expect(message(branchAnswer)).toHaveCount(0)
        await branchPanel.click()
        await page.getByRole('button', { name: 'Fit View', exact: true }).click()
        await flowNode(otherReplyId).click()
        await expect(message(branchAnswer)).toBeVisible()
        await expect(message(answers.at(-1)!)).toHaveCount(0)
      }
    } finally {
      await server.close()
    }
  })
}
