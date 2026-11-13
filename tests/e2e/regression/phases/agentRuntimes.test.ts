import { writeFile } from 'node:fs/promises'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import {
  builtinAssistantAgent,
  createAgent,
  runAgentFileTask,
  selectAgent,
  selectAgentWorkspace,
  startNewAgentTask
} from '../helpers/agents'
import { ensureCustomChatProvider, selectVisibleModel } from '../helpers/models'
import { dismissOnboarding, selectSidebarApp } from '../helpers/navigation'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import { agentFilePreview } from '../scenarios/agentFilePreview'
import { agentGlobalInstallApproval } from '../scenarios/agentGlobalInstallApproval'
async function ensureAgentModel(
  app: Parameters<typeof ensureCustomChatProvider>[0],
  page: Parameters<typeof ensureCustomChatProvider>[1]
): Promise<{ model: string; providerId: string }> {
  // The provider id scopes every model picker: another enabled provider exposing
  // the same raw model id must never be selected instead of the configured one.
  const providerId = await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  return { model: app.config.customProvider.chatModel, providerId }
}
import { agentPermissionDecisions } from '../scenarios/agentPermissionDecisions'
import { agentPreviewPanel } from '../scenarios/agentPreviewPanel'
import { agentRuntimeMessages } from '../scenarios/agentRuntimeMessages'
import { agentSessionList } from '../scenarios/agentSessionList'
import { agentStatusPanel } from '../scenarios/agentStatusPanel'
import { agentTaskPlanProjection } from '../scenarios/agentTaskPlanProjection'
import { scheduledTasks } from '../scenarios/scheduledTasks'
import { workspaceLifecycle } from '../scenarios/workspaceLifecycle'

test(...caseDefinition('A-01'), async ({ app, mainWindow: page }) => {
  test.setTimeout(10 * 60_000)
  const { model: modelName, providerId } = await ensureAgentModel(app, page)
  const assistant = await builtinAssistantAgent(page)
  await startNewAgentTask(page, assistant.name)

  const agentView = page.locator('[data-ui~="agent.view"]:visible').first()
  const model = agentView
    .getByRole('button', { name: 'Select Model', exact: true })
    .or(agentView.locator('button:has(span[title*=" | "])'))
    .first()
  await expect(model).toBeVisible()
  await model.click()
  await selectVisibleModel(page, modelName, providerId)
  await selectAgentWorkspace(app, page)

  const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
  await composer.press(app.record.platform === 'macos' ? 'Meta+A' : 'Control+A')
  await composer.press('Backspace')
  await expect(composer.locator('[data-composer-token-kind="skill"]')).toHaveCount(0)
  await runAgentFileTask(app, page, 'default-agent-result.txt', true)
})

test(...caseDefinition('A-03'), async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  const { model, providerId } = await ensureAgentModel(app, page)
  const name = 'Cherry Regression Claude Agent 31415'
  await createAgent(page, { name, permission: 'Full Access', runtime: 'Claude Agent', model, providerId })
  await selectAgentWorkspace(app, page)
  const marker = 'CLAUDE_AGENT_RUNTIME_PASS'
  const agentView = page.locator('[data-ui~="agent.view"]:visible').first()
  const composer = agentView.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  await composer.fill(`Reply with exactly ${marker} and do not use tools.`)
  await agentView.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(agentView.getByText(marker, { exact: true }).last()).toBeVisible({ timeout: 2 * 60_000 })

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Work')
  const restartedAgentView = page.locator('[data-ui~="agent.view"]:visible').first()
  await expect(restartedAgentView.getByRole('button', { name, exact: true })).toBeVisible()
})

test(...caseDefinition('A-04'), async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  const { model, providerId } = await ensureAgentModel(app, page)
  await createAgent(page, {
    name: 'Pi Regression Agent',
    permission: 'Ask Before Acting',
    runtime: 'Pi',
    model,
    providerId
  })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'pi-agent-result.txt', true)
})

test(...caseDefinition('MP-144'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(8 * 60_000)
  await agentRuntimeMessages(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-19'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(8 * 60_000)
  await agentPreviewPanel(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-51'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(5 * 60_000)
  await agentPermissionDecisions(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-153'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(10 * 60_000)
  await agentGlobalInstallApproval(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-52'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(5 * 60_000)
  await agentFilePreview(app, page, testInfo)
})

test(...caseDefinition('MP-53'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(5 * 60_000)
  await workspaceLifecycle(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-54'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(4 * 60_000)
  await agentSessionList(app, page, testInfo)
})

test(...caseDefinition('MP-161'), async ({ app, mainWindow: page }, testInfo) => {
  const name = app.resourceName('MP-161 archive agent')
  const names = [app.resourceName('MP-161 session one'), app.resourceName('MP-161 session two')]
  const preferences = await page.evaluate(async () => ({
    mode: await window.api.preference.get('agent.session.display_mode'),
    position: await window.api.preference.get('agent.session.position'),
    menu: await window.api.preference.get('menu.presentation_mode')
  }))
  let agentId: string | undefined
  const providerId = `mp161-${Date.now()}`
  try {
    const provider = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp161-provider',
          method: 'POST',
          path: '/providers',
          body: { providerId, name: 'MP-161 provider', defaultChatEndpoint: 'openai-chat-completions' }
        }),
      providerId
    )
    expect(provider.status).toBe(201)
    const model = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp161-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: 'mp161-model', endpointTypes: ['openai-chat-completions'] }]
        }),
      providerId
    )
    expect(model.status).toBe(201)
    const agent = (await page.evaluate(
      ({ name, model }) => window.api.ipcApi.request('ai.agent.create', { name, model, type: 'pi' }),
      { name, model: createUniqueModelId(providerId, 'mp161-model') }
    )) as IpcResult<AgentEntity>
    expect(agent.ok).toBe(true)
    if (!agent.ok) throw new Error('Failed to create MP-161 agent')
    agentId = agent.data.id
    for (const sessionName of names) {
      const result = await page.evaluate(
        ({ agentId, name }) =>
          window.api.dataApi.request({
            id: 'mp161-create-session',
            method: 'POST',
            path: '/agent-sessions',
            body: { agentId, name, workspace: { type: 'system' } }
          }),
        { agentId, name: sessionName }
      )
      expect(result.status).toBe(201)
    }
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'agent.session.display_mode': 'agent',
        'agent.session.position': 'left',
        'menu.presentation_mode': 'cherry'
      })
    )
    await page.reload()
    await selectAgent(page, name)
    const group = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
    await expect(group).toBeVisible()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    const row = (sessionName: string) => page.getByTestId('agent-session-row').filter({ hasText: sessionName })
    for (const sessionName of names) await expect(row(sessionName)).toBeVisible()
    await group.hover()
    await group.getByRole('button', { name: 'More', exact: true }).click()
    const archive = page.getByRole('menuitem', { name: 'Archive all conversations', exact: true })
    await expect(archive).toBeVisible()
    await archive.click()
    const dialog = page.getByRole('dialog', { name: 'Archive all conversations' })
    await expect(dialog).toContainText(`Archive all conversations of “${name}” (2 total)?`)
    const path = testInfo.outputPath('MP-161 archive confirmation.png')
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach('MP-161 archive confirmation', { path, contentType: 'image/png' })
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
    for (const sessionName of names) await expect(row(sessionName)).toHaveCount(0)
    await openSettingsSection(page, 'Archive')
    for (const sessionName of names) {
      const archived = page.locator('[data-slot="item"]').filter({ hasText: sessionName })
      await expect(archived).toBeVisible()
      await archived.getByRole('button', { name: 'Restore', exact: true }).click()
      await expect(archived).toHaveCount(0)
    }
    await closeSettings(page)
    await selectAgent(page, name)
    if (await expand.isVisible()) await expand.click()
    for (const sessionName of names) await expect(row(sessionName)).toBeVisible()
  } finally {
    await page.evaluate(
      async ({ preferences, agentId }) => {
        await window.api.preference.setMultiple({
          'agent.session.display_mode': preferences.mode,
          'agent.session.position': preferences.position,
          'menu.presentation_mode': preferences.menu
        })
        if (agentId) {
          const result = (await window.api.ipcApi.request('ai.agent.delete_permanently', {
            agentId,
            deleteSessions: true
          })) as IpcResult<{ deleted: boolean }>
          if (!result.ok || !result.data.deleted) throw new Error('MP-161 agent cleanup failed')
        }
      },
      { preferences, agentId }
    )
    await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp161-delete-provider',
          method: 'DELETE',
          path: `/providers/${providerId}`
        }),
      providerId
    )
  }
})

test(...caseDefinition('MP-55'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(7 * 60_000)
  await agentStatusPanel(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-152'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(5 * 60_000)
  await agentTaskPlanProjection(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-58'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(8 * 60_000)
  await scheduledTasks(app, mainWindow, testInfo)
})
