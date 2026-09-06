import { join } from 'node:path'

import { expect, test } from './fixture'
import { createAgent, runAgentFileTask, selectAgentWorkspace, startNewAgentTask } from './agents'
import { addCherryInModel, ensureCherryInSignedIn } from './cherry-in'
import { dismissOnboarding, selectSidebarApp } from './helpers'
import { closeSettings, selectVisibleModel } from './models'
import { validateFileEvidence } from '../../../scripts/cherry-regression-test/file-evidence'

async function ensureAgentModel(
  app: Parameters<typeof ensureCherryInSignedIn>[0],
  page: Parameters<typeof ensureCherryInSignedIn>[1]
): Promise<void> {
  await ensureCherryInSignedIn(app, page)
  await addCherryInModel(page, app.config.cherryIn.chatModel)
  await closeSettings(page)
}

test('[A-03] Claude Agent Runtime @claude-agent-runtime', async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  await ensureAgentModel(app, page)
  const name = 'Cherry Regression Claude Agent 31415'
  await createAgent(app, page, { name, permission: 'Full Access', runtime: 'Advanced: Claude Agent' })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'claude-agent-result.txt', false)

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Work')
  const agentView = page.locator('[data-ui="agent.view"]:visible').first()
  await expect(agentView.getByRole('button', { name, exact: true })).toBeVisible()
})

test('[A-04] Pi Runtime @pi-runtime', async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  await ensureAgentModel(app, page)
  await createAgent(app, page, { name: 'Pi Regression Agent', permission: 'Ask Before Acting', runtime: 'Fast: Pi' })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'pi-agent-result.txt', true)
})

test('[A-05] DeepSeek Harness Runtime @deepseek-harness-runtime', async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  await ensureAgentModel(app, page)
  await createAgent(app, page, { name: 'DeepSeek Harness Agent', runtime: 'DeepSeek Harness' })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'dsh-agent-result.txt', true)
})

test('[A-01] 默认 Agent 完成 PPT 任务 @agent-ppt', async ({ app, mainWindow: page }) => {
  test.setTimeout(15 * 60_000)
  await ensureAgentModel(app, page)
  await startNewAgentTask(page, 'Cherry Assistant')

  const model = page.getByRole('button', { name: /Select Model|Selected models/ }).first()
  if (await model.isVisible().catch(() => false)) {
    await model.click()
    await selectVisibleModel(page, app.config.cherryIn.chatModel)
  }
  await selectAgentWorkspace(app, page)

  await page
    .locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]')
    .first()
    .fill(
      'Create cherry-regression-31415.pptx in the current working directory. Its exact title must be Cherry Regression 31415 and it must contain exactly three slides.'
    )
  await page.getByRole('button', { name: 'Send', exact: true }).click()

  const output = join(app.paths.workspace, 'cherry-regression-31415.pptx')
  await expect
    .poll(
      async () => {
        const allow = page.getByRole('button', { name: /Allow/ }).first()
        if (await allow.isVisible().catch(() => false)) await allow.click()
        try {
          await validateFileEvidence(output, {
            exactSlides: 3,
            expectedText: 'Cherry Regression 31415',
            minimumBytes: 1_024,
            type: 'pptx'
          })
          return true
        } catch {
          return false
        }
      },
      { timeout: 10 * 60_000 }
    )
    .toBe(true)
})
