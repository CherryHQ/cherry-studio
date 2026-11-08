import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { isPathInside } from '../../../../scripts/e2e/regression/paths'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { createAgent, openAgentPane, selectAgentWorkspace } from '../helpers/agents'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function agentStatusPanel(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const folderPath = await mkdtemp(join(app.paths.workspace, 'MP55-inputs-'))
  if (!isPathInside(app.paths.workspace, folderPath)) throw new Error('Case files must stay inside the owned workspace')
  const folderName = basename(folderPath)
  const agentName = app.resourceName(`Status Panel Agent ${Date.now()}`)
  const files = [
    { name: 'orchard.md', text: '# Orchard\nThe orchard harvested 37 apples.\n', fact: '37' },
    { name: 'warehouse.md', text: '# Warehouse\nThe warehouse received 19 pears.\n', fact: '19' }
  ]
  try {
    for (const file of files) await writeFile(join(app.paths.workspace, folderName, file.name), file.text)

    await page.evaluate(({ path, name }) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name }), {
      path: app.paths.workspace,
      name: app.workspaceName
    })

    // Real provider and real filesystem tools; no task, tool, or context events are injected.
    const providerId = await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await createAgent(page, {
      name: agentName,
      runtime: 'Claude Agent',
      providerId,
      model: app.config.customProvider.chatModel,
      permission: 'Full Access'
    })
    const enableGateway = page.getByRole('button', { name: 'Enable', exact: true })
    await enableGateway.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined)
    if (await enableGateway.isVisible()) await enableGateway.click()
    await selectAgentWorkspace(app, page)
    const view = page.locator('[data-ui~="agent.view"]:visible').first()
    const panel = page.locator('[data-right-pane]:visible').last()
    await openAgentPane(page, 'Status')
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
        expect(
          progressSamples.some((sample) => sample.total === 3 && sample.completed > 0 && sample.completed < 3)
        ).toBe(true)
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
    const context = panel.locator('section').filter({ has: page.getByRole('heading', { name: 'Context usage' }) })
    await expect.soft(context).toContainText(/[\d,]+\s*\/\s*[\d,]+\s*\(\d+%\)/, { timeout: 15_000 })
    for (const category of ['System prompt', 'Messages']) {
      const row = context
        .locator('div')
        .filter({ has: page.getByText(category, { exact: true }) })
        .last()
      await expect.soft(row).toContainText(/[\d,]+\s*\(\d+%\)/, { timeout: 10_000 })
    }
    await screenshot('MP-55 completed task and context categories')

    await openAgentPane(page, 'Files')
    const tree = page.getByRole('tree')
    const folder = tree.getByRole('treeitem').filter({ hasText: folderName })
    await expect(folder).toBeVisible()
    if ((await folder.getAttribute('aria-expanded')) !== 'false') await folder.click()
    await expect(folder).toHaveAttribute('aria-expanded', 'false')
    await expect(tree.getByRole('treeitem').filter({ hasText: files[0].name })).toHaveCount(0)
    await folder.click()
    await expect(folder).toHaveAttribute('aria-expanded', 'true')
    for (const file of files) await expect(tree.getByRole('treeitem').filter({ hasText: file.name })).toBeVisible()
    await tree.getByRole('treeitem').filter({ hasText: files[0].name }).click()
    const preview = page.getByTestId('artifact-file-preview-overlay')
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('The orchard harvested 37 apples.')
    await expect(page.getByTestId('artifact-pane-header-title')).toHaveAttribute(
      'title',
      join(app.paths.workspace, folderName, files[0].name)
    )
    await screenshot('MP-55 expanded workspace and correct file preview path')
  } finally {
    const cleanupErrors = await page
      .evaluate(async (name) => {
        const errors: string[] = []
        const agents = await window.api.dataApi.request({
          id: 'mp55-cleanup-agents',
          method: 'GET',
          path: '/agents',
          params: { limit: 500 }
        })
        if (agents.status !== 200) return ['Cannot list case agents for cleanup']
        const ownedAgents = (agents.data as { items: AgentEntity[] }).items.filter((agent) => agent.name === name)
        const sessions = await window.api.dataApi.request({
          id: 'mp55-cleanup-sessions',
          method: 'GET',
          path: '/agent-sessions',
          params: { limit: 200 }
        })
        if (sessions.status !== 200) return ['Cannot list case sessions for cleanup']
        const ownedSessions = (sessions.data as { items: AgentSessionEntity[] }).items.filter((session) =>
          ownedAgents.some((agent) => agent.id === session.agentId)
        )
        for (const session of ownedSessions) {
          const stopped = (await window.api.ipcApi.request('ai.stream.abort', {
            topicId: `agent-session:${session.id}`
          })) as IpcResult<void>
          if (!stopped.ok) errors.push(`Cannot stop case session ${session.id}`)
        }
        for (const agent of ownedAgents) {
          const deleted = (await window.api.ipcApi.request('ai.agent.delete_permanently', {
            agentId: agent.id,
            deleteSessions: true
          })) as IpcResult<{ deleted: boolean }>
          if (!deleted.ok || !deleted.data.deleted) errors.push(`Cannot delete case agent ${agent.id}`)
        }
        const remaining = await window.api.dataApi.request({
          id: 'mp55-verify-cleanup',
          method: 'GET',
          path: '/agents',
          params: { limit: 500 }
        })
        if (
          remaining.status !== 200 ||
          (remaining.data as { items: AgentEntity[] }).items.some((agent) => agent.name === name)
        )
          errors.push('Cleanup left the case agent active')
        return errors
      }, agentName)
      .catch((error) => [String(error)])
    await rm(folderPath, { recursive: true, force: true }).catch((error) => cleanupErrors.push(String(error)))
    expect.soft(cleanupErrors, 'Case cleanup must not leave resources or mask the original failure').toEqual([])
  }
}
