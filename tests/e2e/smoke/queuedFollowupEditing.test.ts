import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { Locator } from '@playwright/test'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import type { UnifiedPreferenceType } from '../../../src/shared/data/preference/preferenceTypes'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

for (const variant of ['Chat', 'Work Agent'] as const) {
  test(`${variant} preserves the edited queued draft when switching Edit targets`, async ({
    mainWindow: page,
    electronApp
  }, testInfo) => {
    test.setTimeout(120_000)
    const profile = process.env.CS_DEV_PROFILE_ROOT
    expect(profile, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
    expect(path.isAbsolute(profile!), 'The isolated profile root must be absolute').toBe(true)
    const server = await startMockChatServer()
    const suffix = `${variant.replaceAll(' ', '-')}-${Date.now()}`
    const providerId = `queued-edit-${suffix}`
    const name = `Queued editing ${suffix}`
    const initial = `HOLD_INITIAL_${suffix}`
    const oldA = `ORIGINAL_ALPHA_${suffix}`
    const editedA = `REVISED_DELTA_${suffix}`
    const b = `SECOND_BRAVO_${suffix}`
    const heldMarker = `HELD_RESPONSE_${suffix}`
    const finalMarker = `DRAINED_RESPONSE_${suffix}`
    const requests: MockChatRequest['body'][] = []
    const controllers = new Set<MockChatRequest>()
    const errors: string[] = []
    const onError = (error: Error) => errors.push(error.stack ?? error.message)
    page.on('pageerror', onError)
    let previous:
      | {
          language: UnifiedPreferenceType['app.language']
          onboarding: UnifiedPreferenceType['app.onboarding.provider_setup.status']
          naming: boolean
        }
      | undefined
    let captured = false
    let tracing = false
    const screenshot = async (filename: string) => {
      const output = testInfo.outputPath(filename)
      await page.screenshot({ path: output })
      const evidence = path.resolve(
        process.env.TASKS ?? path.join(process.cwd(), '../.tasks/issue-21855'),
        'round-1/evidence'
      )
      await mkdir(evidence, { recursive: true })
      await copyFile(output, path.join(evidence, `${suffix}-${filename}`))
      await testInfo.attach(filename, { path: output, contentType: 'image/png' })
      captured = true
    }
    const nextCorrelated = async () => {
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        const request = await server.nextRequest(Math.max(1, deadline - Date.now()))
        controllers.add(request)
        void request.closed.then(() => controllers.delete(request))
        requests.push(request.body)
        if (
          request.body.model === server.modelId &&
          request.body.messages.some((message) => JSON.stringify(message).includes(initial))
        )
          return request
        request.complete('Unrelated background request complete')
      }
      throw new Error('No request correlated to the queued-edit conversation')
    }
    try {
      await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      tracing = true
      previous = await page.evaluate(async () => ({
        language: await window.api.preference.get('app.language'),
        onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
        naming: await window.api.preference.get('topic.naming.enabled')
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
      })
      await selectSidebarApp(page, 'Chat')
      const responses = await page.evaluate(
        async ({ providerId, baseUrl, modelId }) => {
          const created = await window.api.dataApi.request({
            id: `${providerId}-create`,
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: 'Queued edit mock',
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
      expect(responses, 'Provider and model must be available for real HTTP sends').toEqual([201, 200, 201])
      const modelId = createUniqueModelId(providerId, server.modelId)
      let view: Locator
      if (variant === 'Chat') {
        const created = await page.evaluate(
          ({ name, modelId }) =>
            window.api.dataApi.request({ id: name, method: 'POST', path: '/assistants', body: { name, modelId } }),
          { name, modelId }
        )
        expect(created.status).toBe(201)
        await page.reload()
        await selectSidebarApp(page, 'Chat')
        view = page.locator('[data-ui~="chat.view"]:visible')
        const row = view.locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
        await row.hover()
        await row.getByRole('button', { name: 'New Chat', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
      } else {
        const created = await page.evaluate(
          ({ name, model }) =>
            window.api.ipcApi.request('ai.agent.create', {
              type: 'pi',
              name,
              model,
              instructions: 'Answer briefly without using tools.'
            }),
          { name, model: modelId }
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
        await testInfo.attach('session', { body: JSON.stringify(session), contentType: 'application/json' })
        await page.reload()
        await selectSidebarApp(page, 'Chat')
        await selectSidebarApp(page, 'Work')
        view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
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
      }
      const composer = uiLocator(view, 'chat.composer').filter({ visible: true })
      await expect(composer, 'Only the intended conversation composer should be visible').toHaveCount(1)
      const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
      await expect(editor).toBeEditable()
      await expect(editor).toHaveText('')
      await expect(view.getByRole('button', { name: /^Queued \(/ })).toHaveCount(0)
      const send = async (text: string) => {
        await editor.fill(text)
        const button = composer.getByRole('button', { name: 'Send', exact: true })
        await expect(button, 'The Send role is on an i element and uses aria-disabled').toHaveAttribute(
          'aria-disabled',
          'false'
        )
        await button.click()
      }
      await send(initial)
      const held = await nextCorrelated()
      expect(held.body.stream, 'The initial turn must be a real held-open stream').toBe(true)
      let heldClosed = false
      void held.closed.then(() => {
        heldClosed = true
      })
      held.sendText(heldMarker)
      await expect(uiLocator(view, 'chat.message').filter({ hasText: heldMarker })).toBeVisible()
      await expect(editor).toHaveText('')
      await expect(composer.locator('[data-ui~="chat.composer.action.pause"]')).toBeVisible()
      await send(oldA)
      await expect(editor).toHaveText('')
      await expect(view.getByRole('button', { name: 'Queued (1)', exact: true })).toBeVisible()
      await send(b)
      await expect(editor).toHaveText('')
      const listFor = async (count: number) => {
        const header = view.getByRole('button', { name: `Queued (${count})`, exact: true })
        if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
        await expect(header).toHaveAttribute('aria-expanded', 'true')
        const id = await header.getAttribute('aria-controls')
        expect(id, 'The dock header must identify its controlled list').toBeTruthy()
        const list = view.locator(`[id=${JSON.stringify(id)}]`)
        await expect(list).toHaveAttribute('aria-hidden', 'false')
        await expect(list).not.toHaveAttribute('inert', '')
        return list
      }
      const editRow = async (list: Locator, text: string) => {
        // Dock rows have no role; the unique preview anchors the nearest div containing Edit.
        const row = list
          .getByText(text, { exact: true })
          .locator('xpath=ancestor::div[.//button[@aria-label="Edit"]][1]')
        await row.hover()
        await row.getByRole('button', { name: 'Edit', exact: true }).click()
      }
      const list = await listFor(2)
      await expect(list.getByText(b, { exact: true })).toBeVisible()
      await editRow(list, oldA)
      await expect(editor).toHaveText(oldA)
      const remaining = await listFor(1)
      await expect(remaining.getByText(oldA, { exact: true })).toHaveCount(0)
      await editor.fill(editedA)
      await expect(editor).toHaveText(editedA)
      await editRow(remaining, b)
      await screenshot('queued-edit-switch.png')
      const returned = await listFor(1)
      await expect(
        returned.getByText(editedA, { exact: true }),
        'Switching Edit must return the latest A draft to the dock'
      ).toBeVisible()
      await expect(returned.getByText(oldA, { exact: true })).toHaveCount(0)
      await expect(returned.getByText(b, { exact: true })).toHaveCount(0)
      await expect(editor, 'B must be the new edited document').toHaveText(b)
      expect(heldClosed, 'The initial turn must remain held through both edits').toBe(false)
      held.complete()
      const drained = await nextCorrelated()
      const users = drained.body.messages.filter((message) => (message as { role?: string }).role === 'user')
      const latest = JSON.stringify(users.at(-1))
      expect(latest, 'Auto-drain must submit A-prime rather than stale A or editor B').toContain(editedA)
      expect(latest).not.toContain(oldA)
      expect(latest).not.toContain(b)
      drained.complete(finalMarker)
      await expect(uiLocator(view, 'chat.message').filter({ hasText: finalMarker })).toBeVisible({ timeout: 30_000 })
      await expect(view.getByRole('button', { name: /^Queued \(/ })).toHaveCount(0)
      await expect(editor, 'Draining A must leave B editable').toHaveText(b)
      const extraDeadline = Date.now() + 500
      while (Date.now() < extraDeadline) {
        let extra: MockChatRequest
        try {
          extra = await server.nextRequest(Math.max(1, extraDeadline - Date.now()))
        } catch (error) {
          if (error instanceof Error && error.message === 'Timed out waiting for a mock chat request') break
          throw error
        }
        requests.push(extra.body)
        extra.complete('Unexpected extra request complete')
      }
      expect(
        requests.filter(
          (body) =>
            body.model === server.modelId && body.messages.some((message) => JSON.stringify(message).includes(initial))
        ),
        'The held turn and one drained follow-up must be the only correlated submissions'
      ).toHaveLength(2)
    } finally {
      try {
        if (!captured) await screenshot('queued-edit-failure.png')
      } finally {
        try {
          await testInfo.attach('requests-and-errors', {
            body: JSON.stringify(
              {
                requests,
                errors,
                cwd: process.cwd(),
                profile,
                pid: electronApp.process().pid,
                build: await stat(path.join(process.cwd(), 'out/main/main.js'))
                  .then((value) => ({ size: value.size, mtime: value.mtime.toISOString() }))
                  .catch(() => null)
              },
              null,
              2
            ),
            contentType: 'application/json'
          })
          if (tracing) {
            const trace = testInfo.outputPath('queued-edit-trace.zip')
            await page.context().tracing.stop({ path: trace })
            await testInfo.attach('queued-edit-trace', { path: trace, contentType: 'application/zip' })
          }
        } finally {
          page.off('pageerror', onError)
          try {
            if (previous)
              await page.evaluate(async (values) => {
                await window.api.preference.set('app.language', values.language)
                await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
                await window.api.preference.set('topic.naming.enabled', values.naming)
              }, previous)
          } finally {
            for (const request of controllers) request.disconnect()
            await server.close()
          }
        }
      }
    }
  })
}
