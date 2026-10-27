import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { type AgentWorkspaceEntity, AgentWorkspaceEntitySchema } from '@shared/data/api/schemas/agentWorkspaces'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { createAgent, startNewAgentTask } from '../helpers/agents'
import { ensureCustomChatProvider } from '../helpers/models'
import { selectSidebarApp } from '../helpers/navigation'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function workspaceLifecycle(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const suffix = Date.now()
  // Both preferences are shared with later cases: this case ends in work-directory mode, which
  // hides the Agent sessions list that Agent helpers rely on, so the original values come back.
  const previousPreferences = await page.evaluate(async () => ({
    displayMode: await window.api.preference.get('agent.session.display_mode'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const originalName = `MP53 original ${suffix}`
  const renamedName = `MP53 renamed ${suffix}`
  const emptyName = `MP53 empty ${suffix}`
  const targetName = `MP53 target ${suffix}`
  const originalPath = join(app.paths.workspace, `original-${suffix}`)
  const emptyPath = join(app.paths.workspace, `empty-${suffix}`)
  const targetPath = join(app.paths.workspace, `target-${suffix}`)
  const register = async (path: string, name: string) => {
    const result = (await page.evaluate(
      ({ path, name }) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name }),
      { path, name }
    )) as { ok: boolean; data: unknown }
    expect(result.ok).toBe(true)
    return AgentWorkspaceEntitySchema.parse(result.data)
  }
  const readWorkspaces = async () => {
    const response = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'MP53-workspaces', method: 'GET', path: '/agent-workspaces' })
    )
    expect(response.status).toBe(200)
    return response.data as AgentWorkspaceEntity[]
  }

  const agentName = app.resourceName(`Workspace Agent ${suffix}`)
  const ownedPaths = [originalPath, emptyPath, targetPath]
  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    await mkdir(originalPath)
    await writeFile(join(originalPath, 'baseline.txt'), 'MP53 original workspace')
    await mkdir(emptyPath)
    expect(await readdir(emptyPath)).toEqual([])
    const original = await register(originalPath, originalName)
    const empty = await register(emptyPath, emptyName)
    // A real provider and runtime execute the relative-path write; no successful tool result is injected.
    await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await selectSidebarApp(page, 'Work')
    const view = page.locator('[data-ui~="agent.view"]:visible').first()
    await view.getByRole('button', { name: 'Display mode', exact: true }).click()
    await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await createAgent(page, {
      name: agentName,
      runtime: 'Pi',
      model: app.config.customProvider.chatModel,
      permission: 'Full Access'
    })
    await view.getByRole('button', { name: 'No work directory', exact: true }).click()
    await page.locator(`[data-option-id="${original.id}"]`).click()
    await expect(view.getByRole('button', { name: originalName, exact: true }).last()).toBeVisible()

    await view.getByRole('button', { name: 'Display mode', exact: true }).click()
    await page.getByRole('button', { name: 'Work directory', exact: true }).click()
    const group = view.getByRole('button', { name: originalName, exact: true }).first()
    await expect(group).toBeVisible()
    await group.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename work directory', exact: true }).click()
    const rename = page.getByRole('dialog', { name: 'Rename work directory', exact: true })
    await rename.getByLabel('Name', { exact: true }).fill(renamedName)
    await rename.getByLabel('Name', { exact: true }).press('Enter')
    await expect(rename).toBeHidden()
    await expect(view.getByRole('button', { name: renamedName, exact: true }).first()).toBeVisible()
    await expect.poll(async () => (await readWorkspaces()).find(({ id }) => id === original.id)?.name).toBe(renamedName)
    await screenshot('MP-53 workspace renamed immediately')

    await page.reload()
    await selectSidebarApp(page, 'Work')
    await expect(view.getByRole('button', { name: renamedName, exact: true }).first()).toBeVisible()
    expect((await readWorkspaces()).find(({ id }) => id === original.id)).toMatchObject({
      name: renamedName,
      path: originalPath
    })
    const renamedTrigger = view.getByRole('button', { name: renamedName, exact: true }).last()
    await expect(renamedTrigger).toBeVisible()

    await mkdir(targetPath)
    const target = await register(targetPath, targetName)
    await renamedTrigger.click()
    await page.locator(`[data-option-id="${target.id}"]`).click()
    await expect(view.getByRole('button', { name: targetName, exact: true }).last()).toBeVisible()
    const fileName = 'MP53-relative-result.txt'
    const marker = `MP53_DIRECTORY_SWITCH_${suffix}`
    const editor = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    await editor.fill(
      `Use your filesystem tool to create the relative file ${fileName} in your current working directory, ` +
        `containing exactly ${marker} with no newline. Do not use an absolute path or change directories. ` +
        'Then reply MP53_WRITE_DONE.'
    )
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect
      .poll(
        () =>
          readFile(join(targetPath, fileName), 'utf8').catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          }),
        { timeout: 150_000 }
      )
      .toBe(marker)
    await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
    expect(await readdir(originalPath)).not.toContain(fileName)
    expect(await readdir(emptyPath)).toEqual([])
    await screenshot('MP-53 real tool wrote in switched workspace')

    await view.getByRole('button', { name: 'Display mode', exact: true }).click()
    await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await startNewAgentTask(page, agentName)
    await view
      .getByRole('button', { name: new RegExp(`^No work directory$|^${targetName}$`) })
      .last()
      .click()
    const emptyRow = page.locator(`[data-option-row="${empty.id}"]`)
    await expect(emptyRow).toBeVisible()
    await emptyRow.hover()
    await emptyRow.getByRole('button', { name: 'Delete work directory', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: 'Delete work directory', exact: true })
    await expect(deletion).toBeVisible()
    await expect(deletion).toContainText(emptyName)
    await expect(deletion).toContainText('The folder on disk and its files will not be deleted.')
    await expect(deletion).toContainText(emptyPath)
    await expect(deletion).toContainText('No sessions will be deleted.')
    expect((await readWorkspaces()).some(({ id }) => id === empty.id)).toBe(true)
    await screenshot('MP-53 deletion explicitly preserves disk files')
    await deletion.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(deletion).toBeHidden()
    await expect.poll(async () => (await readWorkspaces()).some(({ id }) => id === empty.id)).toBe(false)
    await page.reload()
    await selectSidebarApp(page, 'Work')
    await view.getByRole('button', { name: 'Display mode', exact: true }).click()
    await page.getByRole('button', { name: 'Work directory', exact: true }).click()
    await expect(view.getByRole('button', { name: emptyName, exact: true })).toHaveCount(0)
    expect((await stat(emptyPath)).isDirectory()).toBe(true)
    expect(await readdir(emptyPath)).toEqual([])
    expect(await readFile(join(targetPath, fileName), 'utf8')).toBe(marker)
    expect((await readWorkspaces()).find(({ id }) => id === original.id)?.name).toBe(renamedName)
    await screenshot('MP-53 workspace removed and disk directory preserved')
  } finally {
    await page.evaluate(
      async ({ previous, agentName, ownedPaths }) => {
        await window.api.preference.setMultiple({
          'agent.session.display_mode': previous.displayMode,
          'menu.presentation_mode': previous.menuMode
        })
        const agents = await window.api.dataApi.request({
          id: 'mp53-cleanup-agents',
          method: 'GET',
          path: '/agents',
          params: { limit: 500 }
        })
        if (agents.status !== 200) throw new Error('Could not list the case Agent for cleanup')
        for (const agent of (agents.data as { items: { id: string; name: string }[] }).items.filter(
          ({ name }) => name === agentName
        )) {
          const deleted = (await window.api.ipcApi.request('ai.agent.delete_permanently', {
            agentId: agent.id,
            deleteSessions: true
          })) as IpcResult<{ deleted: boolean }>
          if (!deleted.ok || !deleted.data.deleted) throw new Error('Case Agent cleanup failed')
        }
        const workspaces = await window.api.dataApi.request({
          id: 'mp53-cleanup-workspaces',
          method: 'GET',
          path: '/agent-workspaces'
        })
        if (workspaces.status !== 200) throw new Error('Could not list case workspaces for cleanup')
        for (const workspace of (workspaces.data as AgentWorkspaceEntity[]).filter(({ path }) =>
          ownedPaths.includes(path)
        )) {
          const removed = (await window.api.ipcApi.request('ai.agent.workspace.delete', {
            workspaceId: workspace.id
          })) as IpcResult<{ deletedIds: string[] }>
          if (!removed.ok) throw new Error('Case workspace cleanup failed')
        }
        const remaining = await window.api.dataApi.request({
          id: 'mp53-cleanup-verify',
          method: 'GET',
          path: '/agent-workspaces'
        })
        if (
          remaining.status !== 200 ||
          (remaining.data as AgentWorkspaceEntity[]).some(({ path }) => ownedPaths.includes(path))
        )
          throw new Error('Case workspace registrations remain after cleanup')
      },
      { previous: previousPreferences, agentName, ownedPaths }
    )
    await Promise.all(ownedPaths.map((path) => rm(path, { recursive: true, force: true })))
  }
}
