import { writeFile } from 'node:fs/promises'

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { setOwnedMainWindowFocus } from '../../../../scripts/e2e/regression/debugBridge'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { readTopicMessages, sendChatMarker } from '../helpers/chat'
import { selectVisibleModel } from '../helpers/models'
import { selectSidebarApp } from '../helpers/navigation'
import { revealVirtualized } from '../helpers/virtualList'
import type { RegressionApp } from '../RegressionApp'

export async function messageSelectionToolbar(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    layout: await window.api.preference.get('chat.message.multi_model.style')
  }))
  const server = await startMockChatServer()
  const providerId = `mp149-${Date.now()}`
  const topicName = app.resourceName('MP-149 selection')
  const assistantName = app.resourceName('MP-149 selection assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry',
        'chat.message.multi_model.style': 'vertical'
      })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-149 selection mock',
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
          body: [modelId, 'mock-grid'].map((id) => ({
            providerId,
            modelId: id,
            endpointTypes: ['openai-chat-completions']
          }))
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
    const topicId = TopicSchema.parse(topic.data).id

    await setOwnedMainWindowFocus(app.record, true)
    await page.bringToFront()
    await page.keyboard.press('Escape')
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const showSidebar = chat.getByRole('button', { name: 'Show Sidebar', exact: true })
    if (await showSidebar.isVisible()) await showSidebar.click()
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await revealVirtualized(page, chat.locator('[data-virtual-scrolling]').first(), group)
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const composer = chat.locator('[data-ui~="chat.composer"]')
    const editor = composer.locator('[contenteditable="true"]').first()
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    const excerpt = 'Orchid petals shine in morning sunlight.'
    const longAnswer = `${Array.from({ length: 24 }, (_, i) => `Garden observation ${i + 1}: the flowers remain bright.`).join('\n\n')}\n\n${excerpt}`
    // Mock only the HTTP model response; selections, clipboard, quotes and windows use the real app.
    for (const [prompt, answer] of [
      ['First garden description', 'The garden contains roses and orchids.'],
      ['Second garden description', longAnswer]
    ]) {
      await Promise.all([
        sendChatMarker(page, prompt, answer.split('\n').at(-1)!),
        server.nextRequest().then((request) => request.complete(answer))
      ])
    }
    await expect(editor).toHaveText('')
    const sourceId = await messages
      .filter({ has: page.locator('.message-assistant') })
      .last()
      .getAttribute('data-message-id')
    expect(sourceId).toBeTruthy()
    const source = chat.locator(`[data-ui~="chat.message"][data-message-id="${sourceId}"]`)
    const paragraph = source.getByText(excerpt, { exact: true })
    const toolbar = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Copy', exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Quote', exact: true }) })
    const selectedText = () => page.evaluate(() => window.getSelection()?.toString() ?? '')
    const textCoordinates = async (target: Locator, length: number) => {
      await target.evaluate((element) =>
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
      )
      await target.hover()
      return target.evaluate((element, length) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const node = walker.nextNode()
        if (!node || (node.textContent?.length ?? 0) < length) throw new Error('Selectable text node is missing')
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, length)
        const rects = Array.from(range.getClientRects())
        const first = rects[0]
        const last = rects.at(-1)!
        return {
          x: first.x + 0.5,
          y: first.y + first.height / 2,
          endX: last.right - 0.5,
          endY: last.y + last.height / 2,
          top: first.top
        }
      }, length)
    }
    let selectionAttempt = 0
    const selectReply = async (target = paragraph, text = excerpt) => {
      selectionAttempt += 1
      const point = await textCoordinates(target, text.length)
      await page.mouse.click(point.x, point.y)
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.move(point.endX, point.endY, { steps: 15 })
      await page.mouse.up()
      const inspectSelection = () =>
        target.evaluate(
          (element, point) => ({
            documentFocused: document.hasFocus(),
            activeTag: document.activeElement?.tagName,
            selection: window.getSelection()?.toString(),
            rect: element.getBoundingClientRect().toJSON(),
            startHitsTarget: element.contains(document.elementFromPoint(point.x, point.y)),
            endHitsTarget: element.contains(document.elementFromPoint(point.endX, point.endY))
          }),
          point
        )
      const beforeScreenshot = await inspectSelection()
      await attachScreenshot(`MP-149 selected reply ${selectionAttempt}`)
      await testInfo.attach(`MP-149 selection diagnostics ${selectionAttempt}`, {
        body: JSON.stringify({ point, beforeScreenshot, afterScreenshot: await inspectSelection() }),
        contentType: 'application/json'
      })
      await expect.poll(selectedText).toBe(text)
      return point
    }
    const copyAndPaste = async (action: Locator, text: string) => {
      await action.click()
      await expect(page.getByText('Copied!', { exact: true }).last()).toBeVisible()
      await editor.click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
      await expect(editor).toHaveText(text)
      await editor.fill('')
    }
    const quoteAndSend = async (action: Locator, text: string) => {
      await action.click()
      const quote = composer.locator('[data-composer-token-kind="quote"]')
      await expect(quote).toBeVisible()
      await quote.hover()
      await expect(page.getByRole('tooltip').filter({ hasText: text })).toBeVisible()
      const previous = (await readTopicMessages(page, topicId)).length
      await Promise.all([
        page.getByRole('button', { name: 'Send', exact: true }).click(),
        (async () => {
          const request = await server.nextRequest()
          const userInput = request.body.messages
            .filter((message) => (message as { role: string }).role === 'user')
            .at(-1)
          expect(JSON.stringify(userInput)).toContain(text)
          expect(JSON.stringify(userInput)).toContain('<blockquote>')
          request.complete('Quote received successfully.')
        })()
      ])
      await expect.poll(async () => (await readTopicMessages(page, topicId)).length).toBe(previous + 2)
      await expect.poll(async () => (await readTopicMessages(page, topicId)).at(-1)?.status).toBe('success')
      await expect(messages.last()).toContainText('Quote received successfully.')
      const sent = messages.filter({ has: page.locator('.message-user') }).last()
      const sentQuote = sent.locator('[data-composer-token-kind="quote"]')
      await expect(sentQuote).toBeVisible()
      await sentQuote.hover()
      await expect(page.getByRole('tooltip').filter({ hasText: text })).toBeVisible()
      await expect(messages.and(page.locator(`[data-message-id="${sourceId}"]`))).toContainText(excerpt)
      await expect(quote).toHaveCount(0)
      await attachScreenshot('MP-149 sent quote and original source')
    }

    const point = await selectReply()
    await attachScreenshot('MP-149 mouse selection before toolbar assertion')
    await expect(toolbar, 'Completed reply selection must show Copy and Quote floating actions').toBeVisible()
    const bounds = await toolbar.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(point.top + 2)
    expect(point.top - (bounds!.y + bounds!.height)).toBeLessThan(40)
    await copyAndPaste(toolbar.getByRole('button', { name: 'Copy', exact: true }), excerpt)
    await selectReply()
    await quoteAndSend(toolbar.getByRole('button', { name: 'Quote', exact: true }), excerpt)

    await editor.fill('Editable draft must not show message actions')
    await editor.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await expect.poll(selectedText).toBe('Editable draft must not show message actions')
    await expect(toolbar).toBeHidden()
    for (const reverse of [false, true]) {
      const messagePoint = await textCoordinates(paragraph, excerpt.length)
      const editorPoint = await textCoordinates(editor, 8)
      const [start, end] = reverse ? [editorPoint, messagePoint] : [messagePoint, editorPoint]
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(end.endX, end.endY, { steps: 20 })
      await page.mouse.up()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const selection = window.getSelection()
            return [selection?.anchorNode, selection?.focusNode].some((node) =>
              Boolean((node instanceof Element ? node : node?.parentElement)?.closest('[contenteditable="true"]'))
            )
          })
        )
        .toBe(true)
      await expect(toolbar).toBeHidden()
    }
    await editor.fill('')

    const caret = await textCoordinates(paragraph, 1)
    await page.mouse.click(caret.x - 30, caret.y)
    await page.mouse.move(caret.x, caret.y)
    await page.mouse.down()
    await page.mouse.move(caret.endX, caret.endY, { steps: 2 })
    await page.mouse.up()
    await expect.poll(selectedText).toBe(excerpt[0])
    await page.keyboard.down('Shift')
    for (let i = 1; i < excerpt.length; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Shift')
    await expect.poll(selectedText).toBe(excerpt)
    await testInfo.attach('MP-149 keyboard selection focus', {
      body: JSON.stringify(
        await page.evaluate(() => ({
          documentFocused: document.hasFocus(),
          activeTag: document.activeElement?.tagName,
          selection: window.getSelection()?.toString()
        }))
      ),
      contentType: 'application/json'
    })
    await expect(toolbar).toBeVisible()
    await paragraph.click({ button: 'right', position: { x: 20, y: 8 } })
    await copyAndPaste(page.getByRole('menuitem', { name: 'Copy', exact: true }), excerpt)
    await selectReply()
    await paragraph.click({ button: 'right', position: { x: 20, y: 8 } })
    await quoteAndSend(page.getByRole('menuitem', { name: 'Quote', exact: true }), excerpt)

    for (const dismiss of ['escape', 'outside', 'scroll', 'blur']) {
      await selectReply()
      await expect(toolbar).toBeVisible()
      if (dismiss === 'escape') await page.keyboard.press('Escape')
      if (dismiss === 'outside') await page.mouse.click(point.x - 30, point.y)
      if (dismiss === 'scroll') {
        const before = await paragraph.boundingBox()
        await paragraph.hover()
        await page.mouse.wheel(0, -300)
        await expect.poll(async () => (await paragraph.boundingBox())?.y).not.toBe(before?.y)
      }
      if (dismiss === 'blur') {
        const focusSession = await page.context().newCDPSession(page)
        try {
          await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false })
          await expect.poll(async () => (await setOwnedMainWindowFocus(app.record, false)).focused).toBe(false)
          await expect(toolbar).toBeHidden()
        } finally {
          await focusSession.detach()
          await setOwnedMainWindowFocus(app.record, true)
          await page.bringToFront()
        }
      }
      await expect(toolbar).toBeHidden()
    }
    await attachScreenshot('MP-149 no residual toolbar after dismissals')

    await page.evaluate(() => window.api.preference.set('chat.message.multi_model.style', 'grid'))
    await page.getByRole('button', { name: 'Selected models', exact: true }).click()
    await page.getByRole('switch', { name: 'Multi-select', exact: true }).click()
    await selectVisibleModel(page, 'mock-grid')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText('mock-grid')
    const beforeGrid = (await readTopicMessages(page, topicId)).length
    await Promise.all([
      sendChatMarker(page, 'Describe a grid garden', 'Grid orchid petals shine.'),
      (async () => {
        const requests = await Promise.all([server.nextRequest(), server.nextRequest()])
        expect(requests.map(({ body }) => body.model).sort()).toEqual(['mock-chat', 'mock-grid'])
        for (const request of requests) request.complete('Grid orchid petals shine.')
      })()
    ])
    await expect.poll(async () => (await readTopicMessages(page, topicId)).length).toBe(beforeGrid + 3)
    const gridText = messages
      .filter({ has: page.locator('.message-assistant') })
      .last()
      .getByText('Grid orchid petals shine.', { exact: true })
    await selectReply(gridText, 'Grid orchid petals shine.')
    await expect(toolbar).toBeVisible()
    await copyAndPaste(toolbar.getByRole('button', { name: 'Copy', exact: true }), 'Grid orchid petals shine.')
    await selectReply(gridText, 'Grid orchid petals shine.')
    await toolbar.getByRole('button', { name: 'Quote', exact: true }).click()
    await expect(composer.locator('[data-composer-token-kind="quote"]')).toBeVisible()
    await composer.locator('[data-composer-token-kind="quote"]').hover()
    await expect(page.getByRole('tooltip')).toContainText('Grid orchid petals shine.')
    await attachScreenshot('MP-149 grid reply selection quote')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode,
          'chat.message.multi_model.style': preferences.layout
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp149-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, providerId, preferences }
    )
  }
}
