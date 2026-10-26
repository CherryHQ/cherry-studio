import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { evaluateCdpExpression } from '../../../../scripts/e2e/regression/cdpClient'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { findListeningPid, MAIN_INSPECTOR_PORT } from '../../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

// Real HTTP faults exercise the production transport/classifier; no production account is charged.
export async function errorRecovery(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const validKey = 'mp17-valid-loopback-key'
  const invalidKey = 'mp17-invalid-loopback-key'
  const providerId = `regression-recovery-${Date.now()}`
  const providerName = app.resourceName('Recovery mock')
  const assistantName = app.resourceName('Recovery assistant')
  const authError = 'Incorrect API key provided. MP17_AUTH_DETAIL.'
  const contextError = 'maximum context length exceeded: MP17_CONTEXT_DETAIL'
  const upstream = await startMockChatServer()
  let fault: 'none' | 'quota' | 'model' | 'rate' = 'none'
  const requests: { authorization?: string; body: { messages?: unknown[]; model?: string } }[] = []
  const gateway = createServer((req, res) => {
    void (async () => {
      if (req.url === '/mcp') {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'MP17 MCP server is offline' }))
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks)
      const body = raw.length ? JSON.parse(raw.toString()) : {}
      if (req.method === 'POST') requests.push({ authorization: req.headers.authorization, body })
      const failure =
        req.headers.authorization !== `Bearer ${validKey}`
          ? { status: 401, message: authError, code: 'invalid_api_key' }
          : raw.length > 30_000
            ? { status: 400, message: contextError, code: 'context_length_exceeded' }
            : fault === 'quota'
              ? { status: 402, message: 'Insufficient quota: MP17_BILLING_DETAIL', code: 'insufficient_quota' }
              : fault === 'model'
                ? { status: 404, message: 'The model does not exist: MP17_MODEL_DETAIL', code: 'model_not_found' }
                : fault === 'rate'
                  ? { status: 429, message: 'Rate limit exceeded: MP17_RETRY_DETAIL', code: 'rate_limit_exceeded' }
                  : undefined
      if (failure) {
        res.writeHead(failure.status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: failure.message, type: failure.code, code: failure.code } }))
        return
      }
      const response = await fetch(`${upstream.baseUrl}${req.url?.replace(/^\/v1/, '')}`, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${validKey}` },
        body: raw.length ? raw : undefined
      })
      res.writeHead(response.status, { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' })
      if (response.body) for await (const chunk of response.body) res.write(chunk)
      res.end()
    })().catch(() => {
      res.writeHead(500)
      res.end('MP17 fixture transport failed')
    })
  })
  gateway.listen(0, '127.0.0.1')
  await once(gateway, 'listening')
  const address = gateway.address()
  if (!address || typeof address === 'string') throw new Error('MP17 HTTP fixture did not bind')
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  const namingEnabled = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  let assistantId: string | undefined
  let mcpId: string | undefined
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, [...getSensitiveConfigValues(), validKey, invalidKey]))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const setKey = async (key: string) => {
    const result = await page.evaluate(
      ({ providerId, key }) =>
        window.api.dataApi.request({
          id: 'mp17-key',
          method: 'PATCH',
          path: `/providers/${providerId}/api-keys/mp17-key`,
          body: { key }
        }),
      { providerId, key }
    )
    expect(result.status).toBe(200)
  }
  const send = async (prompt: string) => {
    await page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill(prompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
  }
  const message = () => page.locator('[data-ui~="chat.message"][data-message-id]:visible').last()
  const expectError = async (detail: string, action: string) => {
    await expect(message()).toContainText(detail, { timeout: 60_000 })
    await expect(message()).not.toContainText('Unknown error')
    await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible()
  }

  try {
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, providerName, baseUrl, validKey }) =>
        window.api.dataApi.request({
          id: 'mp17-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: providerName,
            presetProviderId: 'openai',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mp17-key', key: validKey, isEnabled: true }]
          }
        }),
      { providerId, providerName, baseUrl, validKey }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp17-enable',
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
          id: 'mp17-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: upstream.modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp17-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, upstream.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const row = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await row.hover()
    await row.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(upstream.modelId)
    await Promise.all([
      sendChatMarker(page, 'Verify the configured model.', 'MP17_BASELINE_OK'),
      upstream.nextRequest().then((request) => request.complete('MP17_BASELINE_OK'))
    ])
    expect(requests.at(-1)?.authorization).toBe(`Bearer ${validKey}`)

    await testInfo.attach('MP-17 fixture scope', {
      body: 'Loopback mock provider: HTTP 401/400/402/404/429; real UI, transport, clipboard and recovery. No production quota test.',
      contentType: 'text/plain'
    })
    await setKey(invalidKey)
    await send('Reply after the credential is repaired.')
    await expectError(authError, 'Open provider settings')
    expect(requests.at(-1)?.authorization).toBe(`Bearer ${invalidKey}`)
    await screenshot('MP-17 invalid key and recovery action')
    await message().getByText('Detail', { exact: true }).click()
    const overview = page.getByRole('dialog').last()
    await overview.getByRole('button', { name: 'View Details', exact: true }).click()
    const details = page.getByRole('dialog').last()
    await expect(details).toContainText(authError)
    await details.getByRole('button', { name: 'Copy', exact: true }).click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    await screenshot('MP-17 expanded original error details')
    await testInfo.attach('MP-17 original response and copied error', {
      body: JSON.stringify(
        { response: { error: { message: authError, type: 'invalid_api_key', code: 'invalid_api_key' } }, copied },
        null,
        2
      ),
      contentType: 'application/json'
    })
    expect(copied).toContain(authError)
    expect(copied).toContain('401')
    expect(copied).toContain('invalid_api_key')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open provider settings', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/provider.*${providerId}`))
    await expect(page.getByText(providerName, { exact: true }).first()).toBeVisible()
    await setKey(validKey)
    await closeSettings(page)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    const retry = await upstream.nextRequest()
    expect(requests.at(-1)?.authorization).toBe(`Bearer ${validKey}`)
    expect(JSON.stringify(retry.body.messages)).toContain('Reply after the credential is repaired.')
    retry.complete('MP17_AUTH_RECOVERED')
    await expect(message()).toContainText('MP17_AUTH_RECOVERED')
    await screenshot('MP-17 successful retry after restoring key')

    const longPrompt = `MP17 long context ${'context word '.repeat(4000)}`
    await send(longPrompt)
    await expectError(contextError, 'Trim context')
    await screenshot('MP-17 context length recovery')
    await page.getByRole('button', { name: 'Trim context', exact: true }).click()
    await expect(page.getByText('New Context', { exact: true }).last()).toBeVisible()
    await Promise.all([
      sendChatMarker(page, 'A short request after trimming.', 'MP17_TRIM_RECOVERED'),
      upstream.nextRequest().then((request) => {
        expect(JSON.stringify(request.body.messages)).not.toContain(longPrompt)
        request.complete('MP17_TRIM_RECOVERED')
      })
    ])

    fault = 'model'
    await send('Use a model that is temporarily unavailable.')
    await expectError('MP17_MODEL_DETAIL', 'Switch model')
    await page.getByRole('button', { name: 'Switch model', exact: true }).click()
    await expect(page.getByRole('dialog').last()).toBeVisible()
    await expect(page.getByRole('dialog').last()).toContainText(upstream.modelId)
    await page.keyboard.press('Escape')

    fault = 'quota'
    await send('Check billing recovery without spending real quota.')
    await expectError('MP17_BILLING_DETAIL', 'Open billing')
    expect(findListeningPid(app.record.platform, MAIN_INSPECTOR_PORT)).toBe(app.record.electronPid)
    const targets = await fetch(`http://127.0.0.1:${MAIN_INSPECTOR_PORT}/json/list`).then(
      (response) => response.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>
    )
    const inspector = targets.find((target) => target.type === 'node')?.webSocketDebuggerUrl
    if (!inspector) throw new Error('Owned main-process inspector is unavailable for billing navigation')
    // Forward the real shell call and record its successful completion, as an external effect.
    await evaluateCdpExpression(
      inspector,
      `(() => {
      const { shell } = process.mainModule.require('electron')
      const original = shell.openExternal
      const capture = { original, url: undefined }
      globalThis.__mp17Billing = capture
      shell.openExternal = async (url, ...args) => {
        const result = await original.call(shell, url, ...args)
        capture.url = url
        return result
      }
    })()`
    )
    try {
      await page.getByRole('button', { name: 'Open billing', exact: true }).click()
      await expect
        .poll(() => evaluateCdpExpression<string | undefined>(inspector, 'globalThis.__mp17Billing.url'))
        .toBe('https://platform.openai.com/settings/organization/billing/overview')
    } finally {
      await evaluateCdpExpression(
        inspector,
        `(() => {
        process.mainModule.require('electron').shell.openExternal = globalThis.__mp17Billing.original
        delete globalThis.__mp17Billing
      })()`
      )
    }

    fault = 'rate'
    await send('Retry after the temporary rate limit is removed.')
    await expectError('MP17_RETRY_DETAIL', 'Retry')
    fault = 'none'
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    const recovered = await upstream.nextRequest()
    recovered.complete('MP17_RETRY_ACTION_OK')
    await expect(message()).toContainText('MP17_RETRY_ACTION_OK')
    await screenshot('MP-17 Retry action succeeds')

    const createdMcp = await page.evaluate(
      ({ baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp17-mcp',
          method: 'POST',
          path: '/mcp-servers',
          body: {
            name: 'MP17 offline MCP',
            type: 'streamableHttp',
            baseUrl,
            isActive: false,
            isTrusted: true,
            timeout: 3
          }
        }),
      { baseUrl: baseUrl.replace('/v1', '/mcp') }
    )
    expect(createdMcp.status).toBe(201)
    mcpId = (createdMcp.data as { id: string }).id
    await openSettingsSection(page, 'MCP')
    await page.getByText('MP17 offline MCP', { exact: true }).first().click()
    await page.getByRole('switch').first().click()
    await expect(page.getByRole('button', { name: 'View MCP server', exact: true })).toBeVisible({ timeout: 60_000 })
    await screenshot('MP-17 offline MCP recovery action')
    await page.getByRole('button', { name: 'View MCP server', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/settings/mcp/settings/${mcpId}`))
    await expect(page.getByText('MP17 offline MCP', { exact: true }).first()).toBeVisible()
    await screenshot('MP-17 MCP recovery destination')
  } finally {
    await page.evaluate(
      async ({ providerId, validKey, assistantId, mcpId, namingEnabled }) => {
        await window.api.preference.set('topic.naming.enabled', namingEnabled)
        await window.api.dataApi.request({
          id: 'mp17-restore',
          method: 'PATCH',
          path: `/providers/${providerId}/api-keys/mp17-key`,
          body: { key: validKey }
        })
        if (mcpId) await window.api.ipcApi.request('mcp.server.remove', { serverId: mcpId })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp17-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { providerId, validKey, assistantId, mcpId, namingEnabled }
    )
    await upstream.close()
    await new Promise<void>((resolve, reject) => {
      gateway.close((error) => (error ? reject(error) : resolve()))
      gateway.closeAllConnections()
    })
  }
}
