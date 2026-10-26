import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function htmlArtifactPreview(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const server = await startMockChatServer()
  const externalLoads: { userAgent: string; content: string; visibility: string }[] = []
  const evidenceServer = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/loaded') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      externalLoads.push(JSON.parse(Buffer.concat(chunks).toString()))
    }
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    response.end()
  })
  evidenceServer.listen(0, '127.0.0.1')
  await once(evidenceServer, 'listening')
  const address = evidenceServer.address()
  if (!address || typeof address === 'string') throw new Error('Evidence server did not bind')
  const title = 'MP41 Interactive HTML'
  const main =
    '<main><h1>MP41 Interactive HTML</h1><button id="increment">Count: 0</button><p id="status">Ready</p></main>'
  const html = `<!DOCTYPE html>
<html><head><title>${title}</title></head><body>${main}
<script>
let count = 0;
document.getElementById('increment').onclick = () => {
  document.getElementById('increment').textContent = 'Count: ' + (++count);
  document.getElementById('status').textContent = 'Button works';
  throw new Error('MP41_SCRIPT_ERROR');
};
window.addEventListener('pageshow', () => navigator.sendBeacon('http://127.0.0.1:${address.port}/loaded', JSON.stringify({
  userAgent: navigator.userAgent, content: document.querySelector('main').outerHTML, visibility: document.visibilityState
})));
</script></body></html>`
  const providerId = `regression-artifact-${Date.now()}`
  const topicName = app.resourceName('HTML artifact')
  const assistantName = app.resourceName('HTML artifact assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-41 HTML artifact mock',
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
          id: 'mp41-assistant',
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
          id: 'mp41-topic',
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
    await expect(chat).toBeVisible({ timeout: 30_000 })
    const assistantRow = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(assistantRow).toBeVisible({ timeout: 30_000 })
    await assistantRow.hover()
    const expandButton = assistantRow.getByRole('button', { name: 'Expand', exact: true })
    if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
    const topicRow = chat.getByTestId('topic-list-row').filter({ hasText: topicName })
    await expect(topicRow).toBeVisible({ timeout: 30_000 })
    await topicRow.click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const prompt = 'Generate a complete HTML page with a working counter button in an html code block.'
    // Only model output is mocked; preview, script execution and OS browser dispatch are real.
    await Promise.all([
      sendChatMarker(page, prompt, title),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(server.modelId)
        expect(request.body.messages).toContainEqual(expect.objectContaining({ role: 'user', content: prompt }))
        request.complete('```html\n' + html + '\n```')
      })()
    ])
    const artifact = page.getByTestId('html-artifact-view')
    await artifact.getByRole('button', { name: 'View webpage', exact: true }).click()
    const guest = artifact.getByTestId('interactive-html-webview')
    await expect(guest).toBeVisible()
    const readGuest = (code: string) =>
      guest.evaluate((element, code) => {
        const webview = element as unknown as { executeJavaScript(code: string): Promise<unknown> }
        return webview.executeJavaScript(code)
      }, code)
    await expect.poll(() => readGuest("document.querySelector('main')?.outerHTML")).toBe(main)
    const clickCounter = async (count: number) => {
      const rect = (await readGuest(`(() => {
        const rect = document.getElementById('increment').getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      })()`)) as { x: number; y: number }
      await page.bringToFront()
      // CDP mouse events on the host page do not enter Electron guest webContents.
      await guest.evaluate(async (element, point) => {
        const webview = element as unknown as { focus(): void; sendInputEvent(event: object): Promise<void> }
        webview.focus()
        await webview.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
        await webview.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      }, rect)
      await expect.poll(() => readGuest("document.getElementById('increment').textContent")).toBe(`Count: ${count}`)
      await expect.poll(() => readGuest("document.getElementById('status').textContent")).toBe('Button works')
    }
    await guest.evaluate((element) => {
      element.setAttribute('data-mp41-errors', '[]')
      element.addEventListener('console-message', (event) => {
        const message = (event as Event & { message: string }).message
        const errors = JSON.parse(element.getAttribute('data-mp41-errors')!) as string[]
        errors.push(message)
        element.setAttribute('data-mp41-errors', JSON.stringify(errors))
      })
    })
    await clickCounter(1)
    await expect.poll(() => guest.getAttribute('data-mp41-errors')).toContain('MP41_SCRIPT_ERROR')
    await testInfo.attach('MP-41 guest console error', {
      body: Buffer.from((await guest.getAttribute('data-mp41-errors'))!),
      contentType: 'application/json'
    })
    await attachScreenshot('MP-41 rendered preview and working button after script error')
    await artifact.hover()
    await artifact.getByRole('button', { name: 'Open in external browser', exact: true }).click()
    await expect
      .poll(() => externalLoads.filter(({ userAgent }) => !userAgent.includes('Electron/')), {
        timeout: 30_000,
        message: 'System browser must load the same HTML as a visible page'
      })
      .toContainEqual(expect.objectContaining({ content: main, visibility: 'visible' }))
    await testInfo.attach('MP-41 real external browser load', {
      body: Buffer.from(JSON.stringify(externalLoads.filter(({ userAgent }) => !userAgent.includes('Electron/')))),
      contentType: 'application/json'
    })
    await page.bringToFront()
    await artifact.hover()
    await artifact.getByRole('button', { name: 'Code', exact: true }).click()
    const sourceLines = artifact.locator('.line-content')
    await expect(sourceLines).toHaveCount(html.split('\n').length)
    expect((await sourceLines.allTextContents()).join('\n')).toBe(html)
    await attachScreenshot('MP-41 code view preserves generated HTML')
    await artifact.hover()
    await artifact.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(guest).toBeVisible()
    await expect.poll(() => readGuest("document.querySelector('h1')?.textContent")).toBe(title)
    await expect.poll(() => readGuest("document.getElementById('increment').textContent")).toBe('Count: 1')
    await clickCounter(2)
    await attachScreenshot('MP-41 preview restored without blank screen')
    await expect(chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()).toBeEditable()
  } finally {
    await server.close()
    evidenceServer.closeAllConnections()
    await new Promise<void>((resolve, reject) => evidenceServer.close((error) => (error ? reject(error) : resolve())))
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
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
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
