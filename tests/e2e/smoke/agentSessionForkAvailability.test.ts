import { copyFile, mkdir, readdir, realpath, rename } from 'node:fs/promises'
import path from 'node:path'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import type { UnifiedPreferenceType } from '../../../src/shared/data/preference/preferenceTypes'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('Work Agent fork availability follows native history removal and restoration', async ({
  mainWindow: page,
  electronApp
}, testInfo) => {
  test.setTimeout(180_000)
  const profile = process.env.CS_DEV_PROFILE_ROOT
  expect(
    profile && path.isAbsolute(profile) && path.parse(profile).root !== path.resolve(profile),
    'An isolated absolute profile is required'
  ).toBeTruthy()
  const server = await startMockChatServer()
  const suffix = `${Date.now()}-${process.pid}`
  const name = `Fork availability ${suffix}`
  const prompt = `FORK_PROMPT_${suffix}`
  const marker = `FORK_REPLY_${suffix}`
  const providerId = `fork-availability-${suffix}`
  const errors: string[] = []
  const onError = (error: Error) => errors.push(error.stack ?? error.message)
  page.on('pageerror', onError)
  let previous:
    | {
        language: UnifiedPreferenceType['app.language']
        onboarding: UnifiedPreferenceType['app.onboarding.provider_setup.status']
        naming: boolean
        menu: UnifiedPreferenceType['menu.presentation_mode']
      }
    | undefined
  let moved: { original: string; backup: string } | undefined
  let request: MockChatRequest | undefined
  let tracing = false
  const screenshot = async (filename: string) => {
    await page.bringToFront()
    await page.waitForTimeout(250)
    const output = testInfo.outputPath(filename)
    await page.screenshot({ path: output })
    await testInfo.attach(filename, { path: output, contentType: 'image/png' })
    if (process.env.TASKS) {
      const evidence = path.resolve(process.env.TASKS, 'round-1/evidence')
      await mkdir(evidence, { recursive: true })
      await copyFile(output, path.join(evidence, `${suffix}-${filename}`))
    }
  }
  try {
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    tracing = true
    previous = await page.evaluate(async () => ({
      language: await window.api.preference.get('app.language'),
      onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
      naming: await window.api.preference.get('topic.naming.enabled'),
      menu: await window.api.preference.get('menu.presentation_mode')
    }))
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await page.evaluate(async () => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('topic.naming.enabled', false)
      await window.api.preference.set('menu.presentation_mode', 'cherry')
    })
    await selectSidebarApp(page, 'Chat')
    const statuses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const created = await window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Fork mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [created.status, enabled.status, models.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(statuses).toEqual([201, 200, 201])
    const created = await page.evaluate(
      ({ name, model }) =>
        window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name,
          model,
          instructions: 'Answer briefly without using tools.'
        }),
      { name, model: createUniqueModelId(providerId, server.modelId) }
    )
    expect(created).toMatchObject({ ok: true })
    const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
    const response = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: name,
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: agent.id, name: `${name} session` }
    )
    expect(response.status).toBe(201)
    const session = AgentSessionEntitySchema.parse(response.data)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await selectSidebarApp(page, 'Work')
    const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
    const header = view.getByText(name, { exact: true }).first()
    await header.click()
    const conversation = view.getByText(`${name} session`, { exact: true }).first()
    if (!(await conversation.isVisible())) {
      await header.hover()
      await view
        .getByRole('button', { name, exact: true })
        .first()
        .locator('..')
        .getByRole('button', { name: 'Expand', exact: true })
        .click()
    }
    await conversation.click()
    await screenshot('01-prepared.png')
    const composer = uiLocator(view, 'chat.composer').filter({ visible: true })
    const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
    await expect(editor).toBeEditable()
    await editor.fill(prompt)
    const send = composer.getByRole('button', { name: 'Send', exact: true })
    await expect(send).toHaveAttribute('aria-disabled', 'false')
    await send.click()
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      request = await server.nextRequest(Math.max(1, deadline - Date.now()))
      if (request.body.model === server.modelId && JSON.stringify(request.body.messages).includes(prompt)) break
      request.complete('Unrelated background request complete')
      request = undefined
    }
    expect(request, 'A real correlated model request is required').toBeDefined()
    request!.complete(marker)
    const message = uiLocator(view, 'chat.message').filter({ hasText: marker })
    await expect(message).toBeVisible({ timeout: 30_000 })
    let token = ''
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(
            (id) =>
              window.api.dataApi.request({
                id: 'fork-messages',
                method: 'GET',
                path: `/agent-sessions/${id}/messages`
              }),
            session.id
          )
          expect(result.status).toBe(200)
          const found = (result.data as { items: unknown[] }).items
            .map((item) => AgentSessionMessageEntitySchema.parse(item))
            .find(
              (item) => item.role === 'assistant' && item.status === 'success' && JSON.stringify(item).includes(marker)
            )
          token = found?.runtimeResumeToken ?? ''
          return !!found
        },
        { timeout: 30_000 }
      )
      .toBe(true)
    await screenshot('02-completed-turn.png')
    const openMenu = async () => {
      await message.hover()
      await message.getByRole('button', { name: en['chat.message.more'], exact: true }).click()
      const fork = page.getByRole('menuitem', { name: en['agent_session_fork.label'], exact: true })
      await expect(fork).toBeVisible()
      return fork
    }
    let fork = await openMenu()
    await expect(fork).toBeEnabled({ timeout: 30_000 })
    await screenshot('03-enabled.png')
    const listSessions = async () => {
      const result = await page.evaluate(
        (agentId) =>
          window.api.dataApi.request({
            id: 'fork-list',
            method: 'GET',
            path: '/agent-sessions',
            params: { agentId, limit: 200 }
          }),
        agent.id
      )
      expect(result.status).toBe(200)
      return (result.data as { items: Array<{ id: string }> }).items.map((item) => item.id).sort()
    }
    const beforeFork = await listSessions()
    await fork.click()
    await expect
      .poll(async () => (await listSessions()).filter((id) => !beforeFork.includes(id)).length, { timeout: 8_000 })
      .toBe(1)
    await screenshot('04-fork-attempt.png')
    await conversation.click()
    await expect(message).toBeVisible()
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const root = await realpath(profile!)
    const realUserData = await realpath(userData)
    expect(path.relative(root, realUserData)).toBe('userData')
    const sessionsDir = await realpath(path.join(realUserData, 'Data', 'Agents', '.pi', 'sessions'))
    const relative = path.relative(root, sessionsDir)
    expect(relative && !relative.startsWith('..') && !path.isAbsolute(relative)).toBeTruthy()
    expect(token, 'The successful assistant message must identify its native session').toMatch(/^[a-zA-Z0-9-]+$/)
    const files = (await readdir(sessionsDir)).filter((file) => file.endsWith(`_${token}.jsonl`)).sort()
    expect(files).toHaveLength(1)
    const original = path.join(sessionsDir, files[0])
    const backup = `${original}.fork-availability-backup`
    await rename(original, backup)
    moved = { original, backup }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    fork = await openMenu()
    await expect(fork).toBeDisabled({ timeout: 30_000 })
    await fork.hover({ force: true })
    await expect(
      page.getByRole('tooltip').filter({ hasText: en['agent_session_fork.history_missing'] }).first()
    ).toHaveText(en['agent_session_fork.history_missing'])
    await screenshot('05-missing-tooltip.png')
    const beforeDisabled = await listSessions()
    await fork.click({ force: true })
    await page.keyboard.press('Enter')
    await expect.poll(listSessions).toEqual(beforeDisabled)
    await expect(page.getByText(en['agent_session_fork.operation_failed'], { exact: true })).toHaveCount(0)
    await screenshot('06-disabled-interaction.png')
    await rename(backup, original)
    moved = undefined
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    fork = await openMenu()
    await expect(fork).toBeEnabled({ timeout: 30_000 })
    await screenshot('07-restored.png')
    expect(errors, 'Renderer page errors').toEqual([])
  } finally {
    if (moved) await rename(moved.backup, moved.original)
    try {
      if (tracing) {
        const trace = testInfo.outputPath('fork-availability-trace.zip')
        await page.context().tracing.stop({ path: trace })
        await testInfo.attach('fork-availability-trace', { path: trace, contentType: 'application/zip' })
      }
      await testInfo.attach('page-errors', { body: JSON.stringify(errors), contentType: 'application/json' })
      if (previous)
        await page.evaluate(async (values) => {
          await window.api.preference.set('app.language', values.language)
          await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
          await window.api.preference.set('topic.naming.enabled', values.naming)
          await window.api.preference.set('menu.presentation_mode', values.menu)
        }, previous)
    } finally {
      page.off('pageerror', onError)
      request?.disconnect()
      await server.close()
    }
  }
})
