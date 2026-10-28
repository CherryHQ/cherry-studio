import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { AgentEntity, ScheduledTaskEntity, TaskRunLogEntity } from '@shared/data/types/agent'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { createAgent, startNewAgentTask } from '../helpers/agents'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function scheduledTaskConversation(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const name = app.resourceName(`MP-145 time ${Date.now()}`)
  const agentName = `${name} Agent`
  const prompt = '输出当前时间'
  let agentId: string | undefined
  let conversationUrl: string | undefined
  const sessionsBefore = await page.evaluate(async () => {
    const response = await window.api.dataApi.request({
      id: 'MP-145-read',
      method: 'GET',
      path: '/agent-sessions',
      params: { limit: 200 }
    })
    if (response.status !== 200) throw new Error('Cannot read sessions before MP-145')
    return (response.data as { items: { id: string }[] }).items.map(({ id }) => id)
  })

  try {
    // Use the configured real provider: canned model text cannot prove tool-driven task creation.
    await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await createAgent(page, {
      name: agentName,
      runtime: 'Pi',
      permission: 'Full Access',
      model: app.config.customProvider.chatModel
    })
    const agents = await page.evaluate(() =>
      window.api.dataApi.request({
        id: 'MP-145-read',
        method: 'GET',
        path: '/agents',
        params: { limit: 200 }
      })
    )
    expect(agents.status).toBe(200)
    agentId = (agents.data as { items: AgentEntity[] }).items.find(({ name }) => name === agentName)?.id
    expect(agentId).toBeTruthy()
    await startNewAgentTask(page, agentName)

    await openSettingsSection(page, 'Scheduled Tasks')
    await screenshot('MP-145 scheduled tasks header')
    await expect
      .soft(
        page.getByText('Set what the Agent should do and how often it should run.', { exact: true }),
        'Page header must explain task content and run frequency (设置 Agent 要执行的内容和运行频率。)'
      )
      .toBeVisible()
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Create manually', exact: true })).toBeEnabled()
    const createWithAgent = page.getByRole('menuitem', { name: 'Create with Agent', exact: true })
    await expect(createWithAgent).toBeEnabled()
    await screenshot('MP-145 creation entrances')
    await createWithAgent.click()
    const view = page.locator('[data-ui~="agent.view"]:visible').first()
    await expect(view).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/启动定时任务对话失败|Failed to start.*scheduled/i)).toHaveCount(0)
    const composer = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    await expect(composer).toBeEditable()
    await screenshot('MP-145 Agent entry draft')
    await expect(composer, 'Agent creation entrance must prefill the scheduled-task interview draft').toContainText(
      /定时任务|scheduled task/i
    )
    const draft = await composer.innerText()
    expect(draft).toMatch(/介绍|能做|explain|introduc|capabilit/i)
    expect(draft).toMatch(/问题|询问|ask|question/i)
    expect(draft).toMatch(/确认|confirm/i)
    expect(draft).toMatch(/名称|name/i)
    expect(draft).toMatch(/时间|when|time|schedule/i)
    expect(draft).toMatch(/提示词|prompt/i)
    conversationUrl = page.url()
    const messages = view.locator('[data-ui~="chat.message"]:visible')
    const waitForAnswer = async (previousCount: number) => {
      await expect.poll(() => messages.count(), { timeout: 90_000 }).toBeGreaterThan(previousCount)
      await expect(messages.last().getByTestId('completed-process-trigger')).toBeVisible({ timeout: 90_000 })
      return messages.last()
    }
    let previousCount = await messages.count()
    // Send the entry's untouched draft, then answer the interview one question at a time.
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    let answer = await waitForAnswer(previousCount)
    const turns = [
      {
        question: /做什么|内容|what.*(do|task)|task.*(do|content)/i,
        answer: `任务名称必须是「${name}」，提示词必须完整且仅为「${prompt}」。`
      },
      { question: /多久|频率|时间|often|frequency|schedule|when/i, answer: '每 5 分钟执行一次。' },
      { question: /Agent|智能体|代理/i, answer: `使用 Agent「${agentName}」。` }
    ]
    for (const turn of turns) {
      await expect(answer).toContainText(turn.question)
      previousCount = await messages.count()
      await composer.fill(turn.answer)
      await view.getByRole('button', { name: 'Send', exact: true }).click()
      answer = await waitForAnswer(previousCount)
    }
    await expect(answer).toContainText(/确认|confirm/i)
    const readTasks = async () => {
      const response = await page.evaluate(
        (agentId) =>
          window.api.dataApi.request({
            id: 'MP-145-tasks',
            method: 'GET',
            path: `/agents/${agentId}/tasks`,
            params: { limit: 200 }
          }),
        agentId!
      )
      expect(response.status).toBe(200)
      return (response.data as { items: ScheduledTaskEntity[] }).items
    }
    const beforeConfirmation = await readTasks()
    expect(beforeConfirmation.filter((task) => task.name === name)).toHaveLength(0)
    previousCount = await messages.count()
    const confirm = answer.getByRole('button', { name: /^(确认|Confirm)$/i })
    if (await confirm.isVisible()) await confirm.click()
    else {
      await composer.fill('确认创建。')
      await view.getByRole('button', { name: 'Send', exact: true }).click()
    }
    await waitForAnswer(previousCount)
    await expect
      .poll(
        async () => {
          const response = await readTasks()
          return response.filter((task) => task.name === name).length
        },
        { timeout: 90_000, message: 'Agent must create a real task, not merely describe one' }
      )
      .toBe(1)
    const created = (await readTasks()).find((task) => task.name === name)!
    expect(created.prompt).toBe(prompt)
    expect(created.agentId).toBe(agentId)
    expect(created.trigger).toMatchObject({ kind: 'interval', ms: 300_000 })
    expect(created.enabled).toBe(true)
    const card = messages.filter({ has: page.getByRole('button', { name: /查看任务|View task/i }) }).last()
    await expect(card).toContainText(name)
    await expect(card).toContainText(/每\s*5\s*分钟|Every 5 minutes/i)
    await expect(card).toContainText(/已启用|Enabled/i)
    await screenshot('MP-145 created task card')
    const openTask = async () => {
      await card.getByRole('button', { name: /查看任务|View task/i }).click()
      await expect(page).toHaveURL(new RegExp(`/settings/scheduled-tasks/${created.id}`))
      await expect(page.getByText(name, { exact: true })).toBeVisible()
      await expect(page.getByText(prompt, { exact: true })).toBeVisible()
      await page.getByRole('tab', { name: 'General', exact: true }).click()
      await expect(page.getByText(agentName, { exact: true })).toBeVisible()
      await expect(page.getByText('Every 5 minutes', { exact: true })).toBeVisible()
    }
    await openTask()
    await screenshot('MP-145 corresponding task settings')
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    let result: string | null | undefined
    await expect
      .poll(
        async () => {
          const logs = await page.evaluate(
            ({ agentId, taskId }) =>
              window.api.dataApi.request({
                id: 'MP-145-read',
                method: 'GET',
                path: `/agents/${agentId}/tasks/${taskId}/logs`
              }),
            { agentId: agentId!, taskId: created.id }
          )
          expect(logs.status).toBe(200)
          const latest = (logs.data as { items: TaskRunLogEntity[] }).items[0]
          result = latest?.result
          return latest?.status
        },
        { timeout: 120_000 }
      )
      .toBe('completed')
    expect(result?.trim()).toBeTruthy()
    await page.goto(conversationUrl)
    await expect(card).toContainText(/已触发|Triggered/i)
    await expect(card).toContainText(result!)
    await screenshot('MP-145 triggered card and latest result')
    await openTask()
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(async () => (await readTasks()).some((task) => task.id === created.id)).toBe(false)
    await page.goto(conversationUrl)
    await expect(messages.last()).toContainText(/该定时任务已删除|This scheduled task has been deleted/i)
    await screenshot('MP-145 deleted task card')
  } finally {
    await screenshot('MP-145 final application state')
    const cleanupErrors = await page.evaluate(
      async ({ agentId, name, sessionsBefore }) => {
        const errors: string[] = []
        if (agentId) {
          const tasks = await window.api.dataApi.request({
            id: 'MP-145-read',
            method: 'GET',
            path: `/agents/${agentId}/tasks`
          })
          if (tasks.status === 200)
            for (const task of (tasks.data as { items: ScheduledTaskEntity[] }).items.filter(
              (task) => task.name === name
            )) {
              await window.api.ipcApi.request('ai.agent.task.delete', { agentId, taskId: task.id })
            }
        }
        const sessions = await window.api.dataApi.request({
          id: 'MP-145-read',
          method: 'GET',
          path: '/agent-sessions',
          params: { limit: 200 }
        })
        if (sessions.status === 200) {
          const sessionIds = (sessions.data as { items: { id: string }[] }).items
            .filter(({ id }) => !sessionsBefore.includes(id))
            .map(({ id }) => id)
          if (sessionIds.length) {
            for (const id of sessionIds) {
              const stopped = (await window.api.ipcApi.request('ai.stream.abort', {
                topicId: `agent-session:${id}`
              })) as IpcResult<void>
              if (!stopped.ok) errors.push(`Could not stop case session ${id}: ${stopped.error.code}`)
            }
            const deleted = (await window.api.ipcApi.request('ai.agent.session.delete_permanently', {
              sessionIds
            })) as IpcResult<{ deletedIds: string[] }>
            if (!deleted.ok) errors.push(`Could not delete case sessions: ${deleted.error.code}`)
            const remaining = await window.api.dataApi.request({
              id: 'MP-145-verify-cleanup',
              method: 'GET',
              path: '/agent-sessions',
              params: { ids: sessionIds }
            })
            if (remaining.status !== 200 || (remaining.data as { items: unknown[] }).items.length > 0)
              errors.push('cleanup left case sessions active')
          }
        } else {
          errors.push('Could not list case sessions for cleanup')
        }
        if (agentId) {
          const deletedAgent = (await window.api.ipcApi.request('ai.agent.delete_permanently', {
            agentId,
            deleteSessions: true
          })) as IpcResult<{ deleted: boolean }>
          if (!deletedAgent.ok || !deletedAgent.data.deleted) errors.push('cleanup left the case agent active')
        }
        return errors
      },
      { agentId, name, sessionsBefore }
    )
    expect
      .soft(cleanupErrors, 'Scheduled-task cleanup must not leave running sessions or mask the case failure')
      .toEqual([])
  }
}
