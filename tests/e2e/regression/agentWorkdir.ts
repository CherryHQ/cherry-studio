import { realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectAgent } from './helpers/agents'
import { selectVisibleModel } from './helpers/models'
import { selectSidebarApp } from './helpers/navigation'
import type { RegressionApp } from './RegressionApp'

export async function agentWorkdir(app: RegressionApp, initialPage: Page, info: TestInfo): Promise<void> {
  let page = initialPage
  const server = await startMockChatServer()
  const providerId = `mp49-${Date.now()}`
  const name = app.resourceName('QA-Agent')
  const prompt = 'Help with the selected working directory.'
  // A clean checkout has no directory to point at, so the case owns one under the run workspace.
  const caseWorkspace = join(app.paths.workspace, 'code')
  await mkdir(caseWorkspace, { recursive: true })
  const workspacePath = realpathSync(caseWorkspace)
  const preferences = await page.evaluate(async () => ({
    menu: await window.api.preference.get('menu.presentation_mode'),
    display: await window.api.preference.get('agent.session.display_mode')
  }))
  let agentId: string | undefined
  const model = createUniqueModelId(providerId, server.modelId)
  info.annotations.push({
    type: 'uncovered',
    description: 'Missing-directory warning requires an inaccessible workspace fixture.'
  })
  try {
    const statuses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const request = window.api.dataApi.request
        const provider = await request({
          id: 'mp49-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-49 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await request({
          id: 'mp49-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await request({
          id: 'mp49-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, enabled.status, model.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(statuses).toEqual([201, 200, 201])
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'menu.presentation_mode': 'cherry', 'agent.session.display_mode': 'agent' })
    )
    const registered = (await page.evaluate(
      (path) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name: 'code' }),
      workspacePath
    )) as { ok: boolean }
    expect(registered.ok).toBe(true)
    await page.reload()
    await selectSidebarApp(page, 'Work')
    const view = () => page.locator('[data-ui~="agent.view"]:visible').first()
    const showSidebar = view().getByRole('button', { name: 'Show Sidebar', exact: true })
    if (await showSidebar.isVisible()) await showSidebar.click()
    const displayMode = view().getByRole('button', { name: 'Display mode', exact: true })
    if (await displayMode.isVisible()) {
      await displayMode.click()
      await page.getByRole('button', { name: 'Agent', exact: true }).click()
    }
    await view().getByRole('button', { name: 'Add Agent', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New Agent' })
    await dialog.getByPlaceholder('Enter a name').fill(name)
    await dialog.locator('[aria-label="Model"]').click()
    await selectVisibleModel(page, server.modelId, providerId)
    await dialog.getByRole('button', { name: 'Next', exact: true }).click()
    await dialog.locator('.cm-content[contenteditable="true"]').fill(prompt)
    while (await dialog.getByRole('button', { name: 'Next', exact: true }).isVisible()) {
      await dialog.getByRole('button', { name: 'Next', exact: true }).click()
    }
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(view().getByRole('button', { name, exact: true }).first()).toBeVisible()
    await view().getByRole('button', { name: 'No work directory', exact: true }).click()
    await page.getByText('code', { exact: true }).last().click()
    await expect(view().getByRole('button', { name: 'code', exact: true }).last()).toBeVisible()
    const screenshot = async (label: string) => {
      const path = info.outputPath(`${label}.png`)
      await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
      await info.attach(label, { path, contentType: 'image/png' })
    }
    await view().getByRole('button', { name: 'code', exact: true }).last().click()
    await expect(page.getByRole('option', { name: 'code', exact: true })).toHaveAttribute('aria-selected', 'true')
    await screenshot('MP-49 workspace before restart')
    await page.keyboard.press('Escape')
    const agents = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp49-agents', method: 'GET', path: '/agents', params: { limit: 500 } })
    )
    const agent = (agents.data as { items: { id: string; name: string; model: string }[] }).items.find(
      (item) => item.name === name
    )
    expect(agent).toMatchObject({ name, model })
    agentId = agent!.id
    const sessions = await page.evaluate(() =>
      window.api.dataApi.request({
        id: 'mp49-sessions',
        method: 'GET',
        path: '/agent-sessions',
        params: { limit: 200 }
      })
    )
    expect(sessions.status).toBe(200)
    const session = (
      sessions.data as { items: { id: string; agentId: string; workspace: { path: string }; name: string }[] }
    ).items.find((item) => item.agentId === agent!.id && item.workspace.path === workspacePath)
    expect(session).toBeDefined()
    page = await app.restart()
    await selectSidebarApp(page, 'Work')
    await selectAgent(page, name)
    const row = page.getByTestId('agent-session-row').filter({ hasText: session!.name }).first()
    await row.click()
    await expect(view().getByRole('button', { name: 'code', exact: true }).last()).toBeVisible()
    const persistedSession = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp49-session-after', method: 'GET', path: `/agent-sessions/${id}` }),
      session!.id
    )
    expect(persistedSession.status).toBe(200)
    expect(persistedSession.data).toMatchObject({ agentId: agent!.id, workspace: { path: workspacePath } })
    const persisted = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp49-agent-after', method: 'GET', path: `/agents/${id}` }),
      agent!.id
    )
    expect(persisted.data).toMatchObject({ name, model })
    await view().getByRole('button', { name: 'code', exact: true }).last().click()
    await expect(page.getByRole('option', { name: 'code', exact: true })).toHaveAttribute('aria-selected', 'true')
    await screenshot('MP-49 workspace after restart')
    await page.keyboard.press('Escape')
  } finally {
    await server.close()
    // This case creates an agent, its sessions and a provider inside a reused profile: remove them
    // so a repeat in the same profile cannot collide with its own leftovers.
    await page.evaluate(
      async ({ agentId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'menu.presentation_mode': preferences.menu,
          'agent.session.display_mode': preferences.display
        })
        if (agentId) {
          const result = (await window.api.ipcApi.request('ai.agent.delete_permanently', {
            agentId,
            deleteSessions: true
          })) as IpcResult<{ deleted: boolean }>
          if (!result.ok || !result.data.deleted) throw new Error('cleanup left the case agent readable')
        }
        await window.api.dataApi.request({ id: 'mp49-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { agentId, providerId, preferences }
    )
  }
}
