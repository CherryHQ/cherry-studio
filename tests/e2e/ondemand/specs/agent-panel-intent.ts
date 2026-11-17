import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect } from '@playwright/test'
import * as z from 'zod'

import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import zh from '../../../../src/renderer/i18n/locales/zh-cn.json'
import { AgentEntitySchema } from '../../../../src/shared/data/api/schemas/agents'
import { AgentSessionEntitySchema } from '../../../../src/shared/data/api/schemas/agentSessions'
import { AgentWorkspaceEntitySchema } from '../../../../src/shared/data/api/schemas/agentWorkspaces'
import { createUniqueModelId } from '../../../../src/shared/data/types/model'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'

export default async function agentPanelIntent(context: ScenarioContext): Promise<void> {
  const { page } = context
  await context.ensureChinese()
  const preferences = await page.evaluate(async () => ({
    'agent.session.display_mode': await window.api.preference.get('agent.session.display_mode'),
    'app.browser.auto_open_panel': await window.api.preference.get('app.browser.auto_open_panel')
  }))
  const providerId = `panel-intent-${Date.now()}`
  const server = await startMockChatServer()
  const directory = await mkdtemp(join(tmpdir(), 'cherry-panel-intent-'))
  let agentId: string | undefined
  let workspaceId: string | undefined
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'agent.session.display_mode': 'time',
        'app.browser.auto_open_panel': false
      })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: providerId,
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'test', key: 'test', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const created = await page.evaluate(
      ({ name, model }) =>
        window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name,
          model,
          instructions: 'Do not call tools.'
        }),
      { name: providerId, model: createUniqueModelId(providerId, server.modelId) }
    )
    agentId = z.object({ ok: z.literal(true), data: AgentEntitySchema }).parse(created).data.id
    const registered = await page.evaluate(
      (path) => window.api.ipcApi.request('ai.agent.workspace.register', { path }),
      directory
    )
    workspaceId = z.object({ ok: z.literal(true), data: AgentWorkspaceEntitySchema }).parse(registered).data.id
    await writeFile(join(directory, 'panel-intent.txt'), 'Shared workspace content')

    for (const scenario of ['browser', 'empty-workspace', 'same-workspace'] as const) {
      const name = `${providerId}-${scenario}`
      const response = await page.evaluate(
        ({ agentId, name, workspaceId }) =>
          window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'POST',
            path: '/agent-sessions',
            body: { agentId, name, workspace: workspaceId ? { type: 'user', workspaceId } : { type: 'system' } }
          }),
        { agentId, name, workspaceId: scenario === 'same-workspace' ? workspaceId : undefined }
      )
      expect(response.status).toBe(201)
      const original = AgentSessionEntitySchema.parse(response.data)
      const named = await page.evaluate(
        (sessionId) =>
          window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'PATCH',
            path: `/agent-sessions/${sessionId}`,
            body: { isNameManuallyEdited: true }
          }),
        original.id
      )
      expect(named.status).toBe(200)
      if (scenario === 'empty-workspace') {
        await mkdir(original.workspace.path, { recursive: true })
        await writeFile(join(original.workspace.path, 'panel-intent.txt'), 'Previous task content')
      }
      await page.reload()
      await page.getByRole('button', { name: zh['title.work'], exact: true }).first().click()
      const view = page.locator('[data-ui~="agent.view"]').filter({ visible: true }).first()
      await view.getByText(name, { exact: true }).first().click()
      const pane = view.locator('[data-right-pane]')
      const shortcut = view.getByRole('button', {
        name: zh[scenario === 'browser' ? 'agent.right_pane.tabs.browser' : 'agent.right_pane.tabs.files'],
        exact: true
      })
      await expect(shortcut).toBeVisible()
      if ((await shortcut.getAttribute('aria-pressed')) !== 'true') await shortcut.click()
      await expect(pane).toHaveAttribute('data-right-pane-mode', 'docked')
      if (scenario !== 'browser') await expect(pane.getByText('panel-intent.txt', { exact: true })).toBeVisible()

      const sessionsBefore = await page.evaluate(
        (agentId) =>
          window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'GET',
            path: '/agent-sessions',
            params: { agentId }
          }),
        agentId
      )
      expect(sessionsBefore.status).toBe(200)
      const beforeIds = z
        .object({ items: z.array(AgentSessionEntitySchema) })
        .parse(sessionsBefore.data)
        .items.map((session) => session.id)
      let newSessionId: string | undefined
      await view
        .locator('[data-ui~="chat.composer"]')
        .filter({ visible: true })
        .getByRole('button', { name: zh['agent.session.new'], exact: true })
        .click()
      await expect
        .poll(async () => {
          const result = await page.evaluate(
            (agentId) =>
              window.api.dataApi.request({
                id: crypto.randomUUID(),
                method: 'GET',
                path: '/agent-sessions',
                params: { agentId }
              }),
            agentId
          )
          expect(result.status).toBe(200)
          newSessionId = z
            .object({ items: z.array(AgentSessionEntitySchema) })
            .parse(result.data)
            .items.find((session) => !beforeIds.includes(session.id))?.id
          return newSessionId !== undefined
        })
        .toBe(true)
      await expect(pane).toHaveAttribute('data-right-pane-mode', scenario === 'same-workspace' ? 'docked' : 'closed')
      await expect(
        view.getByRole('button', { name: zh['agent.right_pane.tabs.browser'], exact: true })
      ).toHaveAttribute('aria-pressed', 'false')
      if (scenario === 'same-workspace') await expect(pane.getByText('panel-intent.txt', { exact: true })).toBeVisible()
      await context.screenshot(`agent-panel-${scenario}`)
      // Keep the next scenario from reusing this empty task.
      const marked = await page.evaluate(
        (sessionId) =>
          window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'PATCH',
            path: `/agent-sessions/${sessionId}`,
            body: { isNameManuallyEdited: true }
          }),
        newSessionId
      )
      expect(marked.status).toBe(200)
    }
    await context.runSteps([{ verb: 'expectVisible', selector: '[data-ui~="agent.view"]' }])
  } finally {
    if (agentId)
      await page.evaluate(
        (agentId) =>
          window.api.ipcApi.request('ai.agent.delete_permanently', {
            agentId,
            deleteSessions: true
          }),
        agentId
      )
    if (workspaceId)
      await page.evaluate(
        (workspaceId) => window.api.ipcApi.request('ai.agent.workspace.delete', { workspaceId }),
        workspaceId
      )
    await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'DELETE',
          path: `/providers/${providerId}`
        }),
      providerId
    )
    await page.evaluate((values) => window.api.preference.setMultiple(values), preferences)
    await server.close()
    await rm(directory, { recursive: true, force: true })
  }
}
