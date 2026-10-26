import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { InstalledSkill } from '@shared/data/api/schemas/skills'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startNewAgentTask } from '../helpers/agents'
import { ensureCustomChatProvider, selectVisibleModel } from '../helpers/models'
import { openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

// Uses the configured real provider; the expected reply exists only in the installed SKILL.md.
export async function skillChatTrigger(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await ensureCustomChatProvider(app, page)
  await openSettingsSection(page, 'API Gateway')
  const startGateway = page.getByRole('button', { name: 'Start', exact: true })
  const stopGateway = page.getByRole('button', { name: 'Stop', exact: true })
  await expect(startGateway.or(stopGateway)).toBeVisible()
  if (await startGateway.isVisible()) await startGateway.click()
  await expect(stopGateway).toBeVisible()
  const list = await page.evaluate(() =>
    window.api.dataApi.request({ id: 'MP-138-list', method: 'GET', path: '/skills' })
  )
  expect(list.status).toBe(200)
  let skill = (list.data as InstalledSkill[]).find(({ name }) => name === 'skill-sample')
  const existed = Boolean(skill)
  if (!skill) {
    const installed = (await page.evaluate(
      (directoryPath) => window.api.ipcApi.request('skill.install_from_directory', { directoryPath }),
      resolve('tests/e2e/regression/fixtures/skill-sample')
    )) as { ok: boolean; data: { success: boolean; data: InstalledSkill } }
    expect(installed.ok).toBe(true)
    expect(installed.data.success).toBe(true)
    skill = installed.data.data
  }
  if (!skill) throw new Error('skill-sample installation returned no skill')
  const originalEnabled = skill.isGlobalEnabled
  const skillId = skill.id
  const readSession = async () => {
    const latest = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'MP-138-session', method: 'GET', path: '/agent-sessions/latest' })
    )
    expect(latest.status).toBe(200)
    return (latest.data as { session: { id: string } }).session.id
  }
  const readMessages = async (sessionId: string) => {
    const response = await page.evaluate(
      (sessionId) =>
        window.api.dataApi.request({
          id: 'MP-138-messages',
          method: 'GET',
          path: `/agent-sessions/${sessionId}/messages`
        }),
      sessionId
    )
    expect(response.status).toBe(200)
    return (response.data as { items: AgentSessionMessageEntity[] }).items
  }
  const chooseModel = async () => {
    const view = page.locator('[data-ui~="agent.view"]:visible')
    await view
      .getByRole('button', { name: 'Select Model', exact: true })
      .or(view.locator('button:has(span[title*=" | "])'))
      .first()
      .click()
    await selectVisibleModel(page, app.config.customProvider.chatModel)
  }
  const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
  const response = page
    .locator('[data-ui~="chat.message"]:visible')
    .filter({ has: page.locator('.message-assistant') })
    .last()
  try {
    await page.reload()
    await openSettingsSection(page, 'Skills')
    await page.getByPlaceholder('Search by name or description...').fill('skill-sample')
    await page.getByText('skill-sample', { exact: true }).first().click()
    const toggle = page.getByRole('switch', { name: 'Globally enable skill skill-sample', exact: true })
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click()
    await expect(toggle).toBeChecked()
    await page.getByRole('button', { name: 'Try now', exact: true }).click()
    await expect(composer).toContainText('Use the skill-sample Skill to help me with this task.')
    await expect(composer.locator('[data-composer-token-kind="skill"]')).toHaveCount(1)
    await screenshot('MP-138 Try now preset and skill token')
    await chooseModel()
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(response.getByText('QA-SAMPLE-SKILL-OK', { exact: true })).toBeVisible({ timeout: 180_000 })
    await expect(response.getByTestId('completed-process-trigger')).toBeVisible({ timeout: 180_000 })
    const enabledSessionId = await readSession()
    const enabledMessages = await readMessages(enabledSessionId)
    const skillTools = enabledMessages
      .flatMap(({ data }) => data.parts ?? [])
      .filter(
        (part) => (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) && /skill/i.test(JSON.stringify(part))
      )
    expect(skillTools, 'The real agent must load skill-sample instructions').not.toHaveLength(0)
    expect(JSON.stringify(skillTools)).toContain('skill-sample')
    await testInfo.attach('MP-138 skill loading evidence', {
      body: JSON.stringify(skillTools),
      contentType: 'application/json'
    })
    await screenshot('MP-138 enabled skill reply')

    await openSettingsSection(page, 'Skills')
    await page.getByPlaceholder('Search by name or description...').fill('skill-sample')
    await page.getByText('skill-sample', { exact: true }).first().click()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    const owner = await page.evaluate(async (sessionId) => {
      const session = await window.api.dataApi.request({
        id: 'MP-138-owner-session',
        method: 'GET',
        path: `/agent-sessions/${sessionId}`
      })
      const agentId = (session.data as { agentId: string }).agentId
      return window.api.dataApi.request({ id: 'MP-138-owner-agent', method: 'GET', path: `/agents/${agentId}` })
    }, enabledSessionId)
    expect(owner.status).toBe(200)
    await startNewAgentTask(page, (owner.data as { name: string }).name)
    await chooseModel()
    await composer.fill(
      'Use the skill-sample Skill to help me with this task. If it is unavailable, say SKILL_UNAVAILABLE and do not search for or install it.'
    )
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(response.getByTestId('completed-process-trigger')).toBeVisible({ timeout: 180_000 })
    await expect(response).toContainText('SKILL_UNAVAILABLE')
    await expect(response).not.toContainText('QA-SAMPLE-SKILL-OK')
    const disabledSessionId = await readSession()
    expect(disabledSessionId).not.toBe(enabledSessionId)
    const disabledMessages = await readMessages(disabledSessionId)
    const successfulSampleLoads = disabledMessages
      .flatMap(({ data }) => data.parts ?? [])
      .filter(
        (part) =>
          (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) &&
          'state' in part &&
          part.state === 'output-available' &&
          JSON.stringify(part).includes('QA-SAMPLE-SKILL-OK')
      )
    expect(successfulSampleLoads).toHaveLength(0)
    await screenshot('MP-138 disabled skill no longer triggers')

    await page.evaluate(
      async (sessionId) =>
        window.api.ipcApi.request('navigation.open_route_in_main', {
          path: `/app/agents?intent=skill&sessionId=${sessionId}&skillId=MP-138-missing-skill`
        }),
      disabledSessionId
    )
    await expect(page.getByText('This Skill is no longer available', { exact: true })).toBeVisible()
    await screenshot('MP-138 unavailable skill warning')
  } finally {
    if (existed) {
      await page.evaluate(
        ({ skillId, originalEnabled }) =>
          window.api.dataApi.request({
            id: 'MP-138-restore',
            method: 'PATCH',
            path: `/skills/${skillId}`,
            body: { isGlobalEnabled: originalEnabled }
          }),
        { skillId, originalEnabled }
      )
    } else {
      await page.evaluate((skillId) => window.api.ipcApi.request('skill.uninstall', { skillId }), skillId)
    }
  }
}
