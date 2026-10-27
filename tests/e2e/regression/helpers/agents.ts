import { rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import {
  type BuiltinAssistantAgent,
  type BuiltinAssistantAgentIdentity,
  resolveBuiltinAssistantAgent
} from '../../../../scripts/e2e/regression/builtinAgents'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import type { RegressionApp } from '../RegressionApp'
import { selectVisibleModel } from './models'
import { selectSidebarApp } from './navigation'
import { revealVirtualized } from './virtualList'

/**
 * Resolve the seeded built-in assistant Agent by identity rather than by its
 * display name: the seeder names it after the system language ("Cherry 小助手"
 * for Chinese systems) and switching the UI language does not rename the row.
 */
export async function builtinAssistantAgent(page: Page): Promise<BuiltinAssistantAgent> {
  const agents = await page.evaluate(() =>
    window.api.dataApi.request({
      id: 'builtin-assistant-agent',
      method: 'GET',
      path: '/agents',
      params: { limit: 500 }
    })
  )
  expect(agents.status).toBe(200)
  return resolveBuiltinAssistantAgent(
    agents.data as { page: number; total: number; items: BuiltinAssistantAgentIdentity[] }
  )
}

async function showAgentList(page: Page): Promise<Locator> {
  await selectSidebarApp(page, 'Work')
  const view = page.locator('[data-ui~="agent.view"]:visible')
  await expect(view).toHaveCount(1, { timeout: 30_000 })
  const showSidebar = view.getByRole('button', { name: 'Show Sidebar', exact: true })
  if (await showSidebar.isVisible()) await showSidebar.click()
  const displayMode = view.getByRole('button', { name: 'Display mode', exact: true })
  if (await displayMode.isVisible()) {
    await displayMode.click()
    await page.locator('[data-slot="menu-item"]').getByText('Agent', { exact: true }).click()
  }
  return view
}

export async function selectAgent(page: Page, name: string): Promise<void> {
  const view = await showAgentList(page)
  const entry = view
    .locator('div[class~="group/resource-list-group"]')
    .filter({
      has: page.getByRole('button', {
        name,
        exact: true
      })
    })
    .filter({
      has: page.getByRole('button', {
        name: 'New task',
        exact: true,
        includeHidden: true
      })
    })
  await revealVirtualized(page, view.locator('[data-virtual-scrolling]').first(), entry)
  await expect(entry).toHaveCount(1)
  const header = entry.getByRole('button', {
    name,
    exact: true
  })
  await expect(header).toHaveCount(1)
  await header.click({ noWaitAfter: true })
}

export async function startNewAgentTask(page: Page, name: string): Promise<void> {
  await selectAgent(page, name)
  const view = page.locator('[data-ui~="agent.view"]:visible')
  await expect(view).toHaveCount(1, { timeout: 30_000 })
  const entry = view.locator('div[class~="group/resource-list-group"]').filter({
    has: page.getByRole('button', {
      name,
      exact: true
    })
  })
  await expect(entry).toHaveCount(1)
  const header = entry.getByRole('button', {
    name,
    exact: true
  })
  await expect(header).toHaveCount(1)
  await header.hover()
  const newTask = entry.getByRole('button', {
    name: 'New task',
    exact: true
  })
  await expect(newTask).toBeVisible()
  await newTask.click()

  await expect(page.locator('[data-ui~="chat.message"]:visible')).toHaveCount(0, { timeout: 30_000 })
}

export async function openAgentPane(page: Page, name: 'Files' | 'Status'): Promise<void> {
  const toggle = page.locator('[data-ui~="agent.view"]:visible').getByRole('button', { name, exact: true })
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
}

export async function createAgent(
  page: Page,
  options: { name: string; runtime: string; model: string; permission?: string }
): Promise<void> {
  const agentView = await showAgentList(page)
  const agents = await page.evaluate(() =>
    window.api.dataApi.request({
      id: 'existing-regression-agent',
      method: 'GET',
      path: '/agents',
      params: { limit: 500 }
    })
  )
  expect(agents.status).toBe(200)
  if ((agents.data as { items: { name: string }[] }).items.some(({ name }) => name === options.name)) {
    await selectAgent(page, options.name)
    return
  }

  await agentView.getByRole('button', { name: 'Add Agent', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New Agent', exact: true })
  await dialog.getByPlaceholder('Enter a name', { exact: true }).fill(options.name)
  await dialog.getByLabel('Runtime mode').getByText(options.runtime, { exact: true }).click()
  if (options.permission) {
    const permission = dialog.getByRole('combobox', { name: 'Permission mode', exact: true })
    await permission.click()
    await page.getByRole('option').filter({ hasText: options.permission }).click()
    if (options.permission === 'Full Access') {
      await page
        .getByRole('dialog', { name: 'Enable Full Access?', exact: true })
        .getByRole('button', { name: 'Enable Full Access', exact: true })
        .click()
    }
    await expect(permission).toHaveText(options.permission)
  }
  await dialog.getByRole('button', { name: 'Model', exact: true }).click()
  await selectVisibleModel(page, options.model)
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(agentView.getByText(options.name, { exact: true }).first()).toBeVisible()
}

export async function selectAgentWorkspace(app: RegressionApp, page: Page): Promise<void> {
  const current = page.getByRole('button', { name: new RegExp(`No work directory|${app.workspaceName}`), exact: true })
  if ((await current.textContent())?.includes(app.workspaceName)) return
  await current.click()
  const existing = page.getByText(app.workspaceName, { exact: true })
  if (await existing.isVisible().catch(() => false)) {
    await existing.click()
  } else {
    await page.getByText('Add new work directory', { exact: true }).click()
    chooseNativeFile(app.record.platform, app.paths, app.paths.workspace)
  }
  await expect(page.getByRole('button', { name: app.workspaceName, exact: true })).toBeVisible({ timeout: 30_000 })
}

export async function runAgentFileTask(
  app: RegressionApp,
  page: Page,
  fileName: string,
  approve: boolean,
  timeout = 5 * 60_000
): Promise<void> {
  const output = join(app.paths.workspace, fileName)
  rmSync(output, { force: true })
  const promptPath = output.replaceAll('\\', '/')
  const prompt = `Create the file at the exact absolute path ${JSON.stringify(promptPath)} containing only AGENT_FILE_TASK_PASS, with no extra text or trailing newline.`
  const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
  const messages = page.locator('[data-ui~="chat.message"]:visible')

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retryPrefix = attempt === 0 ? '' : 'The previous task completed without creating the required file. '
    await composer.fill(`${retryPrefix}${prompt}`)
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    let created = false
    await expect
      .poll(
        async () => {
          if (approve) {
            const allow = page.getByRole('button', { name: /Allow/ }).first()
            if (await allow.isVisible().catch(() => false)) await allow.click()
          }
          try {
            const { validateFileEvidence } = await import('../../../../scripts/e2e/regression/fileEvidence')
            await validateFileEvidence(output, { exactText: 'AGENT_FILE_TASK_PASS', type: 'text' })
            created = true
          } catch {
            created = false
          }
          return await messages
            .last()
            .getByTestId('completed-process-trigger')
            .isVisible()
            .catch(() => false)
        },
        { timeout }
      )
      .toBe(true)
    if (created) {
      return
    }
  }

  const { validateFileEvidence } = await import('../../../../scripts/e2e/regression/fileEvidence')
  await validateFileEvidence(output, { exactText: 'AGENT_FILE_TASK_PASS', type: 'text' })
}
