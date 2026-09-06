import { join } from 'node:path'

import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect } from './fixture'
import { selectSidebarApp } from './helpers'
import { selectVisibleModel } from './models'
import { chooseNativeFile } from '../../../scripts/cherry-regression-test/system-automation'

export async function selectAgent(page: Page, name: string): Promise<void> {
  await selectSidebarApp(page, 'Work')
  const agentView = page.locator('[data-ui="agent.view"]:visible').first()
  await expect(agentView).toBeVisible({ timeout: 30_000 })
  const agent = agentView.getByText(name, { exact: true }).first()
  await expect(agent).toBeVisible()
  await agent.click({ noWaitAfter: true })
}

export async function startNewAgentTask(page: Page, name: string): Promise<void> {
  await selectAgent(page, name)
  const agentView = page.locator('[data-ui="agent.view"]:visible').first()
  const agentHeader = agentView.getByRole('button', { name, exact: true }).first()
  await agentHeader.hover()
  const newTask = agentHeader.locator('..').getByRole('button', { name: 'New task', exact: true })
  await expect(newTask).toBeVisible()
  await newTask.click()
  await expect(page.locator('[data-ui~="chat.message"]:visible')).toHaveCount(0, { timeout: 30_000 })
}

export async function createAgent(
  app: RegressionApp,
  page: Page,
  options: { name: string; runtime: string; permission?: string }
): Promise<void> {
  await selectSidebarApp(page, 'Work')
  const agentView = page.locator('[data-ui="agent.view"]:visible').first()
  await expect(agentView).toBeVisible({ timeout: 30_000 })
  if (
    await agentView
      .getByText(options.name, { exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await agentView.getByText(options.name, { exact: true }).first().click({ noWaitAfter: true })
    return
  }

  await agentView.getByRole('button', { name: 'Add Agent', exact: true }).click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(options.name)
  await dialog.getByLabel('Runtime mode').getByText(options.runtime, { exact: true }).click()
  if (options.permission) {
    const permission = dialog.getByRole('combobox', { name: 'Permission mode', exact: true })
    await permission.click()
    await dialog.getByText(options.permission, { exact: true }).last().click()
  }
  await dialog.getByRole('button', { name: 'Model', exact: true }).click()
  await selectVisibleModel(page, app.config.cherryIn.chatModel)
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(agentView.getByText(options.name, { exact: true }).first()).toBeVisible()
}

export async function selectAgentWorkspace(app: RegressionApp, page: Page): Promise<void> {
  const current = page.getByRole('button', { name: /No work directory|agent-workspace/, exact: true })
  if ((await current.textContent())?.includes('agent-workspace')) return
  await current.click()
  const existing = page.getByText('agent-workspace', { exact: true })
  if (await existing.isVisible().catch(() => false)) {
    await existing.click()
  } else {
    await page.getByText('Add new work directory', { exact: true }).click()
    chooseNativeFile(app.record.platform, app.paths, app.paths.workspace)
  }
  await expect(page.getByRole('button', { name: 'agent-workspace', exact: true })).toBeVisible({ timeout: 30_000 })
}

export async function runAgentFileTask(
  app: RegressionApp,
  page: Page,
  fileName: string,
  approve: boolean
): Promise<void> {
  const output = join(app.paths.workspace, fileName)
  const promptPath = output.replaceAll('\\', '/')
  const prompt = `Create the file at the exact absolute path ${JSON.stringify(promptPath)} with the exact text AGENT_FILE_TASK_PASS.`
  const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
  const messages = page.locator('[data-ui~="chat.message"]:visible')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retryPrefix = attempt === 0 ? '' : 'The previous task completed without creating the required file. '
    await composer.fill(`${retryPrefix}${prompt}`)
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    let outcome: 'completed' | 'created' | 'running' = 'running'
    await expect
      .poll(
        async () => {
          if (approve) {
            const allow = page.getByRole('button', { name: /Allow/ }).first()
            if (await allow.isVisible().catch(() => false)) await allow.click()
          }
          try {
            const { validateFileEvidence } = await import('../../../scripts/cherry-regression-test/file-evidence')
            await validateFileEvidence(output, { expectedText: 'AGENT_FILE_TASK_PASS', type: 'text' })
            outcome = 'created'
          } catch {
            outcome = (await messages
              .last()
              .getByTestId('completed-process-trigger')
              .isVisible()
              .catch(() => false))
              ? 'completed'
              : 'running'
          }
          return outcome
        },
        { timeout: 5 * 60_000 }
      )
      .not.toBe('running')
    if (outcome === 'created') return
  }

  const { validateFileEvidence } = await import('../../../scripts/cherry-regression-test/file-evidence')
  await validateFileEvidence(output, { expectedText: 'AGENT_FILE_TASK_PASS', type: 'text' })
}
