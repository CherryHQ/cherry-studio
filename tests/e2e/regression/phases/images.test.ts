import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import { selectVisibleModel } from '../helpers/models'
import { selectSidebarApp } from '../helpers/navigation'

test(...caseDefinition('MP-91'), async ({ mainWindow: page }, testInfo) => {
  // HTTP fixtures verify application requests and recovery, not image-model quality.
  const original = 'A fashion portrait of a person in a monochrome suit, studio lighting.'
  const expanded = `${original} Full-length editorial photograph, soft directional light, fine fabric detail, neutral backdrop.`
  const image = await readFile('resources/data/painting-templates/images/monochrome-suit.webp')
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  let failEnhancement = false
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat enhancement and image generation responses; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
    requests.push({ path: req.url ?? '', body })
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/v1/chat/completions') {
      if (failEnhancement) {
        res.writeHead(422).end(JSON.stringify({ error: { message: 'MP91 prompt enhancement unavailable' } }))
      } else {
        res.end(
          JSON.stringify({
            id: 'mp91-enhancement',
            object: 'chat.completion',
            created: 1,
            model: body.model,
            choices: [{ index: 0, message: { role: 'assistant', content: expanded }, finish_reason: 'stop' }]
          })
        )
      }
    } else if (req.url === '/v1/images/generations') {
      if (failEnhancement && body.prompt_enhancement === true) {
        res.writeHead(422).end(JSON.stringify({ error: { message: 'MP91 prompt enhancement unavailable' } }))
      } else {
        res.end(JSON.stringify({ images: [{ b64_json: image.toString('base64') }], revised_prompt: expanded }))
      }
    } else {
      res.writeHead(404).end(JSON.stringify({ error: { message: 'Unexpected MP91 endpoint' } }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('MP91 HTTP fixture has no port')
  const providerId = `regression-mp91-${Date.now()}`
  const modelId = 'Kwai-Kolors/Kolors'
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const imageRequests = () => requests.filter(({ path }) => path === '/v1/images/generations')
  try {
    const responses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp91-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            presetProviderId: 'silicon',
            name: 'MP91 loopback image fixture',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp91-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp91-models',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId,
              presetModelId: 'kolors',
              capabilities: ['image-generation'],
              inputModalities: ['text'],
              outputModalities: ['image']
            },
            { providerId, modelId: 'mp91-text', endpointTypes: ['openai-chat-completions'] }
          ]
        })
        return [provider, enabled, models].map(({ status }) => status)
      },
      { providerId, baseUrl: `http://127.0.0.1:${address.port}/v1`, modelId }
    )
    expect(responses).toEqual([201, 200, 201])
    await page.reload()
    await selectSidebarApp(page, 'Paintings')
    const view = page.locator('[data-ui~="paintings.view"]:visible')
    await expect(view).toBeVisible()
    await view.getByRole('button', { name: 'New Image', exact: true }).click()
    const templates = view.getByRole('group', { name: 'Prompt templates', exact: true })
    const template = templates.getByRole('button').first()
    await expect(template).toBeVisible()
    await template.click()
    const editor = view.locator('[contenteditable="true"]').first()
    await expect(editor).toBeEditable()
    await expect(editor).not.toHaveText('')
    await expect(template).toHaveAttribute('aria-pressed', 'true')
    await screenshot('MP-91 template inserted and editable')
    await editor.fill(original)
    await expect(editor).toHaveText(original)
    await view.locator('[data-selector-shell-root="true"] > button').first().click()
    await selectVisibleModel(page, modelId, providerId)
    await view.getByRole('button', { name: /^Settings(:|$)/ }).click()
    const panel = page.locator('[data-slot="popover-content"]:visible')
    const enhancement = panel
      .locator('div')
      .filter({ has: page.getByText('Prompt Enhancement', { exact: true }) })
      .filter({ has: page.getByRole('switch') })
      .last()
      .getByRole('switch')
    await expect(enhancement).toBeVisible()
    await enhancement.setChecked(false)
    await page.keyboard.press('Escape')
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => imageRequests().length).toBe(1)
    expect(imageRequests()[0].body.prompt).toBe(original)
    expect(imageRequests()[0].body.prompt_enhancement).not.toBe(true)
    const result = view.getByTestId('artboard-image-transform').last()
    await expect(result).toBeVisible({ timeout: 60_000 })
    await screenshot('MP-91 manual prompt generated image through HTTP fixture')
    await view.getByRole('button', { name: 'Expand prompt', exact: true }).click()
    await view.getByRole('button', { name: /^Settings(:|$)/ }).click()
    await enhancement.setChecked(true)
    await page.keyboard.press('Escape')
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => imageRequests().length).toBe(2)
    await expect(result).toBeVisible({ timeout: 60_000 })
    await testInfo.attach('MP-91 provider request details (loopback fixture)', {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json'
    })
    // SiliconFlow enhances server-side: the app forwards the prompt as typed and flags
    // the request, so the provider (not the client) produces the expanded wording.
    expect.soft(imageRequests()[1].body.prompt, 'Server-side enhancement receives the prompt as typed').toBe(original)
    expect
      .soft(imageRequests()[1].body.prompt_enhancement, 'Enhancement must be requested from the provider')
      .toBe(true)
    await screenshot('MP-91 enhancement result and prompt')
    await expect.soft(view.getByTestId('artboard-prompt-bar-measure')).toContainText(original, { timeout: 2_000 })

    failEnhancement = true
    await view.getByRole('button', { name: 'Expand prompt', exact: true }).click()
    await editor.fill(original)
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => imageRequests().length).toBeGreaterThanOrEqual(3)
    expect(imageRequests()[2].body.prompt, 'A rejected enhancement still sends the typed prompt').toBe(original)
    expect(imageRequests()[2].body.prompt_enhancement).toBe(true)
    await expect
      .soft(page.getByText(/MP91 prompt enhancement unavailable/).first(), 'A rejected enhancement must be reported')
      .toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    failEnhancement = false
    // Recovery: with enhancement off the same prompt goes out without the flag and renders.
    await view.getByRole('button', { name: /^Settings(:|$)/ }).click()
    await enhancement.setChecked(false)
    await page.keyboard.press('Escape')
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => imageRequests().length).toBeGreaterThanOrEqual(4)
    expect(imageRequests()[3].body.prompt).toBe(original)
    expect(imageRequests()[3].body.prompt_enhancement).not.toBe(true)
    await expect(result).toBeVisible({ timeout: 60_000 })
    await screenshot('MP-91 recovery after a rejected enhancement')
    await testInfo.attach('MP-91 failure request details (loopback fixture)', {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json'
    })
  } finally {
    await page.evaluate(async (providerId) => {
      await window.api.dataApi.request({ id: 'mp91-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
    }, providerId)
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }
})
