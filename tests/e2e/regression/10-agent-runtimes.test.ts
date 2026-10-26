import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { agentFilePreview } from './agentFilePreview'
import { builtinAssistantAgent, createAgent, runAgentFileTask, selectAgentWorkspace, startNewAgentTask } from './agents'
import { expect, test } from './fixture'
import { ensureCustomChatProvider, selectVisibleModel } from './models'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import { scheduledTaskConversation } from './scheduledTaskConversation'
import { closeSettings } from './settings'
async function ensureAgentModel(
  app: Parameters<typeof ensureCustomChatProvider>[0],
  page: Parameters<typeof ensureCustomChatProvider>[1]
): Promise<string> {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  return app.config.customProvider.chatModel
}
import { agentMemoryContext } from './agentMemoryContext'
import { agentPermissionDecisions } from './agentPermissionDecisions'
import { agentPreviewPanel } from './agentPreviewPanel'
import { agentRuntimeMessages } from './agentRuntimeMessages'
import { agentSessionList } from './agentSessionList'
import { agentStatusPanel } from './agentStatusPanel'
import { interruptAgentTask } from './interruptAgentTask'
import { scheduledTasks } from './scheduledTasks'
import { workspaceLifecycle } from './workspaceLifecycle'

test(...caseDefinition('A-01'), async ({ app, mainWindow: page }) => {
  test.setTimeout(10 * 60_000)
  const modelName = await ensureAgentModel(app, page)
  const assistant = await builtinAssistantAgent(page)
  await startNewAgentTask(page, assistant.name)

  const agentView = page.locator('[data-ui~="agent.view"]:visible').first()
  const model = agentView
    .getByRole('button', { name: 'Select Model', exact: true })
    .or(agentView.locator('button:has(span[title*=" | "])'))
    .first()
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

test(...caseDefinition('A-03'), async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  const model = await ensureAgentModel(app, page)
  const name = 'Cherry Regression Claude Agent 31415'
  await createAgent(page, { name, permission: 'Full Access', runtime: 'Claude Agent', model })
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

test(...caseDefinition('MP-144'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(8 * 60_000)
  await agentRuntimeMessages(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-145'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(8 * 60_000)
  await scheduledTaskConversation(app, page, testInfo)
})

test(...caseDefinition('MP-19'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(8 * 60_000)
  await agentPreviewPanel(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-51'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(5 * 60_000)
  await agentPermissionDecisions(app, mainWindow, testInfo)
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

test(...caseDefinition('MP-55'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(7 * 60_000)
  await agentStatusPanel(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-56'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(5 * 60_000)
  const model = await ensureAgentModel(app, page)
  await interruptAgentTask(app, page, testInfo, model)
})

test(...caseDefinition('MP-57'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(5 * 60_000)
  await agentMemoryContext(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-58'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(8 * 60_000)
  await scheduledTasks(app, mainWindow, testInfo)
})
