import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AgentEntitySchema } from '@shared/data/api/schemas/agents'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startNewAgentTask } from '../helpers/agents'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function agentMemoryContext(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  testInfo.annotations.push({
    type: 'coverage',
    description:
      'This E2E verifies persisted Memory settings and retained snapshots. Runtime server filtering is covered by builtinAgentCapabilities.test.ts.'
  })
  testInfo.annotations.push({
    type: 'uncovered',
    description:
      'The Memory settings UI exposes a tool switch, but no persistent file-path display; the actual saved file is verified separately.'
  })
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await testInfo.attach('MP-57 model source and scope', {
    body: 'Real configured provider and Claude Agent runtime. This case verifies Memory settings persistence, the preserved FACT.md file, and retained context across new tasks. Runtime server filtering is verified separately in builtinAgentCapabilities.test.ts. No memory contents or model replies are seeded.',
    contentType: 'text/plain'
  })
  await screenshot('MP-57 application before memory setup')
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const name = app.resourceName(`Memory ${Date.now()}`)
  const models = await page.evaluate(() =>
    window.api.dataApi.request({ id: 'mp57-models', method: 'GET', path: '/models' })
  )
  expect(models.status).toBe(200)
  const available = models.data as { id: string; providerId: string; name: string }[]
  const model = available.find((item) => item.id.endsWith(`::${app.config.customProvider.chatModel}`))
  expect(model, 'The configured real provider model must be available').toBeDefined()
  const result = (await page.evaluate(
    ({ name, model }) =>
      window.api.ipcApi.request('ai.agent.create', {
        name,
        model,
        type: 'claude-code',
        disabledTools: [],
        instructions:
          'Follow the user request directly. Skip onboarding questions. Never invent a remembered project name.',
        configuration: { permission_mode: 'bypassPermissions', bootstrap_completed: true }
      }),
    { name, model: model!.id }
  )) as { ok: boolean; data: unknown }
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Agent creation failed')
  const agentId = AgentEntitySchema.parse(result.data).id
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  const composer = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  const pause = view.getByRole('button', { name: 'Pause', exact: true })
  const openMemorySettings = async () => {
    await view.getByRole('button', { name, exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit Agent', exact: true }).click()
    const dialog = page.getByRole('dialog').last()
    await dialog.getByRole('tab', { name: 'Built-in tools', exact: true }).click()
    return dialog
  }
  const send = async (prompt: string) => {
    const completed = view.getByTestId('completed-process-trigger')
    const before = await completed.count()
    await composer.fill(prompt)
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(completed).toHaveCount(before + 1, { timeout: 90_000 })
    await expect(pause).toBeHidden({ timeout: 90_000 })
    const reply = view.locator('[data-ui~="chat.message"]').last().locator('.markdown').last()
    await expect(reply).toBeVisible()
    return reply
  }
  try {
    await page.reload()
    await startNewAgentTask(page, name)
    const settings = await openMemorySettings()
    await expect(settings.getByRole('switch', { name: 'Memory', exact: true })).toBeChecked()
    await screenshot('MP-57 memory enabled in agent settings')
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()

    const saved = await send(
      '请记住：我的项目叫 QA-DEMO。使用 Memory 工具将它保存到 FACT.md。成功后回复已保存 QA-DEMO，并在单独一行用反引号给出实际 FACT.md 的绝对路径。不要用其他文件或 shell 工具。'
    )
    await expect(saved).toContainText('QA-DEMO')
    const filePath = saved
      .locator('code')
      .filter({ hasText: /[\\/]memory[\\/]FACT\.md$/ })
      .first()
    await expect(filePath, 'The successful memory write must identify its persistent file').toBeVisible()
    const path = await filePath.innerText()
    const readMemory = async () => {
      const response = (await page.evaluate(
        (handle) =>
          window.api.ipcApi.request('file.read', {
            handle,
            options: { mode: 'full', encoding: 'binary' }
          }),
        createFilePathHandle(AbsoluteFilePathSchema.parse(path))
      )) as { ok: boolean; data: { content: Uint8Array } }
      expect(response.ok).toBe(true)
      if (!response.ok) throw new Error('Memory file cannot be read')
      return new TextDecoder().decode(new Uint8Array(Object.values(response.data.content)))
    }
    const contents = await readMemory()
    expect(contents).toContain('QA-DEMO')
    await testInfo.attach('MP-57 persistent memory file', { body: contents, contentType: 'text/plain' })
    await screenshot('MP-57 memory saved to file')

    await startNewAgentTask(page, name)
    const recall = await send(
      '我的项目叫什么？只回答项目名。如果没有记忆则只回答 UNKNOWN。不要使用工具或搜索历史会话。'
    )
    await expect(recall).toHaveText('QA-DEMO')
    await view.getByRole('button', { name: 'Status', exact: true }).click()
    const category = page.getByText('Memory files', { exact: true })
    await expect.soft(category, 'Context panel must classify memory file token usage').toBeVisible({ timeout: 3_000 })
    if (await category.isVisible()) {
      await expect(category.locator('..')).toContainText(/[1-9][\d,]*\s*\(\d+%\)/)
    }
    await screenshot('MP-57 new session recall and context usage')

    const disabledSettings = await openMemorySettings()
    const toggle = disabledSettings.getByRole('switch', { name: 'Memory', exact: true })
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await page.keyboard.press('Escape')
    await expect(disabledSettings).toBeHidden()
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (agentId) =>
            window.api.dataApi.request({
              id: 'mp57-agent',
              method: 'GET',
              path: `/agents/${agentId}`
            }),
          agentId
        )
        expect(response.status).toBe(200)
        return AgentEntitySchema.parse(response.data).disabledTools
      })
      .toContain('mcp__agent-memory__memory')
    await startNewAgentTask(page, name)
    const afterDisable = await send(
      '我的项目叫什么？只回答项目名。如果没有记忆则只回答 UNKNOWN。不要使用工具或搜索历史会话。'
    )
    // Disabling Memory preserves existing identity snapshots; runtime server filtering has a separate unit test.
    await expect
      .soft(afterDisable, 'The retained FACT.md identity snapshot still reaches the agent')
      .toContainText('QA-DEMO')
    await view.getByRole('button', { name: 'Status', exact: true }).click()
    await expect
      .soft(
        page.getByText('Memory files', { exact: true }),
        'Disabling the Memory tools must not drop the retained memory context'
      )
      .toBeVisible({ timeout: 3_000 })
    expect(await readMemory(), 'Disabling memory must preserve the saved file').toBe(contents)
    await screenshot('MP-57 new session with memory disabled')
  } finally {
    if (await pause.isVisible().catch(() => false)) await pause.click()
    await page.evaluate(
      (agentId) =>
        window.api.ipcApi.request('ai.agent.delete', {
          agentId,
          deleteSessions: true,
          permanent: true
        }),
      agentId
    )
  }
}
