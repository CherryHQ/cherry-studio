import { rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { OffsetPaginationResponse } from '@shared/data/api/types'

import { chooseNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { selectVisibleModel } from './models'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function getBuiltinAssistantAgent(page: Page): Promise<{ id: string; name: string }> {
  const deadline = Date.now() + 30_000
  const matches: { id: string; name: string }[] = []
  const seen = new Set<string>()
  let observed = 'no response'
  const fail = (reason: string): never => {
    throw new Error(
      `Builtin assistant resolution failed: ${reason}; matches=${matches.length}, entities=${seen.size}; ${observed}`
    )
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        let expectedTotal: number | undefined
        for (let pageNumber = 1; ; pageNumber += 1) {
          if (Date.now() >= deadline) fail('30s deadline exceeded')
          const response = await page
            .evaluate(
              (pageNumber) =>
                window.api.dataApi.request({
                  id: `builtin-assistant-page-${pageNumber}`,
                  method: 'GET',
                  path: '/agents',
                  params: { page: pageNumber, limit: 100 }
                }),
              pageNumber
            )
            .catch((error) => fail(`request rejected on page ${pageNumber}: ${String(error)}`))
          observed = `status=${response.status}, requestedPage=${pageNumber}`
          if (response.status !== 200 || !response.data) return fail('unsuccessful response')
          const data = response.data as OffsetPaginationResponse<AgentEntity>
          observed += `, page=${data.page}, total=${data.total}, items=${Array.isArray(data.items) ? data.items.length : 'invalid'}`
          expectedTotal ??= data.total
          if (
            !Array.isArray(data.items) ||
            data.page !== pageNumber ||
            data.total !== expectedTotal ||
            !Number.isInteger(data.total) ||
            data.total < 0
          ) {
            fail('inconsistent pagination')
          }
          for (const agent of data.items) {
            if (seen.has(agent.id)) fail('duplicate entity across pages')
            seen.add(agent.id)
            if (agent.configuration?.builtin_role === 'assistant') matches.push({ id: agent.id, name: agent.name })
          }
          if (seen.size > data.total) fail('entity count exceeds total')
          if (seen.size === data.total) break
          if (data.items.length === 0) fail('pagination made no progress')
        }
        if (matches.length !== 1) return fail('expected exactly one builtin assistant')
        return matches[0]
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Builtin assistant resolution exceeded 30s; matches=${matches.length}, entities=${seen.size}; ${observed}`
              )
            ),
          30_000
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function selectAgent(page: Page, name: string): Promise<void> {
  await selectSidebarApp(page, 'Work')
  const agentView = page.locator('[data-ui~="agent.view"]:visible')
  await expect(agentView).toHaveCount(1, { timeout: 30_000 })
  await expect(agentView).toBeVisible({ timeout: 30_000 })
  const agent = agentView.getByText(name, { exact: true }).filter({ visible: true })
  await expect(agent).toHaveCount(1)
  await expect(agent).toBeVisible()
  await agent.click({ noWaitAfter: true })
  await expect(agentView.getByRole('button', { name, exact: true })).toHaveCount(1)
}

export async function startNewAgentTask(page: Page): Promise<void> {
  const { name } = await getBuiltinAssistantAgent(page)
  await selectAgent(page, name)
  const agentView = page.locator('[data-ui~="agent.view"]:visible')
  const agentHeader = agentView.getByRole('button', { name, exact: true })
  await expect(agentHeader).toHaveCount(1)
  await agentHeader.hover()
  const newTask = agentHeader.locator('..').getByRole('button', { name: 'New task', exact: true })
  await expect(newTask).toBeVisible()
  await newTask.click()
  await expect(page.locator('[data-ui~="chat.message"]:visible')).toHaveCount(0, { timeout: 30_000 })
}

export async function createAgent(
  page: Page,
  options: { name: string; runtime: string; model: string; permission?: string }
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
  await dialog.getByPlaceholder('Enter a name', { exact: true }).fill(options.name)
  await dialog.getByLabel('Runtime mode').getByText(options.runtime, { exact: true }).click()
  if (options.permission) {
    const permission = dialog.getByRole('combobox', { name: 'Permission mode', exact: true })
    await permission.click()
    await dialog.getByText(options.permission, { exact: true }).last().click()
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
            const { validateFileEvidence } = await import('../../../scripts/e2e/regression/fileEvidence')
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

  const { validateFileEvidence } = await import('../../../scripts/e2e/regression/fileEvidence')
  await validateFileEvidence(output, { exactText: 'AGENT_FILE_TASK_PASS', type: 'text' })
}
