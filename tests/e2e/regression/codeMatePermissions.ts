import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { ensureCustomChatProvider } from './models'
import { openLaunchpadApp } from './navigation'
import type { RegressionApp } from './RegressionApp'
import { closeSettings } from './settings'

function appleScript(script: string, args: string[] = []): string {
  return execFileSync('osascript', ['-e', script, '--', ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
}

export async function verifyCodeMatePermissions(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(5 * 60_000)
  if (process.platform !== 'darwin') throw new Error('UNCOVERED: Terminal interaction requires macOS automation')
  const originalPreferences = await page.evaluate(() => window.api.preference.get('feature.code_cli.configs'))
  const readSettings = () =>
    page.evaluate(async () => {
      const result = (await window.api.ipcApi.request('code_cli.read_config', { targets: ['claude-settings'] })) as {
        ok: boolean
        data: { files: { target: string; path: string; content: string | null }[] }
        error?: { message: string }
      }
      if (!result.ok) throw new Error(result.error?.message ?? 'Failed to read CLI config')
      return result.data.files[0]
    })
  const originalSettings = await readSettings()
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  let terminalWindow: string | undefined
  const terminalText = () =>
    appleScript(
      `on run argv
    tell application "Terminal" to return contents of selected tab of window id (item 1 of argv as integer)
  end run`,
      [terminalWindow!]
    )
  const terminalInput = (text: string) =>
    appleScript(
      `on run argv
    tell application "Terminal"
      set index of window id (item 1 of argv as integer) to 1
      activate
    end tell
    tell application "System Events"
      tell process "Terminal"
        keystroke (item 2 of argv)
        key code 36
      end tell
    end tell
  end run`,
      [terminalWindow!, text]
    )
  const codeView = page.locator('[data-ui~="code.view"]:visible').first()
  const providerCard = codeView
    .getByText('Unified Gateway', { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(@class, "group") and .//button[normalize-space()="Configure"]][1]')
  const configure = async () => {
    await providerCard.hover()
    await providerCard.getByRole('button', { name: 'Configure', exact: true }).click()
    return page.getByRole('dialog').last()
  }
  const setParameters = async (permission: string, effort: string) => {
    const dialog = await configure()
    await dialog.getByRole('combobox', { name: 'Permission Approval', exact: true }).click()
    await page.getByRole('option', { name: permission, exact: true }).click()
    await dialog.getByRole('combobox', { name: 'Reasoning Effort', exact: true }).click()
    await page.getByRole('option', { name: effort, exact: true }).click()
    await dialog.getByRole('button', { name: 'Advanced Settings', exact: true }).click()
    await expect(dialog.locator('.cm-content').first()).toBeVisible()
    await attachScreenshot(`MP-97 ${permission} settings`)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
  const launch = async () => {
    const before = appleScript('tell application "Terminal" to return id of every window')
      .split(',')
      .map((v) => v.trim())
    await codeView.getByRole('button', { name: 'Launch', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Launch Claude Code', exact: true })
    await expect(dialog.getByRole('textbox')).toHaveValue(app.paths.workspace)
    await dialog.getByRole('button', { name: 'Launch', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(
        () => {
          const ids = appleScript('tell application "Terminal" to return id of every window')
            .split(',')
            .map((v) => v.trim())
          terminalWindow = ids.find((id) => id && !before.includes(id))
          return Boolean(terminalWindow)
        },
        { timeout: 30_000 }
      )
      .toBe(true)
    await expect.poll(() => terminalText(), { timeout: 45_000 }).toMatch(/trust|Welcome|Claude Code|❯/i)
    if (/trust this folder|trust the files|Yes, I trust/i.test(terminalText())) terminalInput('')
    if (/select login method|Please run \/login|Sign in to continue/i.test(terminalText())) {
      throw new Error('UNCOVERED: Claude Code requires an authenticated account')
    }
  }
  const closeTerminal = () => {
    if (!terminalWindow) return
    appleScript(
      `on run argv
      tell application "Terminal" to close window id (item 1 of argv as integer) saving no
    end run`,
      [terminalWindow]
    )
    terminalWindow = undefined
  }
  try {
    await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await page.evaluate(
      async ({ directory }) => {
        const configs = await window.api.preference.get('feature.code_cli.configs')
        const previous = configs['claude-code']
        await window.api.preference.set('feature.code_cli.configs', {
          ...configs,
          'claude-code': { providers: {}, current: null, ...previous, directory, terminal: 'Terminal' }
        })
      },
      { directory: app.paths.workspace }
    )
    await openLaunchpadApp(page, 'Code Mate')
    await page.getByRole('button', { name: 'Claude Code', exact: true }).first().click()
    const dialog = await configure()
    await dialog.getByRole('button', { name: 'Select a model', exact: true }).click()
    await page.getByRole('option').filter({ hasText: app.config.customProvider.chatModel }).first().click()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await providerCard.hover()
    const enable = providerCard.getByRole('button', { name: 'Enable', exact: true })
    if (await enable.isVisible()) await enable.click()
    await setParameters('Accept Edits', 'High')
    await expect
      .poll(async () => JSON.parse((await readSettings()).content ?? '{}'))
      .toMatchObject({
        permissions: { defaultMode: 'acceptEdits' },
        effortLevel: 'high'
      })
    const reopened = await configure()
    await expect(reopened.getByRole('combobox', { name: 'Permission Approval', exact: true })).toContainText(
      'Accept Edits'
    )
    await expect(reopened.getByRole('combobox', { name: 'Reasoning Effort', exact: true })).toContainText('High')
    await reopened.getByRole('button', { name: 'Advanced Settings', exact: true }).click()
    const editor = reopened.locator('.cm-content').first()
    await expect(editor).toBeVisible()
    const validText = (await readSettings()).content!
    // Valid JSON with an invalid enum must be rejected, not just syntax errors.
    for (const invalid of [{ permissions: { defaultMode: 'mp97-invalid' } }, { effortLevel: 'mp97-invalid' }]) {
      const invalidText = JSON.stringify({ ...JSON.parse(validText), ...invalid }, null, 2)
      await editor.fill(invalidText)
      await attachScreenshot('MP-97 invalid parameter validation')
      const save = reopened.getByRole('button', { name: 'Save', exact: true })
      if (await save.isEnabled()) {
        await save.click()
        await expect
          .poll(async () => !(await reopened.isVisible()) || (await save.isEnabled()), {
            message: 'Wait for the save attempt to finish'
          })
          .toBe(true)
        await attachScreenshot('MP-97 after invalid save attempt')
        const saved = JSON.parse((await readSettings()).content ?? '{}')
        expect(
          { permission: saved.permissions?.defaultMode, effort: saved.effortLevel },
          'Rejecting an invalid parameter must preserve the valid CLI parameters'
        ).toEqual({
          permission: 'acceptEdits',
          effort: 'high'
        })
        await expect(reopened, 'Invalid CLI parameters must be rejected by the configuration dialog').toBeVisible()
      }
      await expect(save, 'Invalid CLI parameter must block Save').toBeDisabled()
      expect(JSON.parse((await readSettings()).content ?? '{}')).toMatchObject({
        permissions: { defaultMode: 'acceptEdits' },
        effortLevel: 'high'
      })
    }
    await reopened.getByRole('button', { name: 'Cancel', exact: true }).click()

    const file = join(app.paths.workspace, 'mp97-permissions.txt')
    await writeFile(file, 'original\n')
    await launch()
    expect(terminalText()).toMatch(/trust|safety|security|permission/i)
    for (const marker of ['MP97-AUTO-FIRST', 'MP97-AUTO-SECOND']) {
      terminalInput(
        `Use the Edit tool to replace the entire content of mp97-permissions.txt with ${marker}. Do not use Bash.`
      )
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 60_000 }).toContain(marker)
      expect(terminalText()).not.toMatch(/Do you want to (?:make this edit|proceed)\?/i)
    }
    await attachScreenshot('MP-97 automatic edits completed')
    closeTerminal()
    await setParameters('Default', 'Default')
    await expect
      .poll(async () => JSON.parse((await readSettings()).content ?? '{}'))
      .toMatchObject({ permissions: { defaultMode: 'default' } })
    expect(JSON.parse((await readSettings()).content ?? '{}').effortLevel).toBeUndefined()
    await launch()
    for (const marker of ['MP97-ASK-FIRST', 'MP97-ASK-SECOND']) {
      const previous = await readFile(file, 'utf8')
      terminalInput(
        `Use the Edit tool to replace the entire content of mp97-permissions.txt with ${marker}. Do not use Bash.`
      )
      await expect.poll(terminalText, { timeout: 60_000 }).toMatch(/Do you want to (?:make this edit|proceed)\?/i)
      expect(await readFile(file, 'utf8')).toBe(previous)
      terminalInput('1')
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 60_000 }).toContain(marker)
    }
    await attachScreenshot('MP-97 per-edit confirmation restored')
  } finally {
    closeTerminal()
    await page.keyboard.press('Escape')
    await page.evaluate(
      async ({ configs, original }) => {
        await window.api.preference.set('feature.code_cli.configs', configs)
        if (original.content !== null)
          await window.api.ipcApi.request('code_cli.write_config', {
            cliTool: 'claude-code',
            files: [{ target: 'claude-settings', content: original.content }]
          })
      },
      { configs: originalPreferences, original: originalSettings }
    )
  }
}
