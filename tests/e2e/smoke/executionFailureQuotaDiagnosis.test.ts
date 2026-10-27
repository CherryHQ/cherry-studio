import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

import { _electron as electron, type Page } from '@playwright/test'

import type { AgentSessionMessageEntity } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import type { CursorPaginationResponse } from '../../../src/shared/data/api/types'
import { expect, test as base } from './fixtures/electron.fixture'

const PROVIDER_ID = 'quota402probe'
const MODEL_ID = 'quota-402-probe-model'
const AGENT_NAME = 'Quota 402 Probe Agent'
const SESSION_NAME = 'Quota 402 Probe Session'
const QUOTA_HEADING = 'Account quota exhausted, please recharge or switch provider'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    try {
      const app = await electron.launch({
        args: ['.'],
        env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot },
        timeout: 120_000
      })
      try {
        await use(app)
      } finally {
        await app.close()
      }
    } finally {
      rmSync(profileRoot, { recursive: true, force: true, maxRetries: 3 })
    }
  }
})

test.setTimeout(300_000)

async function openSession(page: Page): Promise<void> {
  await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 120_000 })
  const work = page.getByRole('button', { name: 'Work', exact: true }).first()
  if (await work.isVisible()) await work.click()
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  await expect(view).toBeVisible({ timeout: 60_000 })
  const header = view.getByText(AGENT_NAME, { exact: true }).first()
  await header.click()
  const session = view.getByText(SESSION_NAME, { exact: true }).first()
  if (!(await session.isVisible())) {
    await header.hover()
    await view
      .getByRole('button', { name: AGENT_NAME, exact: true })
      .first()
      .locator('..')
      .getByRole('button', { name: 'Expand', exact: true })
      .click()
  }
  await session.click()
  await expect(page.locator('[data-ui~="chat.composer"]:visible').first()).toBeVisible({ timeout: 60_000 })
}

// Protect the Work/Pi HTTP failure → live diagnosis → persisted diagnosis boundary for Issue #22683.
test('Work/Pi diagnoses an empty HTTP 402 as quota before and after reload', async ({ mainWindow: page }, testInfo) => {
  const generationRequests: Array<{
    method: string
    url: string
    requestBodyBytes: number
    statusCode: number
    responseBodyBytes: number
  }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        response.on('finish', () => {
          generationRequests.push({
            method: request.method ?? '',
            url: request.url ?? '',
            requestBodyBytes: Buffer.concat(chunks).length,
            statusCode: response.statusCode,
            responseBodyBytes: 0
          })
        })
      }
      // No SSE headers or response writes: end() sends zero body bytes.
      response.writeHead(402)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP address')

  try {
    const privacyVersion = readFileSync(path.resolve('src/shared/utils/constants.ts'), 'utf8').match(
      /LATEST_PRIVACY_POLICY_VERSION\s*=\s*'([^']+)'/
    )?.[1]
    if (!privacyVersion) throw new Error('Could not read LATEST_PRIVACY_POLICY_VERSION')
    await page.evaluate(async (privacy) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.privacy.policy_version', privacy)
      await window.api.preference.set('topic.naming.enabled', false)
    }, privacyVersion)
    await page.reload()
    await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 120_000 })

    const seeded = await page.evaluate(
      async ({ providerId, modelId, baseUrl }) => {
        const created = await window.api.dataApi.request({
          id: 'quota-provider-create',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Quota 402 Probe',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'probe-key', key: 'probe-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'quota-provider-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'quota-model-create',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        const listed = await window.api.dataApi.request({
          id: 'quota-model-read',
          method: 'GET',
          path: '/models',
          params: { providerId }
        })
        return [created.status, enabled.status, models.status, listed.status]
      },
      { providerId: PROVIDER_ID, modelId: MODEL_ID, baseUrl: `http://127.0.0.1:${address.port}/v1` }
    )
    expect(seeded.every((status) => status >= 200 && status < 300)).toBe(true)

    const agent = await page.evaluate(
      async ({ name, model }) =>
        window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name,
          model,
          instructions: 'Answer briefly. Do not use tools.'
        }),
      { name: AGENT_NAME, model: `${PROVIDER_ID}::${MODEL_ID}` }
    )
    const agentId = (agent as { data?: { id?: string } }).data?.id
    if (!agentId) throw new Error('ai.agent.create returned no agent id')
    const session = await page.evaluate(
      async ({ agentId, name }) =>
        window.api.dataApi.request({
          id: 'quota-session-create',
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId, name: SESSION_NAME }
    )
    const sessionId = (session.data as { id?: string } | undefined)?.id
    if (!sessionId) throw new Error('POST /agent-sessions returned no session id')

    await page.reload()
    await openSession(page)
    const composer = page.locator('[data-ui~="chat.composer"]:visible').first()
    const editor = composer.locator('[contenteditable="true"]').first()
    await editor.click()
    await editor.fill('Reply with exactly PROBE_OK and nothing else.')
    await composer.getByRole('button', { name: 'Send', exact: true }).click()

    const block = page.locator('.border-l-error-border').first()
    for (const stage of ['live', 'reopened']) {
      if (stage === 'reopened') {
        await page.reload()
        await openSession(page)
      }
      try {
        await expect(block).toBeVisible({ timeout: 120_000 })
      } finally {
        const screenshot = testInfo.outputPath(`${stage}.png`)
        await page.screenshot({ path: screenshot })
        await testInfo.attach(stage, { path: screenshot, contentType: 'image/png' })
      }
      const blockScreenshot = testInfo.outputPath(`${stage}-error-block.png`)
      await block.screenshot({ path: blockScreenshot })
      await testInfo.attach(`${stage}-error-block`, { path: blockScreenshot, contentType: 'image/png' })
      await expect.soft(block.getByText(QUOTA_HEADING, { exact: true })).toBeVisible({ timeout: 30_000 })
      const lines = (await block.innerText())
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      expect.soft(lines[0]).toBe(QUOTA_HEADING)
      expect.soft(lines[1]).toBe('402 status code (no body)')
      await expect.soft(block.getByText('An error occurred', { exact: true })).toHaveCount(0)
      await expect
        .soft(block.getByRole('button', { name: 'Go to Settings', exact: true }))
        .toBeVisible({ timeout: 30_000 })

      if (stage === 'live') {
        expect.soft(generationRequests.length).toBeGreaterThan(0)
        expect.soft(generationRequests.at(-1)).toMatchObject({ statusCode: 402, responseBodyBytes: 0 })
        const persisted = await page.evaluate(
          async (id) =>
            window.api.dataApi.request({
              id: 'quota-session-messages',
              method: 'GET',
              path: `/agent-sessions/${id}/messages`
            }),
          sessionId
        )
        const persistedPath = testInfo.outputPath('persisted-messages.json')
        writeFileSync(persistedPath, JSON.stringify(persisted, null, 2))
        await testInfo.attach('persisted-messages', { path: persistedPath, contentType: 'application/json' })
        const messages = persisted.data as CursorPaginationResponse<AgentSessionMessageEntity> | undefined
        const assistant = messages?.items.find((message) => message.role === 'assistant')
        const errorPart = assistant?.data.parts?.find((part) => part.type === 'data-error')
        expect.soft(errorPart).toMatchObject({
          type: 'data-error',
          data: { executionFailure: { failure: { reasonCode: 'quota', context: { statusCode: 402 } } } }
        })
      }
    }
  } finally {
    const requestsPath = testInfo.outputPath('generation-requests.json')
    writeFileSync(requestsPath, JSON.stringify(generationRequests, null, 2))
    await testInfo.attach('generation-requests', { path: requestsPath, contentType: 'application/json' })
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
      server.closeAllConnections()
    })
  }
})
