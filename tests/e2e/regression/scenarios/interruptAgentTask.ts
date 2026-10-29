import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { AgentEntity, AgentSessionMessageEntity } from '@shared/data/types/agent'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { listProcesses } from '../../../../scripts/e2e/regression/processEvidence'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startNewAgentTask } from '../helpers/agents'
import { selectVisibleModel } from '../helpers/models'
import type { RegressionApp } from '../RegressionApp'

export async function interruptAgentTask(
  app: RegressionApp,
  page: Page,
  testInfo: TestInfo,
  model: string,
  providerId: string
): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const agents = await page.evaluate(() =>
    window.api.dataApi.request({
      id: 'mp56-agents',
      method: 'GET',
      path: '/agents'
    })
  )
  expect(agents.status).toBe(200)
  const agent = (agents.data as { items: AgentEntity[] }).items.find(
    (agent) => agent.configuration?.builtin_role === 'assistant'
  )
  expect(agent).toBeDefined()
  await startNewAgentTask(page, agent!.name)
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  await view
    .getByRole('button', { name: 'Select Model', exact: true })
    .or(view.locator('button:has(span[title*=" | "])'))
    .first()
    .click()
  await selectVisibleModel(page, model, providerId)
  const composer = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  await composer.press(app.record.platform === 'macos' ? 'Meta+A' : 'Control+A')
  await composer.press('Backspace')
  await expect(composer.locator('[data-composer-token-kind="skill"]')).toHaveCount(0)

  const tag = `MP56_PROCESS_${Date.now()}`
  const command =
    app.record.platform === 'windows'
      ? `node -e "setTimeout(function(){process.stdout.write('${tag}_FINISHED')},60000)"`
      : `/bin/sh -c 'sleep 60; printf ${tag}_FINISHED' ${tag}`
  const tracked = new Set<number>()
  const pause = view.locator('[data-ui~="chat.composer.action.pause"]')
  const gateway = await page.evaluate(async () => ({
    enabled: await window.api.preference.get('feature.api_gateway.enabled'),
    host: await window.api.preference.get('feature.api_gateway.host'),
    port: await window.api.preference.get('feature.api_gateway.port')
  }))
  const portServer = createServer()
  await new Promise<void>((resolve, reject) => {
    portServer.once('error', reject)
    portServer.listen(0, '127.0.0.1', resolve)
  })
  const address = portServer.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate gateway port')
  const port = address.port
  await new Promise<void>((resolve, reject) => portServer.close((error) => (error ? reject(error) : resolve())))
  try {
    if (!gateway.enabled) {
      await page.evaluate(
        (port) =>
          window.api.preference.setMultiple({
            'feature.api_gateway.host': '127.0.0.1',
            'feature.api_gateway.port': port
          }),
        port
      )
      expect(await page.evaluate(() => window.api.ipcApi.request('api_gateway.start'))).toEqual({
        ok: true,
        data: { success: true }
      })
    }
    // Uses the configured real provider; only a real shell and sleep process satisfy this precondition.
    await composer.fill(
      `Execute this exact shell command once, in the foreground, with a timeout of at least 90 seconds: ${command}. Do not use background mode. After it finishes, run a second tool command: printf ${tag}_UNEXPECTED_TOOL. Do not do anything else.`
    )
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect
      .poll(
        async () => {
          const allow = page.getByRole('button', { name: /Allow/ }).first()
          if (await allow.isVisible().catch(() => false)) await allow.click()
          const table = listProcesses(app.record)
          const roots = table.filter((p) => p.command.includes(tag))
          for (const p of roots) tracked.add(p.pid)
          for (let i = 0; i < table.length; i++) {
            for (const p of table) if (tracked.has(p.parentPid)) tracked.add(p.pid)
          }
          return table.some((p) => {
            if (!tracked.has(p.pid)) return false
            if (app.record.platform !== 'windows') return /(?:^|\/)sleep 60$/.test(p.command)
            const executable = p.command.startsWith('"')
              ? p.command.slice(1, p.command.indexOf('"', 1))
              : p.command.split(/\s/)[0]
            return /(?:^|[\\/])node(?:\.exe)?$/i.test(executable) && p.command.includes(tag)
          })
        },
        { timeout: 90_000, intervals: [250, 500, 1000] }
      )
      .toBe(true)
    await testInfo.attach('MP-56 running process tree', {
      body: JSON.stringify(
        listProcesses(app.record).filter((p) => tracked.has(p.pid)),
        null,
        2
      ),
      contentType: 'application/json'
    })
    await expect(pause).toBeVisible()
    await screenshot('MP-56 long command running')
    const latest = await page.evaluate(() =>
      window.api.dataApi.request({
        id: 'mp56-session',
        method: 'GET',
        path: '/agent-sessions/latest'
      })
    )
    expect(latest.status).toBe(200)
    const sessionId = (latest.data as { session: { id: string } }).session.id
    const readMessages = async () => {
      const response = await page.evaluate(
        (sessionId) =>
          window.api.dataApi.request({
            id: 'mp56-messages',
            method: 'GET',
            path: `/agent-sessions/${sessionId}/messages`
          }),
        sessionId
      )
      expect(response.status).toBe(200)
      const data = response.data as { items: AgentSessionMessageEntity[]; nextCursor?: string }
      expect(data.nextCursor).toBeUndefined()
      return data.items
    }
    const toolIds = (messages: AgentSessionMessageEntity[]) =>
      messages
        .flatMap((message) =>
          (message.data.parts ?? []).flatMap((part) => ('toolCallId' in part ? [part.toolCallId] : []))
        )
        .sort()
    const stoppedAt = Date.now()
    await pause.click()
    await expect(pause).toBeHidden({ timeout: 10_000 })
    await expect
      .soft(view.getByText(/Chat completion paused|Cancelled/, { exact: true }).first())
      .toBeVisible({ timeout: 3000 })
    await expect
      .poll(async () => (await readMessages()).some((m) => m.role === 'assistant' && m.status === 'paused'))
      .toBe(true)
    await expect
      .poll(() => listProcesses(app.record).filter((p) => tracked.has(p.pid)), { timeout: 10_000 })
      .toEqual([])
    expect(Date.now() - stoppedAt).toBeLessThan(20_000)
    const stoppedMessages = await readMessages()
    const before = toolIds(stoppedMessages)
    expect(before).toHaveLength(1)
    expect(JSON.stringify(stoppedMessages.filter((m) => m.role === 'assistant'))).toContain(command)
    await page.keyboard.press('Escape')
    // Observe for delayed tool scheduling and repeated cancellation after the stop button disappears.
    const deadline = Date.now() + 3000
    do {
      expect(toolIds(await readMessages())).toEqual(before)
      expect(listProcesses(app.record).filter((p) => tracked.has(p.pid) || p.command.includes(tag))).toEqual([])
      await expect(pause).toBeHidden()
      await page.waitForTimeout(250)
    } while (Date.now() < deadline)
    expect(await readMessages()).toEqual(stoppedMessages)
    await screenshot('MP-56 after stop and process cleanup')
    await testInfo.attach('MP-56 process cleanup', {
      body: JSON.stringify({
        trackedPids: [...tracked],
        remaining: listProcesses(app.record).filter((p) => tracked.has(p.pid))
      }),
      contentType: 'application/json'
    })

    const marker = `MP56_SESSION_USABLE_${Date.now()}`
    await composer.fill(`Do not use any tools. Reply with exactly ${marker}.`)
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(
      view.locator('[data-ui~="chat.message"][data-message-id]').getByText(marker, { exact: true }).last()
    ).toBeVisible({ timeout: 60_000 })
    await expect(pause).toBeHidden({ timeout: 30_000 })
    const after = await readMessages()
    expect(
      after.some((m) => m.role === 'assistant' && m.status === 'success' && m.searchableText.includes(marker))
    ).toBe(true)
    expect(toolIds(after)).toEqual(before)
    await screenshot('MP-56 same session usable after interruption')
  } finally {
    if (await pause.isVisible().catch(() => false)) await pause.click()
    if (!gateway.enabled) {
      await page.evaluate(async (gateway) => {
        await window.api.ipcApi.request('api_gateway.stop')
        await window.api.preference.setMultiple({
          'feature.api_gateway.host': gateway.host,
          'feature.api_gateway.port': gateway.port
        })
      }, gateway)
    }
    for (const p of listProcesses(app.record).filter((p) => tracked.has(p.pid))) {
      try {
        process.kill(p.pid, 'SIGTERM')
      } catch {
        /* Process exited between observation and cleanup. */
      }
    }
  }
}
