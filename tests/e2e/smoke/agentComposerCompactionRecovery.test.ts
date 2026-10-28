import type { Page } from '@playwright/test'

import enUs from '@renderer/i18n/locales/en-us.json'

import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const AGENT_NAME = 'Probe 22524 Agent'
const SESSION_NAME = 'Probe 22524 Session'

async function skipOnboarding(page: Page) {
  const languageSelect = page.locator('[data-onboarding-language-select]')
  const shell = uiLocator(page, 'app.shell').first()
  await expect(shell.or(languageSelect).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 })
  await page.evaluate(async () => {
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('topic.naming.enabled', false)
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const accept = page.getByRole('button', { name: /^(Accept and Continue|同意并继续)$/ })
  if (await accept.isVisible().catch(() => false)) await accept.click()
  await expect(uiLocator(page, 'app.shell').first()).toBeVisible({ timeout: 120_000 })
}

async function openSession(page: Page) {
  await selectSidebarApp(page, 'Work')
  const agentView = uiLocator(page, 'agent.view').filter({ visible: true }).first()
  await expect(agentView).toBeVisible({ timeout: 60_000 })
  const header = agentView.getByText(AGENT_NAME, { exact: true }).first()
  await expect(header).toBeVisible({ timeout: 60_000 })
  await header.click()
  const conversation = agentView.getByText(SESSION_NAME, { exact: true }).first()
  if (!(await conversation.isVisible().catch(() => false))) {
    await header.hover()
    await agentView
      .getByRole('button', { name: AGENT_NAME, exact: true })
      .first()
      .locator('..')
      .getByRole('button', { name: 'Expand', exact: true })
      .click()
  }
  await conversation.click()
  const composer = uiLocator(agentView, 'chat.composer').filter({ visible: true })
  await expect(composer).toHaveCount(1, { timeout: 60_000 })
  return agentView
}

test('agent composer shows compaction recovery notices and starts an empty session', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  expect(process.env.CS_DEV_PROFILE_ROOT).toBeTruthy()
  await skipOnboarding(page)

  const seeded = await page.evaluate(async () => {
    const providerId = 'probe-22524'
    await window.api.dataApi.request({
      id: 'p-create',
      method: 'POST',
      path: '/providers',
      body: {
        providerId,
        name: 'Probe 22524',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: { 'anthropic-messages': { baseUrl: 'http://127.0.0.1:9' } },
        apiKeys: [{ id: 'k', key: 'k', isEnabled: true }]
      }
    })
    await window.api.dataApi.request({
      id: 'p-enable',
      method: 'PATCH',
      path: `/providers/${providerId}`,
      body: { isEnabled: true }
    })
    await window.api.dataApi.request({
      id: 'm-create',
      method: 'POST',
      path: '/models',
      body: [{ providerId, modelId: 'probe-22524-model', endpointTypes: ['anthropic-messages'] }]
    })
    const created = await window.api.ipcApi.request('ai.agent.create', {
      type: 'claude-code',
      name: 'Probe 22524 Agent',
      model: `${providerId}::probe-22524-model`,
      instructions: 'Answer briefly.'
    })
    const agent = (created as { data: { id: string } }).data
    const session = await window.api.dataApi.request({
      id: 's-create',
      method: 'POST',
      path: '/agent-sessions',
      body: { agentId: agent.id, name: 'Probe 22524 Session', workspace: { type: 'system' } }
    })
    return { agentId: agent.id, sessionId: (session.data as { id: string }).id, sessionStatus: session.status }
  })
  expect(seeded.sessionStatus).toBe(201)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(uiLocator(page, 'app.shell').first()).toBeVisible({ timeout: 120_000 })
  await openSession(page)

  // Seeded cache precondition: the upstream 32 MB request and raw CLI payload are not reproduced locally.
  // This covers recovery notices and actions; reload reads main's relay, which excludes the sending window.
  const seed = async (value: unknown) => {
    await page.evaluate(
      async ({ sessionId, value }) =>
        window.api.cache.broadcastSync({
          type: 'shared',
          key: `agent.session.compaction.${sessionId}`,
          value
        }),
      { sessionId: seeded.sessionId, value }
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(uiLocator(page, 'app.shell').first()).toBeVisible({ timeout: 120_000 })
    return openSession(page)
  }

  const view1 = await seed({ status: 'failed', error: 'Request too large (max 32MB)', reason: 'request_too_large' })
  const alert1 = view1.locator('[data-slot="alert"]').first()
  await expect(alert1).toBeVisible({ timeout: 30_000 })
  await expect(alert1).toContainText(enUs['chat.compaction.request_too_large.title'])
  await expect(alert1).toContainText(enUs['chat.compaction.request_too_large.description'])
  await expect(alert1).not.toContainText('Request too large (max 32MB)')
  await expect(alert1.getByRole('button')).toHaveCount(1)
  await expect(alert1.getByRole('button')).toHaveText(enUs['agent.session.new'])
  const requestTooLargeScreenshot = testInfo.outputPath('request-too-large.png')
  await page.screenshot({ path: requestTooLargeScreenshot })
  await testInfo.attach('request-too-large', { path: requestTooLargeScreenshot, contentType: 'image/png' })

  const view2 = await seed({ status: 'failed', error: 'too_few_groups', reason: 'nothing_to_compact' })
  const alert2 = view2.locator('[data-slot="alert"]').first()
  await expect(alert2).toBeVisible({ timeout: 30_000 })
  await expect(alert2).toContainText(enUs['chat.compaction.nothing_to_compact.title'])
  await expect(alert2).toContainText(enUs['chat.compaction.nothing_to_compact.description'])
  await expect(alert2).not.toContainText('too_few_groups')
  await expect(alert2.getByRole('button')).toHaveCount(1)
  await expect(alert2.getByRole('button')).toHaveText(enUs['agent.session.new'])
  const nothingToCompactScreenshot = testInfo.outputPath('nothing-to-compact.png')
  await page.screenshot({ path: nothingToCompactScreenshot })
  await testInfo.attach('nothing-to-compact', { path: nothingToCompactScreenshot, contentType: 'image/png' })

  const view3 = await seed({ status: 'failed', error: 'context too large' })
  const alert3 = view3.locator('[data-slot="alert"]').first()
  await expect(alert3).toBeVisible({ timeout: 30_000 })
  await expect(alert3).toContainText(enUs['chat.compaction.failed'])
  await expect(alert3).toContainText('context too large')
  await expect(alert3.getByRole('button')).toHaveCount(0)

  const view4 = await seed({ status: 'failed', error: 'Request too large (max 32MB)', reason: 'request_too_large' })
  const alert4 = view4.locator('[data-slot="alert"]').first()
  const action = alert4.getByRole('button')
  await expect(action).toHaveCount(1, { timeout: 30_000 })
  await expect(action).toHaveText(enUs['agent.session.new'])
  await action.click()
  await expect(page.locator('[data-slot="alert"]')).toHaveCount(0, { timeout: 30_000 })
  const newTaskScreenshot = testInfo.outputPath('new-task.png')
  await page.screenshot({ path: newTaskScreenshot })
  await testInfo.attach('new-task', { path: newTaskScreenshot, contentType: 'image/png' })
})
