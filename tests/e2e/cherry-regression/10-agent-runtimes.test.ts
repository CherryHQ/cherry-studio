import { caseDefinition } from '../../../scripts/cherry-regression-test/cases'
import { expect, test } from './fixture'
import { createAgent, runAgentFileTask, selectAgentWorkspace, startNewAgentTask } from './agents'
import { dismissOnboarding, selectSidebarApp } from './helpers'
import { closeSettings, ensureCustomChatProvider, selectVisibleModel } from './models'

async function ensureAgentModel(
  app: Parameters<typeof ensureCustomChatProvider>[0],
  page: Parameters<typeof ensureCustomChatProvider>[1]
): Promise<string> {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  return app.config.customProvider.chatModel
}

test(...caseDefinition('A-03'), async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  const model = await ensureAgentModel(app, page)
  const name = 'Cherry Regression Claude Agent 31415'
  await createAgent(page, { name, permission: 'Full Access', runtime: 'Claude Agent', model })
  await selectAgentWorkspace(app, page)
  const marker = 'CLAUDE_AGENT_RUNTIME_PASS'
  const agentView = page.locator('[data-ui="agent.view"]:visible').first()
  const composer = agentView.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  await composer.fill(`Reply with exactly ${marker} and do not use tools.`)
  await agentView.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(agentView.getByText(marker, { exact: true }).last()).toBeVisible({ timeout: 2 * 60_000 })

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Work')
  const restartedAgentView = page.locator('[data-ui="agent.view"]:visible').first()
  await expect(restartedAgentView.getByRole('button', { name, exact: true })).toBeVisible()
})

test(...caseDefinition('A-04'), async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  const model = await ensureAgentModel(app, page)
  await createAgent(page, {
    name: 'Pi Regression Agent',
    permission: 'Ask Before Acting',
    runtime: 'Pi',
    model
  })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'pi-agent-result.txt', true)
})

test(...caseDefinition('A-05'), async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  const model = await ensureAgentModel(app, page)
  await createAgent(page, { name: 'DeepSeek Harness Agent', runtime: 'DeepSeek Harness', model })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'dsh-agent-result.txt', true)
})

test(...caseDefinition('A-01'), async ({ app, mainWindow: page }) => {
  test.setTimeout(10 * 60_000)
  const modelName = await ensureAgentModel(app, page)
  await startNewAgentTask(page, 'Cherry Assistant')

  const agentView = page.locator('[data-ui="agent.view"]:visible').first()
  const model = agentView.locator('button:has(span[title*=" | "])').first()
  await expect(model).toBeVisible()
  await model.click()
  await selectVisibleModel(page, modelName)
  await selectAgentWorkspace(app, page)

  const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
  await composer.press(app.record.platform === 'macos' ? 'Meta+A' : 'Control+A')
  await composer.press('Backspace')
  await expect(composer.locator('[data-composer-token-kind="skill"]')).toHaveCount(0)
  await runAgentFileTask(app, page, 'default-agent-result.txt', true)
})
