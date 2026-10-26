import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { formatShortcutDisplay, type ShortcutBinding } from '@shared/utils/shortcut'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { createAgent, selectAgentWorkspace, startNewAgentTask } from '../helpers/agents'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function agentRuntimeMessages(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const original = await page.evaluate(async () => ({
    send: await window.api.preference.get('chat.input.send_message_shortcut'),
    newline: await window.api.preference.get('chat.input.newline_shortcut'),
    steer: await window.api.preference.get('chat.input.steer_shortcut')
  }))
  const mac = app.record.platform === 'macos'
  const combinations: ShortcutBinding[] = [
    ['Enter'],
    ['Shift', 'Enter'],
    ['CommandOrControl', 'Enter'],
    ['Alt', 'Enter'],
    ...(mac ? [['Ctrl', 'Enter'] as ShortcutBinding] : [])
  ]
  const keys = (label: string) => {
    const binding = combinations.find((candidate) => formatShortcutDisplay(candidate, mac) === label)
    expect(binding, `Unknown shortcut displayed in settings: ${label}`).toBeDefined()
    return binding!
      .map((key) => (key === 'CommandOrControl' ? (mac ? 'Meta' : 'Control') : key === 'Ctrl' ? 'Control' : key))
      .join('+')
  }
  const name = app.resourceName('Runtime messages')
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  const composer = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  const messages = view.locator('[data-ui~="chat.message"]')
  const completed = view.getByTestId('completed-process-trigger')
  let labels: string[] = []
  try {
    await openSettingsSection(page, 'Appearance')
    for (const role of ['send', 'newline', 'steer']) {
      labels.push((await page.locator(`#setting-appearance-${role}-shortcuts [role="combobox"]`).innerText()).trim())
    }
    expect(new Set(labels).size).toBe(3)
    await testInfo.attach('MP-144 original shortcut bindings and model source', {
      body: JSON.stringify({ original, displayed: labels, modelSource: 'real configured custom provider' }),
      contentType: 'application/json'
    })
    await page.locator('#setting-appearance-send-shortcuts').scrollIntoViewIfNeeded()
    await screenshot('MP-144 input shortcut bindings')
    await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await createAgent(page, {
      name,
      runtime: 'Pi',
      permission: 'Full Access',
      model: app.config.customProvider.chatModel
    })
    await page.evaluate(({ path, name }) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name }), {
      path: app.paths.workspace,
      name: app.workspaceName
    })
    await selectAgentWorkspace(app, page)
    // The agent name is stable across runs, so a task from an earlier run may still hold messages:
    // start a fresh one before asserting on an empty history.
    await startNewAgentTask(page, name)
    await selectAgentWorkspace(app, page)

    const send = async (text: string, key = keys(labels[0])) => {
      await composer.fill(text)
      await composer.press(key)
    }
    const slow = async (marker: string) => {
      await send(
        `First output ${marker}_START. Then use your shell tool to run exactly: sleep 35. After the tool finishes output ${marker}_END. Do not skip the tool or simulate its result.`
      )
      await expect(view.getByTestId('live-tool-group')).toBeVisible({ timeout: 60_000 })
      await expect(view.getByTestId('child-tool-group')).toBeVisible({ timeout: 30_000 })
      await expect(view.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(completed).toHaveCount(0)
    }
    await composer.fill('MP144 newline first')
    await composer.press(keys(labels[1]))
    await composer.pressSequentially('MP144 newline second')
    expect(await composer.innerText()).toMatch(/MP144 newline first\n+MP144 newline second/)
    await expect(messages).toHaveCount(0)
    await slow('MP144_QUEUE')
    const queued = 'MP144 queued summary: reply with MP144_QUEUE_ACK only.'
    await send(queued)
    const queue = view.getByRole('button', { name: /^Queued \(/ })
    await expect(queue).toHaveText('Queued (1)')
    await queue.click()
    await expect(view.getByText(queued, { exact: true })).toBeVisible()
    await expect(messages.filter({ hasText: queued })).toHaveCount(0)
    await expect(completed).toHaveCount(0)
    await screenshot('MP-144 follow-up queued during active turn')
    await expect(messages.filter({ hasText: queued })).toHaveCount(1, { timeout: 120_000 })
    await expect(view.getByRole('button', { name: 'Pause', exact: true })).toBeHidden({ timeout: 120_000 })
    await expect(queue).toBeHidden()
    await expect(messages.filter({ hasText: queued })).toHaveCount(1)
    await expect(messages.filter({ hasText: 'MP144_QUEUE_ACK' }).last()).toBeVisible()
    const firstTurn = await messages.allTextContents()
    const firstEnd = firstTurn.findIndex((text) => text.includes('MP144_QUEUE_END') && !text.includes('First output'))
    expect(firstEnd).toBeGreaterThan(-1)
    expect(firstEnd).toBeLessThan(firstTurn.findIndex((text) => text.includes(queued)))

    await startNewAgentTask(page, name)
    await selectAgentWorkspace(app, page)
    await slow('MP144_STEER')
    const steer = 'MP144 steer now: acknowledge MP144_STEER_ACK in this turn before finishing the original task.'
    await send(steer, keys(labels[2]))
    await expect(messages.filter({ hasText: steer })).toHaveCount(1)
    await expect(queue).toBeHidden()
    await expect(view.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await expect(completed).toHaveCount(0)
    await screenshot('MP-144 steer injected into running conversation')

    const first = 'MP144 preserve queued original A'
    const second = 'MP144 queued original B'
    const edited = 'MP144 edited target B: reply MP144_EDIT_ACK'
    await send(first)
    await send(second)
    await expect(queue).toHaveText('Queued (2)')
    if ((await queue.getAttribute('aria-expanded')) === 'false') await queue.click()
    const row = (text: string) => view.getByText(text, { exact: true }).locator('..').locator('..')
    await row(first).hover()
    await row(first).getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(composer).toHaveText(first)
    await row(second).hover()
    await row(second).getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(composer).toHaveText(second)
    await send(edited)
    await expect
      .soft(queue, 'Switching edit target must preserve queued message A')
      .toHaveText('Queued (2)', { timeout: 1_000 })
    await expect
      .soft(view.getByText(first, { exact: true }), 'Original queued content must not disappear')
      .toBeVisible({ timeout: 1_000 })
    await expect(view.getByText(edited, { exact: true })).toBeVisible()
    await expect(view.getByText(second, { exact: true })).toHaveCount(0)
    await screenshot('MP-144 queued edit target switched and saved')
    await expect(messages.filter({ hasText: 'MP144_STEER_ACK' }).filter({ hasNotText: steer }).last()).toBeVisible({
      timeout: 120_000
    })
    await expect(view.getByRole('button', { name: 'Pause', exact: true })).toBeHidden({ timeout: 120_000 })
    const steerHistory = await messages.allTextContents()
    const acknowledgement = steerHistory.findIndex((text) => text.includes('MP144_STEER_ACK') && !text.includes(steer))
    const end = steerHistory.findIndex((text) => text.includes('MP144_STEER_END') && !text.includes('First output'))
    expect(acknowledgement).toBeGreaterThan(-1)
    expect(end).toBeGreaterThanOrEqual(acknowledgement)
    await expect(view.getByRole('button', { name: 'Pause', exact: true })).toBeHidden({ timeout: 120_000 })
    await expect
      .soft(messages.filter({ hasText: first }), 'Preserved queue A must eventually be delivered exactly once')
      .toHaveCount(1, { timeout: 1_000 })
    await expect(messages.filter({ hasText: edited })).toHaveCount(1)
    await expect(messages.filter({ hasText: second })).toHaveCount(0)

    await openSettingsSection(page, 'Appearance')
    const steerSelect = page.locator('#setting-appearance-steer-shortcuts [role="combobox"]')
    await steerSelect.click()
    const conflict = page.getByRole('option', { name: labels[0], exact: true })
    if (await conflict.isVisible()) await conflict.click()
    await screenshot('MP-144 conflicting shortcut attempt')
    await expect
      .soft(
        page.getByText(/This shortcut is already|Already used by|此快捷键已被占用|已被「.+」使用/).first(),
        'Conflicting steer binding must display an occupied shortcut explanation'
      )
      .toBeVisible({ timeout: 1_000 })
    await page.keyboard.press('Escape')
    await expect(steerSelect).toHaveText(labels[2])
    await expect(page.locator('#setting-appearance-send-shortcuts [role="combobox"]')).toHaveText(labels[0])
    await expect(page.locator('#setting-appearance-newline-shortcuts [role="combobox"]')).toHaveText(labels[1])
  } finally {
    const stop = view.getByRole('button', { name: 'Pause', exact: true })
    if (await stop.isVisible().catch(() => false)) await stop.click()
    await page.evaluate(
      ({ send, newline, steer }) =>
        window.api.preference.setMultiple({
          'chat.input.send_message_shortcut': send,
          'chat.input.newline_shortcut': newline,
          'chat.input.steer_shortcut': steer
        }),
      original
    )
  }
}
