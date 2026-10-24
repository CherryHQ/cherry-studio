import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { createAgent, selectAgentWorkspace } from './agents'
import { ensureCustomChatProvider } from './models'
import type { RegressionApp } from './RegressionApp'
import { closeSettings } from './settings'

export async function agentStatusPanel(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const folderName = 'MP55-inputs'
  const files = [
    { name: 'orchard.md', text: '# Orchard\nThe orchard harvested 37 apples.\n', fact: '37' },
    { name: 'warehouse.md', text: '# Warehouse\nThe warehouse received 19 pears.\n', fact: '19' }
  ]
  await mkdir(join(app.paths.workspace, folderName), { recursive: true })
  for (const file of files) await writeFile(join(app.paths.workspace, folderName, file.name), file.text)

  await page.evaluate(({ path, name }) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name }), {
    path: app.paths.workspace,
    name: app.workspaceName
  })

  // Real provider and real filesystem tools; no task, tool, or context events are injected.
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await createAgent(page, {
    name: app.resourceName('Status Panel Agent'),
    runtime: 'Claude Agent',
    model: app.config.customProvider.chatModel,
    permission: 'Full Access'
  })
  const enableGateway = page.getByRole('button', { name: 'Enable', exact: true })
  await enableGateway.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined)
  if (await enableGateway.isVisible()) await enableGateway.click()
  await selectAgentWorkspace(app, page)
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  const panel = view.locator('[data-right-pane]:visible').last()
  await view.getByRole('button', { name: 'Status', exact: true }).click()
  await expect(panel.getByRole('heading', { name: 'Context usage', exact: true })).toBeVisible()

  const progressSamples: { completed: number; total: number; time: number }[] = []
  const progress = view.getByTestId('agent-task-progress-capsule').getByRole('progressbar')
  const sampleProgress = async () => {
    if (await progress.isVisible()) {
      const completed = Number(await progress.getAttribute('aria-valuenow'))
      const total = Number(await progress.getAttribute('aria-valuemax'))
      if (total > 0) progressSamples.push({ completed, total, time: Date.now() })
    }
  }
  const editor = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  await editor.fill(
    `Read the two files ${files.map((file) => JSON.stringify(join(app.paths.workspace, folderName, file.name))).join(' and ')} and summarize both. ` +
      'Use TaskCreate to create exactly three tasks first: Read orchard, Read warehouse, Summarize both. ' +
      'Use TaskUpdate to mark each in_progress before work and completed immediately after work. ' +
      'Read each file with its own Read tool call, sequentially, not in parallel. ' +
      'Between steps run Bash sleep 3 so progress can be inspected. Do not create any other tasks or files. ' +
      'End with MP55_SUMMARY followed by the two facts from the files.'
  )
  await view.getByRole('button', { name: 'Send', exact: true }).click()
  await expect
    .soft(async () => {
      await sampleProgress()
      expect(progressSamples.some((sample) => sample.total === 3 && sample.completed === 0)).toBe(true)
    })
    .toPass({ timeout: 90_000, intervals: [200] })
  await expect
    .soft(async () => {
      await sampleProgress()
      expect(progressSamples.some((sample) => sample.total === 3 && sample.completed > 0 && sample.completed < 3)).toBe(
        true
      )
    })
    .toPass({ timeout: 90_000, intervals: [200] })
  await screenshot('MP-55 status during multi-step task')

  const response = view.locator('[data-ui~="chat.message"]:visible').filter({ hasText: 'MP55_SUMMARY' }).last()
  await expect(response).toBeVisible({ timeout: 180_000 })
  for (const file of files) await expect(response).toContainText(file.fact)
  await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(progress).toBeHidden()
  await testInfo.attach('MP-55 observed progress', {
    body: JSON.stringify(progressSamples, null, 2),
    contentType: 'application/json'
  })

  const completed = view.getByTestId('completed-process-trigger')
  for (const trigger of await completed.all()) {
    if ((await trigger.getAttribute('data-state')) !== 'open') await trigger.click()
  }
  const messageCards = view.locator('[data-ui~="chat.message"]:visible')
  for (const file of files) {
    await expect.soft(messageCards.getByText(file.name, { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await expect.soft(panel.getByText(file.name, { exact: true })).toHaveCount(1, { timeout: 10_000 })
  }
  const context = view.locator('section').filter({ has: page.getByRole('heading', { name: 'Context usage' }) })
  await expect.soft(context).toContainText(/[\d,]+\s*\/\s*[\d,]+\s*\(\d+%\)/, { timeout: 15_000 })
  for (const category of ['System prompt', 'Messages']) {
    const row = context
      .locator('div')
      .filter({ has: page.getByText(category, { exact: true }) })
      .last()
    await expect.soft(row).toContainText(/[\d,]+\s*\(\d+%\)/, { timeout: 10_000 })
  }
  await screenshot('MP-55 completed task and context categories')

  await view.getByRole('button', { name: 'Files', exact: true }).click()
  const tree = view.getByRole('tree')
  const folder = tree.getByRole('treeitem').filter({ hasText: folderName })
  await expect(folder).toBeVisible()
  if ((await folder.getAttribute('aria-expanded')) !== 'false') await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'false')
  await expect(tree.getByRole('treeitem').filter({ hasText: files[0].name })).toHaveCount(0)
  await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
  for (const file of files) await expect(tree.getByRole('treeitem').filter({ hasText: file.name })).toBeVisible()
  await tree.getByRole('treeitem').filter({ hasText: files[0].name }).click()
  const preview = view.getByTestId('artifact-file-preview-overlay')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('The orchard harvested 37 apples.')
  await expect(view.getByTestId('artifact-pane-header-title')).toHaveAttribute(
    'title',
    join(app.paths.workspace, folderName, files[0].name)
  )
  await screenshot('MP-55 expanded workspace and correct file preview path')
}
