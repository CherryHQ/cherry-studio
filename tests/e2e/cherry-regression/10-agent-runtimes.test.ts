import { join } from 'node:path'

import { expect, test } from './fixture'
import { createAgent, runAgentFileTask, selectAgentWorkspace } from './agents'
import { addCherryInModel, ensureCherryInSignedIn } from './cherry-in'
import { dismissOnboarding, selectSidebarApp } from './helpers'
import { closeSettings } from './models'
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
  await ensureAgentModel(app, page)
  const name = 'Cherry Regression Claude Agent 31415'
  await createAgent(app, page, { name, permission: 'Full Access', runtime: 'Advanced: Claude Agent' })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'claude-agent-result.txt', false)

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Work')
  await expect(page.getByText(name, { exact: true })).toBeVisible()
})

test('[A-04] Pi Runtime @pi-runtime', async ({ app, mainWindow: page }) => {
  await ensureAgentModel(app, page)
  await createAgent(app, page, { name: 'Pi Regression Agent', permission: 'Ask Before Acting', runtime: 'Fast: Pi' })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'pi-agent-result.txt', true)
})

test('[A-05] DeepSeek Harness Runtime @deepseek-harness-runtime', async ({ app, mainWindow: page }) => {
  await ensureAgentModel(app, page)
  await createAgent(app, page, { name: 'DeepSeek Harness Agent', runtime: 'DeepSeek Harness' })
  await selectAgentWorkspace(app, page)
  await runAgentFileTask(app, page, 'dsh-agent-result.txt', true)
})

test('[A-01] 默认 Agent 完成 PPT 任务 @agent-ppt', async ({ app, mainWindow: page }) => {
  await ensureAgentModel(app, page)
  await selectSidebarApp(page, 'Work')
  await page.getByText('Cherry Assistant', { exact: true }).first().click()
  const newTask = page.getByRole('button', { name: 'New task', exact: true }).last()
  if (await newTask.isVisible().catch(() => false)) await newTask.click()

  const model = page.getByRole('button', { name: /Select Model|Selected models/ }).first()
  if (await model.isVisible().catch(() => false)) {
    await model.click()
    await page.getByTestId('model-selector-search').fill(app.config.cherryIn.chatModel)
    await page.getByRole('option').filter({ hasText: app.config.cherryIn.chatModel }).first().click()
  }
  await selectAgentWorkspace(app, page)

  await page
    .locator('[data-ui="chat.composer"] [contenteditable="true"]')
    .first()
    .fill(
      'Use a real web search about Cherry Studio, then create cherry-regression-31415.pptx in the current working directory. Its exact title must be Cherry Regression 31415 and it must contain exactly three slides. Open the generated deck after creating it.'
    )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const allow = page.getByRole('button', { name: /Allow/ }).first()
  if (await allow.isVisible({ timeout: 60_000 }).catch(() => false)) await allow.click()

  const output = join(app.paths.workspace, 'cherry-regression-31415.pptx')
  await expect
    .poll(
      async () => {
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
      { timeout: 5 * 60_000 }
    )
    .toBe(true)
  await expect(page.getByText('cherry-regression-31415.pptx', { exact: true })).toBeVisible()
})
