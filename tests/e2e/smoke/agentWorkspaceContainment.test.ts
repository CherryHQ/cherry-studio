import { existsSync } from 'node:fs'
import { symlink } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { uiLocator } from './utils/uiLocator'

test('system workspace ancestor aliases work and different physical roots show a named error', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const profile = process.env.CS_DEV_PROFILE_ROOT
  expect(profile, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const userData = path.join(profile!, 'userData')
  const database = path.join(userData, 'Data', 'cherrystudio.sqlite')
  const server = await startMockChatServer()
  const providerId = `containment-smoke-${Date.now()}`
  const agentName = `Containment smoke ${Date.now()}`
  const sessionName = `Containment session ${Date.now()}`
  let app: ElectronApplication | undefined
  let page!: Page

  const launch = async () => {
    app = await electron.launch({ args: ['.'], env: { ...process.env, NODE_ENV: 'development' }, timeout: 60_000 })
    await expect
      .poll(
        async () => {
          for (const window of app!.windows()) {
            if ((await window.title()) === 'Cherry Studio') {
              page = window
              return true
            }
          }
          return false
        },
        { timeout: 60_000 }
      )
      .toBe(true)
    await page!.waitForSelector('#root', { state: 'attached' })
    await page.waitForSelector('[data-ui~="chat.view"], [data-onboarding-language-select]', {
      state: 'visible',
      timeout: 60_000
    })
  }
  const openConversation = async () => {
    await page.getByRole('button', { name: 'Chat', exact: true }).first().click()
    await expect(uiLocator(page, 'chat.composer').filter({ visible: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Work', exact: true }).first().click()
    const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
    await expect(view).toBeVisible()
    const header = view.getByText(agentName, { exact: true }).first()
    await header.click()
    const conversation = view.getByText(sessionName, { exact: true }).first()
    if (!(await conversation.isVisible())) {
      await header.hover()
      await view
        .getByRole('button', { name: agentName, exact: true })
        .first()
        .locator('..')
        .getByRole('button', { name: 'Expand', exact: true })
        .click()
    }
    await conversation.click()
    return view
  }
  const send = async (prompt: string) => {
    const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
    const composer = uiLocator(view, 'chat.composer').filter({ visible: true }).first()
    const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
    await expect(editor).toBeEditable()
    await editor.fill(prompt)
    const button = composer.getByRole('button', { name: 'Send', exact: true })
    await expect(button).toHaveAttribute('aria-disabled', 'false')
    await button.click()
  }
  const screenshot = async (name: string) => {
    const target = testInfo.outputPath(`${name}.png`)
    await page.screenshot({ path: target })
    await testInfo.attach(name, { path: target, contentType: 'image/png' })
  }

  try {
    await launch()
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Chat', exact: true }).first().click()
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Workspace smoke mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-enable`,
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
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    // Agent creation owns filesystem effects and therefore lives on IpcApi, not DataApi.
    const created = await page.evaluate(
      ({ name, model }) =>
        window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name,
          model,
          instructions: 'Answer briefly without using tools.'
        }),
      { name: agentName, model: createUniqueModelId(providerId, server.modelId) }
    )
    expect(created).toMatchObject({ ok: true })
    const agent = AgentEntitySchema.parse((created as { data: unknown }).data)

    await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
    const response = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: `containment-session-${name}`,
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: agent.id, name: sessionName }
    )
    expect(response.status).toBe(201)
    const session = AgentSessionEntitySchema.parse(response.data)
    await page.reload()
    const captured = await page.evaluate(async (sessionId) => {
      const result = await window.api.dataApi.request({
        id: 'containment-read',
        method: 'GET',
        path: `/agent-sessions/${sessionId}`
      })
      if (result.status !== 200) throw new Error('Session lookup failed')
      return result.data
    }, session.id)
    expect(AgentSessionEntitySchema.parse(captured).workspace.path).toBe(session.workspace.path)

    const messages = async () => {
      const result = await page.evaluate(
        (sessionId) =>
          window.api.dataApi.request({
            id: 'containment-messages',
            method: 'GET',
            path: `/agent-sessions/${sessionId}/messages`
          }),
        session.id
      )
      expect(result.status).toBe(200)
      return (result.data as { items: unknown[] }).items.map((item) => AgentSessionMessageEntitySchema.parse(item))
    }
    const roundTrip = async (marker: string, assistantCount: number) => {
      await openConversation()
      const prompt = `Reply briefly: ${marker}`
      await send(prompt)
      const held = await server.nextRequest(30_000)
      expect(held.body.model).toBe(server.modelId)
      expect(JSON.stringify(held.body.messages).includes(prompt)).toBe(true)
      held.complete(marker)
      const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
      await expect(uiLocator(view, 'chat.message').filter({ hasText: marker })).toBeVisible({ timeout: 30_000 })
      await expect
        .poll(
          async () =>
            (await messages()).filter((message) => message.role === 'assistant' && message.status === 'success').length
        )
        .toBe(assistantCount)
    }
    await roundTrip(`CONTAINMENT_NORMAL_${providerId}`, 1)

    const replacePathWhileStopped = async (before: string, after: string) => {
      // This is a stopped-app fixture precondition; the real renderer dispatch and ack remain intact.
      await app!.close()
      app = undefined
      const db = new DatabaseSync(database)
      try {
        const ownership = db
          .prepare('SELECT count(*) AS total FROM agent_session WHERE workspace_id=?')
          .get(session.workspaceId)
        expect(ownership?.total).toBe(1)
        const changed = db
          .prepare('UPDATE agent_workspace SET path=? WHERE id=? AND path=?')
          .run(after, session.workspaceId, before)
        expect(Number(changed.changes)).toBe(1)
      } finally {
        db.close()
      }
      await launch()
    }
    const aliasUserData = path.join(profile!, 'alias-userData')
    await symlink(userData, aliasUserData, 'junction')
    const aliasPath = path.join(aliasUserData, path.relative(userData, session.workspace.path))
    await replacePathWhileStopped(session.workspace.path, aliasPath)
    await roundTrip(`CONTAINMENT_ALIAS_${providerId}`, 2)
    expect(existsSync(aliasPath)).toBe(true)
    await screenshot('workspace-alias-success')

    const oldUserData = path.join(profile!, 'old-userData')
    const outside = path.join(oldUserData, path.relative(userData, session.workspace.path))
    await replacePathWhileStopped(aliasPath, outside)
    await openConversation()
    const before = await messages()
    await send(`CONTAINMENT_BLOCKED_${providerId}`)
    const notifications = page.locator('[aria-label="notifications"]')
    await expect(notifications).toBeVisible({ timeout: 10_000 })
    await notifications.hover()
    await expect(notifications).toContainText(`Workspace check failed for session ${session.id}`)
    await expect(notifications).toContainText(outside)
    await screenshot('workspace-outside-named-error')
    const after = await messages()
    expect(after.filter((message) => message.role === 'assistant').map((message) => message.id)).toEqual(
      before.filter((message) => message.role === 'assistant').map((message) => message.id)
    )
    expect(after.length).toBe(before.length)
    expect(existsSync(oldUserData)).toBe(false)
    const finalSession = await page.evaluate(
      (sessionId) =>
        window.api.dataApi.request({
          id: 'containment-binding',
          method: 'GET',
          path: `/agent-sessions/${sessionId}`
        }),
      session.id
    )
    expect(AgentSessionEntitySchema.parse(finalSession.data)).toMatchObject({
      workspaceId: session.workspaceId,
      workspace: { path: outside }
    })
  } finally {
    if (app) await app.close()
    await server.close()
  }
})
