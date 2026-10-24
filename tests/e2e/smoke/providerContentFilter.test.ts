import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

import type { Locator } from '@playwright/test'

import enUS from '../../../src/renderer/i18n/locales/en-us.json'
import type { UnifiedPreferenceType } from '../../../src/shared/data/preference/preferenceTypes'
import type { Message } from '../../../src/shared/data/types/message'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test } from './fixtures/electron.fixture'

const contentMarker = 'ISSUE_22312_CONTENT_FILTER_PROBE'
const genericMarker = 'ISSUE_22312_GENERIC_400_PROBE'
const providerSentence = 'This request was blocked by our content filtering policy. Please revise your message.'
const providerMessage = `${providerSentence}\n(request id: 202610131228436002837148268d9d6lvrPR1di`

test.setTimeout(150_000)
// The spec saves its own trace on success and failure alongside the HTTP evidence.
test.use({ trace: 'off' })

test('provider content rejection diagnoses content while generic HTTP 400 retains settings recovery', async ({
  mainWindow: page
}, testInfo) => {
  const profile = process.env.CS_DEV_PROFILE_ROOT
  expect(profile, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  expect(path.isAbsolute(profile!), 'The isolated profile root must be absolute').toBe(true)
  const phase = process.env.ISSUE_22312_PHASE ?? 'run'
  const evidenceDir = process.env.ISSUE_22312_EVIDENCE_DIR
  if (evidenceDir && !path.isAbsolute(evidenceDir)) {
    throw new Error('ISSUE_22312_EVIDENCE_DIR must be an absolute path')
  }
  const publishArtifact = async (localPath: string, filename: string) => {
    if (!evidenceDir) return
    await mkdir(evidenceDir, { recursive: true })
    await copyFile(localPath, path.join(evidenceDir, filename))
  }
  const requests: Array<{
    method: string | undefined
    url: string | undefined
    model: unknown
    marker: string | null
    status: number
    body: unknown
  }> = []
  const observations: Array<{
    marker: string
    header: string | null
    description: string | null
    settingsButtonPresent: boolean
    savedError?: unknown
  }> = []
  const server = createServer(async (request, response) => {
    let model: unknown = null
    let marker: string | null = null
    let status = 200
    let body: unknown
    if (request.method === 'GET' && request.url === '/v1/models') {
      body = { object: 'list', data: [{ id: 'mock-chat', object: 'model', created: 0, owned_by: 'mock' }] }
    } else if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const input = JSON.parse(Buffer.concat(chunks).toString()) as { model?: unknown; messages?: unknown[] }
      model = input.model
      marker =
        [contentMarker, genericMarker].find((value) =>
          input.messages?.some((message) => JSON.stringify(message).includes(value))
        ) ?? null
      if (model === 'mock-chat' && marker) {
        status = 400
        body = {
          error: {
            message: marker === contentMarker ? providerMessage : 'Invalid input: temperature must be positive',
            type: 'invalid_request_error'
          }
        }
      } else {
        body = {
          id: 'background-completion',
          object: 'chat.completion',
          created: 0,
          model: 'mock-chat',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Background request complete' }, finish_reason: 'stop' }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }
      }
    } else {
      status = 404
      body = { error: { message: 'Unknown mock endpoint' } }
    }
    requests.push({ method: request.method, url: request.url, model, marker, status, body })
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  let previous:
    | {
        language: UnifiedPreferenceType['app.language']
        onboarding: UnifiedPreferenceType['app.onboarding.provider_setup.status']
        naming: boolean
        privacy: UnifiedPreferenceType['app.privacy.policy_version']
      }
    | undefined
  let activeBlock: Locator | undefined
  let activeName = 'content-filter'
  const captured = new Set<string>()
  const screenshot = async (name: string, block?: Locator) => {
    const filename = `${name}-${phase}.png`
    const output = testInfo.outputPath(filename)
    if (block && (await block.isVisible())) await block.screenshot({ path: output })
    else await page.screenshot({ path: output })
    await publishArtifact(output, filename)
    await testInfo.attach(filename, { path: output, contentType: 'image/png' })
    captured.add(name)
  }
  const saveEvidence = async () => {
    const filename = `content-filter-${phase}.json`
    const output = testInfo.outputPath(filename)
    await writeFile(output, JSON.stringify({ profile, requests, observations }, null, 2))
    await publishArtifact(output, filename)
    await testInfo.attach(filename, { path: output, contentType: 'application/json' })
  }
  let tracing = false
  try {
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    tracing = true
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock server did not bind a TCP port')
    previous = await page.evaluate(async () => ({
      language: await window.api.preference.get('app.language'),
      onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
      naming: await window.api.preference.get('topic.naming.enabled'),
      privacy: await window.api.preference.get('app.privacy.policy_version')
    }))
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
    const statuses = await page.evaluate(
      async ({ providerId, baseUrl }) => {
        const created = await window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
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
          body: [{ providerId, modelId: 'mock-chat', endpointTypes: ['openai-chat-completions'] }]
        })
        return [created.status, enabled.status, models.status]
      },
      { providerId, baseUrl: `http://127.0.0.1:${address.port}/v1` }
    )
    expect(statuses).toEqual([201, 200, 201])
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
    for (const [marker, artifact, expectedHeader, expectedSettings, expectedCategory] of [
      [contentMarker, 'content-filter', enUS['error.diagnosis.content'], false, 'content'],
      [genericMarker, 'generic-400', enUS['error.diagnosis.bad_request'], true, 'bad_request']
    ] as const) {
      activeName = artifact
      activeBlock = undefined
      await row.hover()
      await row.getByRole('button', { name: 'New Chat', exact: true }).click()
      await expect(view.locator('[data-ui~="chat.message"]:visible')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText('mock-chat')
      const composer = view.locator('[data-ui~="chat.composer"]:visible')
      await expect(composer).toHaveCount(1)
      const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
      await expect(editor).toBeEditable()
      await editor.fill(marker)
      const send = composer.getByRole('button', { name: 'Send', exact: true })
      await expect(send).toHaveAttribute('aria-disabled', 'false')
      await send.click()
      await expect
        .poll(() => requests.some((request) => request.marker === marker && request.status === 400))
        .toBe(true)
      const descriptionText =
        marker === contentMarker ? providerSentence : 'Invalid input: temperature must be positive'
      const message = view.locator('[data-ui~="chat.message"]').filter({ hasText: descriptionText }).last()
      await expect(message).toBeVisible({ timeout: 30_000 })
      // ErrorBlock has no semantic token; this border scopes the header separately from the description.
      const block = message.locator('.border-l-error-border')
      const description = block.locator(':scope > div').nth(1)
      activeBlock = block
      const header = block.locator(':scope > div').first()
      const settings = block.getByRole('button', { name: enUS['error.diagnosis.go_to_settings'], exact: true })
      const observation = {
        marker,
        header: await header.textContent(),
        description: await description.textContent(),
        settingsButtonPresent: (await settings.count()) > 0,
        savedError: undefined as unknown
      }
      observations.push(observation)
      await screenshot(artifact, block)
      await saveEvidence()
      await expect.soft(header).toBeVisible()
      await expect.soft(header).toHaveText(expectedHeader)
      if (marker === contentMarker) await expect.soft(header).not.toHaveText('Provider request failed (HTTP 400)')
      await expect.soft(description).toBeVisible()
      await expect.soft(description).toContainText(descriptionText)
      await expect.soft(settings).toHaveCount(expectedSettings ? 1 : 0)
      if (expectedSettings) await expect.soft(settings).toBeVisible()
      const messageId = await message.getAttribute('data-message-id')
      expect(messageId).toBeTruthy()
      await expect
        .poll(
          async () => {
            observation.savedError = await page.evaluate(async (id) => {
              const response = await window.api.dataApi.request({
                id: `read-${id}`,
                method: 'GET',
                path: `/messages/${id}`
              })
              const saved = response.data as Message | undefined
              return saved?.data.parts?.find((part) => part.type === 'data-error')?.data ?? null
            }, messageId!)
            return observation.savedError !== null
          },
          { timeout: 10_000 }
        )
        .toBe(true)
      expect.soft(observation.savedError).toMatchObject({
        providerErrorCategory: expectedCategory,
        statusCode: 400,
        ...(marker === contentMarker ? { executionFailure: { failure: { reasonCode: 'content_filter' } } } : {})
      })
      await screenshot(artifact, block)
      await saveEvidence()
    }
  } finally {
    try {
      if (!captured.has(activeName)) await screenshot(activeName, activeBlock)
    } finally {
      try {
        await saveEvidence()
        if (tracing) {
          const trace = testInfo.outputPath(`content-filter-${phase}.zip`)
          await page.context().tracing.stop({ path: trace })
          await publishArtifact(trace, `content-filter-${phase}.zip`)
          await testInfo.attach('trace', { path: trace, contentType: 'application/zip' })
        }
      } finally {
        try {
          if (previous)
            await page.evaluate(async (values) => {
              await window.api.preference.set('app.language', values.language)
              await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
              await window.api.preference.set('topic.naming.enabled', values.naming)
              await window.api.preference.set('app.privacy.policy_version', values.privacy)
            }, previous)
        } finally {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
            server.closeAllConnections()
          })
        }
      }
    }
  }
})
