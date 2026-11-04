// The catalog is a fixture injected through the shared-cache channel: this tests renderer localization and
// language switching, not SDK discovery.
// A pi agent avoids republishing over the fixture: only Claude Code implements getSupportedCommands()
// (src/main/ai/runtime/claudeCode/ClaudeCodeRuntimeDriver.ts:580).
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'

import enUs from '../../../src/renderer/i18n/locales/en-us.json'
import zhCn from '../../../src/renderer/i18n/locales/zh-cn.json'
import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot },
      timeout: 60_000
    })
    try {
      await use(app)
    } finally {
      try {
        await app.close()
      } finally {
        await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
      }
    }
  }
})

test('localizes builtins in an open slash-command panel and preserves custom descriptions', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  const language = await page.evaluate(async (policyVersion) => {
    await window.api.preference.set('app.privacy.policy_version', policyVersion)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
    return window.api.preference.get('app.language')
  }, LATEST_PRIVACY_POLICY_VERSION)
  expect(language).toBe('en-US')
  await page.reload()

  const suffix = randomUUID()
  const providerId = `slash-localization-${suffix}`
  const modelId = 'fixture-model'
  const agentName = `Slash localization agent ${suffix}`
  const sessionName = `Slash localization session ${suffix}`
  const provider = await page.evaluate(
    ({ providerId }) =>
      window.api.dataApi.request({
        id: `${providerId}-create`,
        method: 'POST',
        path: '/providers',
        body: {
          providerId,
          name: providerId,
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl: 'http://127.0.0.1:9/v1' } },
          apiKeys: [{ id: 'fixture-key', key: 'fixture-key', isEnabled: true }]
        }
      }),
    { providerId }
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
    { providerId, modelId }
  )
  expect(models.status).toBe(201)
  const created = await page.evaluate(
    ({ name, model }) =>
      window.api.ipcApi.request('ai.agent.create', {
        type: 'pi',
        name,
        model,
        instructions: 'Do not send any model requests.'
      }),
    { name: agentName, model: createUniqueModelId(providerId, modelId) }
  )
  expect(created).toMatchObject({ ok: true })
  const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
  const sessionResponse = await page.evaluate(
    ({ agentId, name }) =>
      window.api.dataApi.request({
        id: `slash-session-${name}`,
        method: 'POST',
        path: '/agent-sessions',
        body: { agentId, name, workspace: { type: 'system' } }
      }),
    { agentId: agent.id, name: sessionName }
  )
  expect(sessionResponse.status).toBe(201)
  const session = AgentSessionEntitySchema.parse(sessionResponse.data)
  const rows = [
    { name: 'security-review', description: 'fixture-security-text', argumentHint: '', builtin: true },
    { name: 'usage', description: 'fixture-usage-text', argumentHint: '', builtin: true },
    { name: 'deploy', description: 'Deploy using the custom project workflow', argumentHint: '' },
    { name: 'clear', description: 'Clear only the custom author workspace', argumentHint: '' },
    ...['clear', 'compact', 'context', 'insights', 'recap', 'goal', 'list-agents', 'team-onboarding'].map((name) => ({
      name,
      description: `fixture-${name}-text`,
      argumentHint: '',
      builtin: true
    }))
  ]
  await page.evaluate(
    ({ sessionId, rows }) =>
      window.api.cache.broadcastSync({
        type: 'shared',
        key: `agent.session.slash_commands.${sessionId}`,
        value: rows
      }),
    { sessionId: session.id, rows }
  )

  await page.reload()
  await selectSidebarApp(page, 'Chat')
  await expect(uiLocator(page, 'chat.composer').filter({ visible: true }).first()).toBeVisible()
  await selectSidebarApp(page, 'Work')
  const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
  await expect(view).toBeVisible()
  const agentHeader = view.getByText(agentName, { exact: true }).first()
  await agentHeader.click()
  const conversation = view.getByText(sessionName, { exact: true }).first()
  if (!(await conversation.isVisible())) {
    await agentHeader.hover()
    const groupHeader = view.getByRole('button', { name: agentName, exact: true }).first()
    await groupHeader.locator('..').getByRole('button', { name: 'Expand', exact: true }).click()
  }
  await conversation.click()
  const composer = uiLocator(view, 'chat.composer').filter({ visible: true }).first()
  const input = composer.locator('[contenteditable="true"]').first()
  await input.fill('/')
  const panel = page.getByTestId('quick-panel').filter({ visible: true })
  await expect(panel).toBeVisible()
  const security = panel.getByRole('button').filter({ has: page.getByText('/security-review', { exact: true }) })
  const usage = panel.getByRole('button').filter({ has: page.getByText('/usage', { exact: true }) })
  const securityKey = 'chat.input.slash_commands.commands.security_review'
  const usageKey = 'chat.input.slash_commands.commands.usage'
  await input.fill('/security-review')
  await expect(security.getByText(enUs[securityKey], { exact: true })).toBeVisible()
  await expect(security).not.toContainText('fixture-security-text')
  await input.fill('/usage')
  await expect(usage.getByText(enUs[usageKey], { exact: true })).toBeVisible()
  await expect(usage).not.toContainText('fixture-usage-text')
  await input.fill('/deploy')
  const deploy = panel.getByRole('button').filter({ has: page.getByText('/deploy', { exact: true }) })
  await expect(deploy.getByText('Deploy using the custom project workflow', { exact: true })).toBeVisible()
  await input.fill('/clear')
  const customClear = panel.getByRole('button').filter({ has: page.getByText('/clear', { exact: true }) })
  await expect(customClear).toHaveCount(1)
  await expect(customClear.getByText('Clear only the custom author workspace', { exact: true })).toBeVisible()
  await expect(customClear).not.toContainText(enUs['chat.input.slash_commands.commands.clear'])

  await input.fill('/usage')
  await expect(usage.getByText(enUs[usageKey], { exact: true })).toBeVisible()
  await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
  await expect(panel).toBeVisible()
  await expect(usage.getByText(zhCn[usageKey], { exact: true })).toBeVisible()
  await expect(usage.getByText('/usage', { exact: true })).toBeVisible()
  const chineseScreenshot = testInfo.outputPath('slash-commands-zh-cn.png')
  await page.screenshot({ path: chineseScreenshot })
  await testInfo.attach('slash-commands-zh-cn', { path: chineseScreenshot, contentType: 'image/png' })

  await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
  await expect(panel).toBeVisible()
  await expect(usage.getByText(enUs[usageKey], { exact: true })).toBeVisible()
  await expect(usage.getByText('/usage', { exact: true })).toBeVisible()
  const englishScreenshot = testInfo.outputPath('slash-commands-en-us.png')
  await page.screenshot({ path: englishScreenshot })
  await testInfo.attach('slash-commands-en-us', { path: englishScreenshot, contentType: 'image/png' })

  await input.fill('/security-review')
  await security.click()
  await expect.poll(() => input.innerText()).toBe('/security-review ')
  const insertedScreenshot = testInfo.outputPath('slash-command-inserted.png')
  await page.screenshot({ path: insertedScreenshot })
  await testInfo.attach('slash-command-inserted', { path: insertedScreenshot, contentType: 'image/png' })
})
