import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import type { Locator } from '@playwright/test'
import sharp from 'sharp'

import type { Message } from '../../../src/shared/data/types/message'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { closeElectronApp, expect, launchSmokeElectron, test as base } from './fixtures/electron.fixture'

const suppliedProfile = process.env.CS_DEV_PROFILE_ROOT
const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    if (suppliedProfile && !path.isAbsolute(suppliedProfile)) throw new Error('CS_DEV_PROFILE_ROOT must be absolute')
    const profile = suppliedProfile
      ? await mkdtemp(path.join(suppliedProfile, 'issue-24821-'))
      : testInfo.outputPath('profile')
    const env = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }
    Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
    try {
      const app = await launchSmokeElectron({ args: ['.'], env, timeout: 60_000 })
      try {
        await use(app)
      } finally {
        try {
          await closeElectronApp(app)
        } catch (error) {
          if (testInfo.status === testInfo.expectedStatus) throw error
        }
      }
    } finally {
      try {
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch (error) {
        if (testInfo.status === testInfo.expectedStatus) throw error
      }
    }
  }
})

const sentence = 'Downloaded image content cannot exceed 30MB'
const limit = 30_000_000
const marker = 'ISSUE_24821_TEXT_OVERSIZE'
test.setTimeout(480_000)
test.use({ trace: 'off' })

test('older image replay fits the provider cap and the conversation continues', async ({
  electronApp,
  mainWindow: page
}, testInfo) => {
  const phase = process.env.ISSUE_24821_PHASE ?? 'after'
  if (phase !== 'before' && phase !== 'after') throw new Error(`Invalid ISSUE_24821_PHASE: ${phase}`)
  const evidenceDir = process.env.ISSUE_24821_EVIDENCE_DIR ?? testInfo.outputDir
  if (!path.isAbsolute(evidenceDir)) throw new Error('ISSUE_24821_EVIDENCE_DIR must be absolute')
  const publishArtifact = async (localPath: string, filename: string) => {
    await mkdir(evidenceDir, { recursive: true })
    const destination = path.join(evidenceDir, filename)
    if (localPath !== destination) await copyFile(localPath, destination)
  }
  const requests: Array<{
    status: number
    imageCount: number
    imageFileBytes: number
    imageDigests: string[]
    bodyBytes: number
    textOversize: boolean
  }> = []
  const textControls: Array<{ status: number; imageCount: number; bodyBytes: number }> = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks)
    const body = JSON.parse(raw.toString()) as { model: string; messages?: Array<{ content?: unknown }> }
    const urls = (body.messages ?? []).flatMap((m) =>
      Array.isArray(m.content)
        ? m.content.flatMap((part) =>
            part?.type === 'image_url' && typeof part.image_url?.url === 'string' ? [part.image_url.url] : []
          )
        : []
    )
    const images = urls.map((url) => Buffer.from(url.split(',')[1] ?? '', 'base64'))
    const imageFileBytes = images.reduce((sum, image) => sum + image.length, 0)
    const textOversize = raw.includes(marker) && urls.length === 0
    const status = imageFileBytes > limit || textOversize ? 413 : 200
    if (textOversize) textControls.push({ status, imageCount: urls.length, bodyBytes: raw.length })
    else {
      requests.push({
        status,
        imageCount: images.length,
        imageFileBytes,
        imageDigests: images.map((image) => createHash('sha256').update(image).digest('hex')),
        bodyBytes: raw.length,
        textOversize
      })
    }
    if (status === 413) {
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          error: { message: textOversize ? 'payload too large' : sentence, type: 'invalid_request_error' }
        })
      )
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [delta, finish_reason] of [
      [{ role: 'assistant', content: 'Fixture success' }, null],
      [{}, 'stop']
    ] as const) {
      response.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      )
    }
    response.end('data: [DONE]\n\n')
  })
  let tracing = false
  const screenshot = async (name: string) => {
    const file = testInfo.outputPath(`${name}-${phase}.png`)
    await page.screenshot({ path: file })
    await publishArtifact(file, path.basename(file))
    await testInfo.attach(name, { path: file, contentType: 'image/png' })
  }
  try {
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    tracing = true
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock server did not bind a TCP port')
    await page.evaluate(async (privacyVersion) => {
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'topic.naming.enabled': false,
        'app.privacy.policy_version': privacyVersion
      })
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    const later = page
      .getByRole('button', { name: /set up later|稍后设置/i })
      .filter({ visible: true })
      .first()
    const privacy = page.getByRole('button', { name: /accept and continue|同意并继续/i })
    const chatView = page.locator('[data-ui~="chat.view"]:visible')
    let lastOnboardingControl = 'none observed'
    for (let step = 0; step < 6; step++) {
      if (await chatView.isVisible()) break
      if (await privacy.isVisible()) {
        lastOnboardingControl = (await privacy.innerText()).trim()
        await privacy.click({ timeout: 5_000 })
      } else if (await later.isVisible()) {
        lastOnboardingControl = (await later.innerText()).trim()
        await later.click({ timeout: 5_000 })
      }
      if (await chatView.isVisible()) break
      await page.waitForTimeout(2_000)
    }
    if (!(await chatView.isVisible())) {
      const visibleControls = await page
        .getByRole('button')
        .or(page.getByRole('combobox'))
        .filter({ visible: true })
        .allTextContents()
      throw new Error(
        `Onboarding did not reach chat.view; visible controls: ${visibleControls.join(', ')}; last visible onboarding control: ${lastOnboardingControl}`
      )
    }
    const ensureChatView = async () => {
      const view = page.locator('[data-ui~="chat.view"]:visible')
      const chat = page.getByRole('button', { name: 'Chat', exact: true }).first()
      await expect(chat.or(privacy).filter({ visible: true }).first()).toBeVisible()
      if (await privacy.isVisible()) {
        await privacy.click()
        await expect(privacy).toBeHidden()
      }
      await chat.click()
      await expect(view).toBeVisible()
      return view
    }
    await ensureChatView()
    const suffix = `${Date.now()}`
    const providerId = `content-filter-${suffix}`
    const name = `Content filter diagnosis ${suffix}`
    const createProvider = async (providerId: string, presetProviderId?: string) =>
      page.evaluate(
        async ({ providerId, baseUrl, presetProviderId }) => {
          const created = await window.api.dataApi.request({
            id: `${providerId}-create`,
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              presetProviderId,
              name: 'Content filter mock',
              defaultChatEndpoint: 'openai-chat-completions',
              endpointConfigs: { 'openai-chat-completions': { baseUrl } },
              apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
            }
          })
          const enabled = await window.api.dataApi.request({
            id: `${providerId}-enable`,
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: { isEnabled: true }
          })
          const models = await window.api.dataApi.request({
            id: `${providerId}-model`,
            method: 'POST',
            path: '/models',
            body: [
              {
                providerId,
                modelId: 'mock-chat',
                endpointTypes: ['openai-chat-completions'],
                inputModalities: ['text', 'image']
              }
            ]
          })
          return [created.status, enabled.status, models.status]
        },
        { providerId, presetProviderId, baseUrl: `http://127.0.0.1:${address.port}/v1` }
      )
    expect(await createProvider(providerId)).toEqual([201, 200, 201])
    const routerId = `router-${suffix}`
    expect(await createProvider(routerId, 'openrouter')).toEqual([201, 200, 201])
    const router = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'router-read', method: 'GET', path: `/providers/${id}` }),
      routerId
    )
    expect(router.status).toBe(200)
    expect(
      (router.data as { endpointConfigs: Record<string, { adapterFamily: string }> }).endpointConfigs[
        'openai-chat-completions'
      ].adapterFamily
    ).toBe('openrouter')
    const routerName = `OpenRouter diagnosis ${suffix}`
    const routerAssistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({ id: name, method: 'POST', path: '/assistants', body: { name, modelId } }),
      { name: routerName, modelId: createUniqueModelId(routerId, 'mock-chat') }
    )
    expect(routerAssistant.status).toBe(201)
    const created = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: name,
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name, modelId: createUniqueModelId(providerId, 'mock-chat') }
    )
    expect(created.status).toBe(201)
    await page.reload()
    const view = await ensureChatView()
    const row = view.locator('[data-ui~="chat.group-header"]:visible').filter({ hasText: name }).first()
    await expect(row).toBeVisible()
    const composer = view.locator('[data-ui~="chat.composer"]:visible').first()
    const editor = composer.locator('[contenteditable="true"]').first()
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } })
      .jpeg()
      .toBuffer()
    const imagePaths: string[] = []
    const imageDigests: string[] = []
    for (let i = 0; i < 4; i++) {
      const file = testInfo.outputPath(`controlled-${i + 1}.jpg`)
      const image = Buffer.concat([jpeg, Buffer.alloc(8_000_000 - jpeg.length, i)])
      await writeFile(file, image)
      imagePaths.push(file)
      imageDigests.push(createHash('sha256').update(image).digest('hex'))
    }
    await row.hover()
    await row.getByRole('button', { name: 'New Chat', exact: true }).click()
    const send = async (text: string, attachments: string[] = []) => {
      await editor.fill(text)
      if (attachments.length) {
        await electronApp.evaluate(({ dialog }, filePaths) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
        }, attachments)
        const upload = composer.getByRole('button', { name: 'Upload attachment', exact: true })
        if (await upload.isVisible()) await upload.click()
        else {
          await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
          await page.getByRole('button', { name: /^Upload attachment\b/ }).click()
        }
        for (const file of attachments) {
          await expect(composer.getByText(path.basename(file), { exact: true })).toBeVisible()
        }
        if (phase === 'after') {
          await expect(composer.getByText(/Chat image budget: 30 MB per request/)).toBeVisible()
          if (attachments.length === imagePaths.length) {
            await expect(composer.getByText(/Your new images alone exceed it/)).toBeVisible()
          }
        }
      }
      await composer.getByRole('button', { name: 'Send', exact: true }).click()
    }
    const errors = view.locator('[data-ui~="chat.message"]').filter({ hasText: sentence })
    const reductionNotices = page.getByText(/^Images (?:re-encoded|omitted|adjusted) to fit request limit \(/)
    const expectedNotices: string[] = []
    const expectReducedRequest = async (received: (typeof requests)[number]) => {
      expect(received.status).toBe(200)
      expect(received.imageFileBytes).toBeLessThanOrEqual(limit)
      expect(received.imageDigests.slice(-3)).toEqual(imageDigests.slice(1))
      if (received.imageCount === 3) {
        expect(received.imageFileBytes).toBe(24_000_000)
        expectedNotices.push('Images omitted to fit request limit (1)')
      } else {
        expect(received.imageCount).toBe(4)
        expect(received.imageFileBytes).toBeGreaterThan(24_000_000)
        expectedNotices.push('Images re-encoded to fit request limit (1)')
      }
      await expect(reductionNotices).toHaveText(expectedNotices)
      await expect(reductionNotices.last()).toBeVisible()
    }
    for (let i = 1; i <= 4; i++) {
      const count = requests.length
      await send(`Image turn ${i}`, [imagePaths[i - 1]])
      await expect.poll(() => requests.length).toBeGreaterThan(count)
      const received = requests.at(-1)!
      if (i < 4 || phase === 'before') {
        expect(received.imageCount).toBe(i)
        expect(received.imageDigests).toEqual(imageDigests.slice(0, i))
        expect(received.imageFileBytes).toBe(i * 8_000_000)
        expect(received.bodyBytes).toBeGreaterThan(received.imageFileBytes)
        expect(received.status).toBe(i === 4 ? 413 : 200)
      } else {
        await expectReducedRequest(received)
      }
      if (i < 4 || phase === 'after') await expect(view.getByText('Fixture success').nth(i - 1)).toBeVisible()
      if (i === 3) await expect(reductionNotices).toHaveCount(0)
    }
    const historyErrorCount = phase === 'before' ? 2 : 0
    const attachmentDigest = async () => {
      const ids = await page
        .locator('[data-ui~="chat.message"]')
        .filter({ hasText: /Image turn [1-4]/ })
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-message-id')).filter((id): id is string => !!id))
      expect(ids).toHaveLength(4)
      const attachments = await page.evaluate(async (messageIds) => {
        const result: Array<{ id: string; size: number }> = []
        for (const id of messageIds) {
          const message = await window.api.dataApi.request({
            id: `attachment-message-${id}`,
            method: 'GET',
            path: `/messages/${id}`
          })
          if (message.status !== 200) throw new Error(`Message read failed: ${message.status}`)
          const parts = (message.data as Message).data.parts ?? []
          for (const part of parts) {
            if (part.type !== 'file') continue
            const fileId = (part.providerMetadata?.cherry as { fileEntryId?: string } | undefined)?.fileEntryId
            if (!fileId) throw new Error('Missing attachment identifier')
            const file = await window.api.dataApi.request({
              id: `attachment-file-${fileId}`,
              method: 'GET',
              path: `/files/entries/${fileId}`
            })
            if (file.status !== 200) throw new Error(`File read failed: ${file.status}`)
            result.push({ id: fileId, size: (file.data as { size: number }).size })
          }
        }
        return result
      }, ids)
      expect(attachments).toHaveLength(4)
      expect(attachments.every((a) => a.size === 8_000_000)).toBe(true)
      return createHash('sha256').update(JSON.stringify(attachments)).digest('hex')
    }
    const attachmentBefore = await attachmentDigest()
    const count = requests.length
    await send('Text-only follow-up')
    await expect.poll(() => requests.length).toBeGreaterThan(count)
    if (phase === 'after') {
      await expectReducedRequest(requests.at(-1)!)
      await expect(view.getByText('Fixture success').nth(4)).toBeVisible()
    } else {
      expect(requests.at(-1)).toMatchObject({ status: 413, imageCount: 4, imageFileBytes: 32_000_000 })
    }
    const attachmentAfter = await attachmentDigest()
    expect(attachmentAfter).toBe(attachmentBefore)
    await expect(errors).toHaveCount(historyErrorCount)
    await screenshot('history')
    const messageWith = (needle: string) => page.locator('[data-ui~="chat.message"]').filter({ hasText: needle }).last()
    const errorText = (message: Locator) => message.locator('.line-clamp-3').first()
    const headline = 'Request content too large, please reduce file or text size'
    const fragments = [
      'The provider rejected this request because of image size.',
      'Images from earlier turns may be included again.',
      'Start a new conversation, and use smaller images if you attach them again.'
    ]
    let savedError: unknown
    const scenarios: Record<string, unknown> = {
      history: { requests: requests.slice(), errors: await errors.allInnerTexts() }
    }
    const evidence = testInfo.outputPath(`image-payload-${phase}.json`)
    const writeEvidence = async () => {
      await writeFile(
        evidence,
        JSON.stringify(
          {
            policy: { maxDecodedImageFileBytes: limit, textOnlyRejectionMarker: marker },
            requests,
            textControls,
            scenarios,
            attachments: { beforeDigest: attachmentBefore, afterDigest: attachmentAfter },
            savedError
          },
          null,
          2
        )
      )
      await publishArtifact(evidence, path.basename(evidence))
    }
    const assertPhase = async (messages: typeof errors, count: number) => {
      for (let index = 0; index < count; index++) {
        const message = messages.nth(index)
        await expect(message.filter({ hasText: headline })).toBeVisible()
        for (const fragment of fragments) {
          if (phase === 'after') {
            const el = errorText(message).filter({ hasText: fragment })
            await expect(el).toBeVisible()
            expect(
              await el.evaluate((n) => {
                const container = n.closest('.line-clamp-3')
                return !!container && container.scrollHeight <= container.clientHeight + 4
              })
            ).toBe(true)
          } else await expect(message.filter({ hasText: fragment })).toHaveCount(0)
        }
      }
    }
    await writeEvidence()
    await page.reload()
    const reloadedErrors = page.locator('[data-ui~="chat.message"]').filter({ hasText: sentence })
    await expect(reloadedErrors).toHaveCount(historyErrorCount)
    if (phase === 'after') {
      await expect(reductionNotices).toHaveText(expectedNotices)
      await expect(messageWith('Fixture success')).toBeVisible()
    } else {
      await assertPhase(reloadedErrors, historyErrorCount)
    }
    await screenshot('reloaded')
    const runCurrentOnly = async (assistantName: string, key: string) => {
      const assistantRow = page
        .locator('[data-ui~="chat.group-header"]:visible')
        .filter({ hasText: assistantName })
        .first()
      await assistantRow.hover()
      await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
      const start = requests.length
      await send(`${key} current images`, imagePaths)
      await expect.poll(() => requests.length).toBeGreaterThan(start)
      expect(requests.at(-1)).toMatchObject({ status: 413, imageCount: 4, imageFileBytes: 32_000_000 })
      const currentErrors = page.locator('[data-ui~="chat.message"]').filter({ hasText: sentence })
      await expect(currentErrors).toHaveCount(1)
      scenarios[key] = { requests: requests.slice(start), errors: await currentErrors.allInnerTexts() }
      await assertPhase(currentErrors, 1)
      if (phase === 'after') {
        const messageId = await currentErrors.last().getAttribute('data-message-id')
        expect(messageId).toBeTruthy()
        await expect
          .poll(async () => {
            savedError = await page.evaluate(async (id) => {
              const response = await window.api.dataApi.request({
                id: `read-${id}`,
                method: 'GET',
                path: `/messages/${id}`
              })
              return (response.data as Message | undefined)?.data.parts?.find((part) => part.type === 'data-error')
                ?.data
            }, messageId!)
            return savedError
          })
          .toMatchObject({ detailI18nKey: 'image_payload_rejection_detail' })
      }
      await writeEvidence()
    }
    await runCurrentOnly(name, 'currentMessageOnly')
    await runCurrentOnly(routerName, 'openrouterCurrentMessageOnly')
    const refreshedRow = page.locator('[data-ui~="chat.group-header"]:visible').filter({ hasText: name }).first()
    await refreshedRow.hover()
    await refreshedRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await send(marker)
    await expect.poll(() => textControls.some((r) => r.status === 413 && r.imageCount === 0)).toBe(true)
    const textError = messageWith(headline)
    await expect(textError).toBeVisible()
    for (const fragment of fragments) await expect(textError.filter({ hasText: fragment })).toHaveCount(0)
    await refreshedRow.hover()
    await refreshedRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    const freshCount = requests.length
    await send('Fresh conversation')
    await expect.poll(() => requests.length).toBeGreaterThan(freshCount)
    expect(requests.at(-1)?.status).toBe(200)
    expect(requests.at(-1)?.imageCount).toBe(0)
    const freshReply = messageWith('Fixture success')
    await expect(freshReply).toBeVisible()
    for (const fragment of fragments) await expect(freshReply.filter({ hasText: fragment })).toHaveCount(0)
    for (const request of requests) {
      expect(request.status).toBe(request.imageFileBytes > limit ? 413 : 200)
    }
    for (const control of textControls) {
      expect(control).toMatchObject({ status: 413, imageCount: 0 })
    }
    expect(requests.some((r) => r.imageCount > 0 && r.imageFileBytes <= limit && r.status === 200)).toBe(true)
    expect(requests.some((r) => r.imageCount > 0 && r.imageFileBytes > limit && r.status === 413)).toBe(true)
    await screenshot('fresh-conversation')
    await writeEvidence()
    await testInfo.attach('evidence', { path: evidence, contentType: 'application/json' })
  } finally {
    if (tracing) {
      const trace = testInfo.outputPath(`image-payload-${phase}.zip`)
      try {
        await page.context().tracing.stop({ path: trace })
      } catch {
        // The context may already be closed; retain any trace that was written.
      }
      await publishArtifact(trace, path.basename(trace)).catch(() => {})
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }
})
