import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { join } from 'node:path'

import sharp from 'sharp'

import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { validateFileEvidence } from '../../../scripts/e2e/regression/fileEvidence'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { saveNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { addCherryInModel, ensureCherryInSignedIn } from './cherryIn'
import { expect, test } from './fixture'
import { selectVisibleModel } from './models'
import { selectSidebarApp } from './navigation'
import { closeSettings } from './settings'

test(...caseDefinition('MP-90'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }

  await attachScreenshot('MP-90 image account preflight')
  // Real image provider: a canned enlarged response cannot prove enhancement quality.
  await ensureCherryInSignedIn(app, page)
  await addCherryInModel(page, app.config.cherryIn.imageModel, 'Image')
  await closeSettings(page)
  await selectSidebarApp(page, 'Paintings')
  const view = page.locator('[data-ui~="paintings.view"]:visible')
  await view.locator('[data-selector-shell-root="true"] > button').first().click()
  await selectVisibleModel(page, app.config.cherryIn.imageModel)
  await view
    .locator('[contenteditable="true"]')
    .fill(
      'A red cherry robot holding a blue umbrella on a white background. One robot, one umbrella, crisp illustration.'
    )
  await view.getByRole('button', { name: 'Send', exact: true }).click()
  const generation = page.getByRole('status', {
    name: /Drawing in progress\. Please do not leave this page\.|Revealing generated image/
  })
  await expect(generation).toBeVisible()
  await expect(generation).toBeHidden({ timeout: 180_000 })
  const image = view.getByTestId('artboard-image-transform')
  await expect(image).toBeVisible()
  const originalUrl = await image.getAttribute('src')
  expect(originalUrl).toBeTruthy()
  const readOriginal = () =>
    page.evaluate(async (url) => {
      const response = await fetch(url!)
      if (!response.ok) throw new Error(`Image read failed: ${response.status}`)
      return Array.from(new Uint8Array(await response.arrayBuffer()))
    }, originalUrl)
  const original = Buffer.from(await readOriginal())
  const originalHash = createHash('sha256').update(original).digest('hex')
  const originalSize = await sharp(original).metadata()

  await image.click()
  const preview = page.getByTestId('image-preview-dialog')
  await expect(preview).toBeVisible()
  const previewImage = preview.locator('img')
  await expect(previewImage).toBeVisible()
  const initialBox = await previewImage.boundingBox()
  expect(initialBox).not.toBeNull()
  for (let i = 0; i < 6; i++) await preview.getByRole('button', { name: 'Zoom In', exact: true }).click()
  await expect.poll(async () => (await previewImage.boundingBox())!.width).toBeGreaterThan(initialBox!.width)
  const zoomedBox = (await previewImage.boundingBox())!
  const viewportBox = (await preview.getByTestId('image-preview-viewport').boundingBox())!
  const center = { x: viewportBox.x + viewportBox.width / 2, y: viewportBox.y + viewportBox.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 60, center.y + 40, { steps: 12 })
  await page.mouse.up()
  await expect
    .poll(async () => {
      const box = (await previewImage.boundingBox())!
      return Math.hypot(box.x - zoomedBox.x, box.y - zoomedBox.y)
    })
    .toBeGreaterThan(10)
  await preview.getByRole('button', { name: 'Rotate Right', exact: true }).click()
  await expect
    .poll(() =>
      previewImage.evaluate((node) => {
        const matrix = new DOMMatrix(getComputedStyle(node).transform)
        return Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI)
      })
    )
    .toBe(90)
  await attachScreenshot('MP-90 enlarged dragged and rotated preview')
  await preview.getByRole('button', { name: 'Reset', exact: true }).click()
  await preview.getByRole('button', { name: 'Close', exact: true }).click()

  const upscale = view.getByRole('button', { name: /^(Upscale|Enhance|HD Enhancement|高清增强|放大)$/i })
  await expect(upscale, 'A generated image must expose its enhancement action').toBeVisible()
  await upscale.click()
  await expect(generation).toBeVisible()
  await expect(generation).toBeHidden({ timeout: 180_000 })
  await expect(image).not.toHaveAttribute('src', originalUrl!)
  const enhancedUrl = await image.getAttribute('src')
  const enhanced = Buffer.from(
    await page.evaluate(async (url) => {
      const response = await fetch(url!)
      if (!response.ok) throw new Error(`Enhanced image read failed: ${response.status}`)
      return Array.from(new Uint8Array(await response.arrayBuffer()))
    }, enhancedUrl)
  )
  const enhancedSize = await sharp(enhanced).metadata()
  expect(enhancedSize.width!).toBeGreaterThan(originalSize.width!)
  expect(enhancedSize.height!).toBeGreaterThan(originalSize.height!)
  const thumbnail = (buffer: Buffer) => sharp(buffer).resize(32, 32, { fit: 'fill' }).removeAlpha().raw().toBuffer()
  const [before, after] = await Promise.all([thumbnail(original), thumbnail(enhanced)])
  // Low-frequency similarity detects a replaced subject while allowing enhanced fine detail.
  const meanDifference = before.reduce((sum, value, index) => sum + Math.abs(value - after[index]), 0) / before.length
  expect(meanDifference, 'Enhancement must preserve the original subject and composition').toBeLessThan(25)
  expect(
    createHash('sha256')
      .update(Buffer.from(await readOriginal()))
      .digest('hex')
  ).toBe(originalHash)

  await image.click()
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Save As', exact: true }).click()
  const output = join(app.paths.evidence, 'downloads', 'MP-90-enhanced.png')
  saveNativeFile(app.record.platform, app.paths, output)
  await expect
    .poll(async () =>
      validateFileEvidence(output, { type: 'image' })
        .then(() => true)
        .catch(() => false)
    )
    .toBe(true)
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  const saved = await readFile(output)
  const savedSize = await sharp(saved).metadata()
  expect(savedSize.width).toBe(enhancedSize.width)
  expect(savedSize.height).toBe(enhancedSize.height)
  expect(await sharp(saved).raw().toBuffer()).toEqual(await sharp(enhanced).raw().toBuffer())
  if (app.record.platform === 'macos') {
    execFileSync('open', ['-a', 'Preview', output], { timeout: 10_000 })
    await expect
      .poll(() =>
        execFileSync('osascript', ['-e', 'tell application "Preview" to get name of every document'], {
          encoding: 'utf8',
          timeout: 10_000
        })
      )
      .toContain('MP-90-enhanced.png')
  } else {
    throw new Error('UNCOVERED: saved-image viewer verification is unavailable on this platform')
  }
  await attachScreenshot('MP-90 enhanced image saved without overwriting original')
})

test(...caseDefinition('MP-91'), async ({ mainWindow: page }, testInfo) => {
  // HTTP fixtures verify application requests and recovery, not image-model quality.
  const original = 'A fashion portrait of a person in a monochrome suit, studio lighting.'
  const expanded = `${original} Full-length editorial photograph, soft directional light, fine fabric detail, neutral backdrop.`
  const image = await readFile('resources/data/painting-templates/images/monochrome-suit.webp')
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  let failEnhancement = false
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
    await selectVisibleModel(page, modelId)
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

test(...caseDefinition('MP-92'), async ({ mainWindow: page }, testInfo) => {
  // Mock only the provider HTTP boundary; exercise real UI, IPC, storage, and image decoding.
  const keys = { invalid: 'sk-mp92-invalid-secret', empty: 'sk-mp92-empty-secret', valid: 'sk-mp92-valid-secret' }
  const providers = [`mp92-invalid-${Date.now()}`, `mp92-empty-${Date.now()}`]
  const requests: { authorization: string; body: { model?: string; prompt?: string }; response: ServerResponse }[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/images/generations') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({
      authorization: request.headers.authorization ?? '',
      body: JSON.parse(Buffer.concat(chunks).toString()),
      response
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Image mock did not bind a TCP port')
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  const modelId = 'dall-e-3'
  const prompt = 'MP-92: a red cherry on a white background'
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, [...getSensitiveConfigValues(), ...Object.values(keys)]))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const selectModel = async (providerId: string) => {
    await page.locator('[data-selector-shell-root="true"] > button').first().click()
    const selector = page.getByTestId('model-selector-content').last()
    await expect(selector).toBeVisible()
    await selector.getByTestId('model-selector-search').fill(modelId)
    await selector.getByTestId(`model-selector-item-${providerId}::${modelId}`).click()
  }
  const generating = page.getByRole('status', {
    name: /Drawing in progress\. Please do not leave this page\.|Revealing generated image/
  })
  const send = page.getByRole('button', { name: 'Send', exact: true })
  const submit = async (key: string) => {
    await page.locator('[contenteditable="true"]').fill(prompt)
    const count = requests.length
    await send.click()
    await expect(generating).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => requests.length, { timeout: 15_000 }).toBe(count + 1)
    const request = requests[count]
    expect(request.authorization === `Bearer ${key}`, 'Configured provider credential reaches HTTP boundary').toBe(true)
    expect(request.body.model).toBe(modelId)
    expect(request.body.prompt).toBe(prompt)
    return request.response
  }

  try {
    for (const [index, providerId] of providers.entries()) {
      const created = await page.evaluate(
        ({ providerId, baseUrl, key, index }) =>
          window.api.dataApi.request({
            id: 'mp92-provider-create',
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: `MP-92 HTTP fixture ${index}`,
              presetProviderId: 'openai',
              endpointConfigs: { 'openai-image-generation': { baseUrl } },
              apiKeys: [{ id: 'mp92-key', key, isEnabled: true }]
            }
          }),
        { providerId, baseUrl, key: index === 0 ? keys.invalid : keys.empty, index }
      )
      expect(created.status).toBe(201)
      const enabled = await page.evaluate(
        (providerId) =>
          window.api.dataApi.request({
            id: 'mp92-enable',
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: { isEnabled: true }
          }),
        providerId
      )
      expect(enabled.status).toBe(200)
      const model = await page.evaluate(
        ({ providerId, modelId }) =>
          window.api.dataApi.request({
            id: 'mp92-model',
            method: 'POST',
            path: '/models',
            body: [
              { providerId, modelId, endpointTypes: ['openai-image-generation'], capabilities: ['image-generation'] }
            ]
          }),
        { providerId, modelId }
      )
      expect(model.status).toBe(201)
    }
    await page.reload()
    await selectSidebarApp(page, 'Paintings')

    for (const [index, scenario] of [
      {
        key: keys.invalid,
        status: 401,
        code: 'invalid_api_key',
        message: `Incorrect API key provided: ${keys.invalid}`,
        expected: /Please check the validity of the token/i
      },
      {
        key: keys.empty,
        status: 403,
        code: 'insufficient_quota',
        message: 'Insufficient quota: account balance is exhausted',
        expected: /quota|balance|credit|billing/i
      }
    ].entries()) {
      await selectModel(providers[index])
      const response = await submit(scenario.key)
      response.writeHead(scenario.status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: scenario.message, type: scenario.code, code: scenario.code } }))
      const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(dialog, 'Provider failure is shown to the user').toBeVisible({ timeout: 15_000 })
      await expect
        .soft(dialog, index === 0 ? 'Invalid token needs actionable token guidance' : 'No balance needs quota guidance')
        .toContainText(scenario.expected, { timeout: 1_000 })
      const errorText = await dialog.innerText()
      for (const key of Object.values(keys)) {
        expect.soft(errorText.includes(key), 'Error text must not expose provider credentials').toBe(false)
      }
      await expect(generating, 'Failure must leave generating state promptly').toBeHidden({ timeout: 15_000 })
      await screenshot(index === 0 ? 'MP-92 invalid token error' : 'MP-92 quota error')
      await dialog.getByRole('button', { name: /OK|Confirm|Close/i }).click()
      await expect(dialog).toBeHidden()
      await expect(send).toBeEnabled()
      await expect(page.getByTestId('artboard-image-transform')).toHaveCount(0)
    }

    const restored = await page.evaluate(
      ({ providerId, key }) =>
        window.api.dataApi.request({
          id: 'mp92-restore-key',
          method: 'PUT',
          path: `/providers/${providerId}/api-keys`,
          body: { keys: [{ id: 'mp92-key', key, isEnabled: true }] }
        }),
      { providerId: providers[0], key: keys.valid }
    )
    expect(restored.status).toBe(200)
    await selectModel(providers[0])
    const response = await submit(keys.valid)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [
          {
            b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
          }
        ]
      })
    )
    await expect(generating).toBeHidden({ timeout: 30_000 })
    const image = page.getByTestId('artboard-image-transform').last()
    await expect(image).toBeVisible()
    await expect
      .poll(() =>
        image.evaluate((element) => {
          const image = element as HTMLImageElement
          return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
        })
      )
      .toBe(true)
    const paintings = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp92-receipt',
          method: 'GET',
          path: '/paintings',
          params: { providerId }
        }),
      providers[0]
    )
    expect(paintings.status).toBe(200)
    expect(paintings.data).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          prompt,
          files: expect.objectContaining({ output: expect.arrayContaining([expect.any(String)]) })
        })
      ])
    })
    await page.getByTestId('painting-prompt-dock-collapsed').getByRole('button').click()
    await expect(send).toBeEnabled()
    await screenshot('MP-92 recovered generation')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    await page.evaluate(async (providers) => {
      for (const providerId of providers) {
        const response = await window.api.dataApi.request({
          id: 'mp92-cleanup-read',
          method: 'GET',
          path: '/paintings',
          params: { providerId }
        })
        const data = response.data as { items?: { id: string }[] } | undefined
        for (const painting of data?.items ?? []) {
          await window.api.dataApi.request({ id: 'mp92-trash', method: 'DELETE', path: `/paintings/${painting.id}` })
          await window.api.dataApi.request({
            id: 'mp92-delete',
            method: 'DELETE',
            path: `/paintings/${painting.id}`,
            params: { permanent: true }
          })
        }
        await window.api.dataApi.request({
          id: 'mp92-provider-delete',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      }
    }, providers)
  }
})
