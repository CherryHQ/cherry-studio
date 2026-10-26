import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AgentEntitySchema } from '@shared/data/api/schemas/agents'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '@shared/data/types/agent'
import { createUniqueModelId } from '@shared/data/types/model'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function scheduledTasks(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const server = await startMockChatServer()
  const providerId = `mp58-${Date.now()}`
  const agentName = app.resourceName(`Schedule agent ${Date.now()}`)
  const name = app.resourceName(`Scheduled time ${Date.now()}`)
  let task: ScheduledTaskEntity | undefined
  let agentId: string | undefined
  await testInfo.attach('MP-58 model source', {
    body: 'Local OpenAI HTTP mock; real Pi agent, scheduler, task persistence and run history.',
    contentType: 'text/plain'
  })
  try {
    await screenshot('MP-58 application before setup')
    const seeded = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp58-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP58 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp58-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp58-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, enabled.status, model.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(seeded).toEqual([201, 200, 201])
    const agent = await page.evaluate(
      ({ name, model }) =>
        window.api.ipcApi.request('ai.agent.create', {
          name,
          model,
          type: 'pi',
          configuration: { permission_mode: 'bypassPermissions' }
        }),
      { name: agentName, model: createUniqueModelId(providerId, server.modelId) }
    )
    const created = agent as { ok: boolean; data: unknown }
    expect(created.ok).toBe(true)
    agentId = AgentEntitySchema.parse(created.data).id
    await page.reload()
    await openSettingsSection(page, 'Scheduled Tasks')
    await screenshot('MP-58 scheduled tasks before creation')
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Create manually', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New scheduled task', exact: true })
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
    await dialog.locator('[contenteditable="true"]').fill('输出当前时间')
    await dialog.getByRole('button', { name: 'Bind Agent', exact: true }).click()
    await page.getByRole('option').filter({ hasText: agentName }).click()
    await dialog.getByRole('combobox', { name: 'Execution Frequency', exact: true }).click()
    await page.getByRole('option', { name: 'Cron expression', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Cron expression', exact: true }).fill('not-a-cron')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog.getByText('Enter a valid Cron expression.', { exact: true })).toBeVisible()
    await expect(dialog).toBeVisible()
    await screenshot('MP-58 invalid cron validation')
    await dialog.getByRole('combobox', { name: 'Execution Frequency', exact: true }).click()
    await page.getByRole('option', { name: 'Custom interval', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Interval', exact: true }).fill('5')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await openSettingsSection(page, 'Scheduled Tasks')
    const card = page.getByRole('link').filter({ hasText: name })
    await expect(card).toContainText('Every 5 minutes')
    await expect(card).toContainText('Next Run')
    await screenshot('MP-58 saved task with next run')
    await card.click()
    const taskId = new URL(page.url()).hash.split('/').pop() || new URL(page.url()).pathname.split('/').pop()!
    const readTask = async () => {
      const response = await page.evaluate(
        (taskId) => window.api.dataApi.request({ id: 'mp58-read', method: 'GET', path: `/agent-tasks/${taskId}` }),
        taskId
      )
      expect(response.status).toBe(200)
      return response.data as ScheduledTaskEntity
    }
    task = await readTask()
    expect(task.prompt).toBe('输出当前时间')
    expect(task.trigger).toMatchObject({ kind: 'interval', ms: 300_000 })
    expect(task.enabled).toBe(true)
    expect(Date.parse(task.nextRun!)).toBeGreaterThan(Date.now())
    const readLogs = async () => {
      const response = await page.evaluate(
        ({ agentId, id }) =>
          window.api.dataApi.request({ id: 'mp58-logs', method: 'GET', path: `/agents/${agentId}/tasks/${id}/logs` }),
        task!
      )
      expect(response.status).toBe(200)
      return (response.data as { items: TaskRunLogEntity[] }).items
    }
    expect(await readLogs()).toHaveLength(0)
    await page.getByRole('tab', { name: 'Run History', exact: true }).click()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    const request = await server.nextRequest(60_000)
    expect(JSON.stringify(request.body.messages)).toContain('输出当前时间')
    const rows = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Running...', exact: true }) })
    await expect(rows).toHaveCount(1)
    const running = await readLogs()
    expect(running).toHaveLength(1)
    expect(running[0].status).toBe('running')
    await screenshot('MP-58 immediate run in progress')
    const answer = new Date().toISOString()
    request.complete(answer)
    await expect.poll(async () => (await readLogs())[0]?.status, { timeout: 60_000 }).toBe('completed')
    const completed = await readLogs()
    expect(completed).toHaveLength(1)
    expect(completed[0].id).toBe(running[0].id)
    expect(completed[0].durationMs).toBeGreaterThan(0)
    expect(completed[0].result).toContain(answer)
    const completedRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'Completed', exact: true }) })
    await expect(completedRow).toHaveCount(1)
    await expect(completedRow.getByRole('cell').nth(1)).toHaveText(/^\d+(\.\d+)?(ms|s|m)$/)
    await screenshot('MP-58 completed run with duration')
    const beforePause = await readTask()
    const toggle = page.getByRole('switch', { name: 'Active', exact: true })
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(async () => (await readTask()).status).toBe('paused')
    expect((await readTask()).nextRun).toBeNull()
    // Cross the original five-minute deadline to catch a paused timer that still fires.
    await expect
      .poll(() => Date.now(), { timeout: 310_000, intervals: [1_000] })
      .toBeGreaterThan(Date.parse(beforePause.nextRun!) + 2_000)
    expect((await readLogs()).map(({ id }) => id)).toEqual([running[0].id])
    await screenshot('MP-58 paused beyond original deadline')
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect.poll(async () => (await readTask()).status).toBe('active')
    const resumed = await readTask()
    expect(Date.parse(resumed.nextRun!)).toBeGreaterThan(Date.now())
    expect(Date.parse(resumed.nextRun!)).toBeGreaterThan(Date.parse(beforePause.nextRun!))
    await expect(page.getByText(/^Next Run:/)).toBeVisible()
    await screenshot('MP-58 resumed with refreshed next run')
  } finally {
    if (task)
      await page.evaluate(
        ({ agentId, id }) => window.api.ipcApi.request('ai.agent.task.delete', { agentId, taskId: id }),
        task
      )
    if (agentId)
      await page.evaluate(
        (agentId) => window.api.ipcApi.request('ai.agent.delete', { agentId, deleteSessions: true, permanent: true }),
        agentId
      )
    await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({ id: 'mp58-delete-provider', method: 'DELETE', path: `/providers/${providerId}` }),
      providerId
    )
    await server.close()
  }
}
