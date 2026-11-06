import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { TerminalApp } from '@shared/types/codeCli'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import {
  cleanupExternalResources,
  observeExternalResource,
  registerExternalResource
} from '../../../../scripts/e2e/regression/externalResources'
import { createRedactor } from '../../../../scripts/e2e/regression/redaction'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import {
  listWindowsCodeTerminals,
  windowsTerminalText,
  type WindowsTerminal
} from '../../../../scripts/e2e/regression/windowsTerminal'
import { ensureCustomChatProvider } from '../helpers/models'
import { openLaunchpadApp } from '../helpers/navigation'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

function appleScript(script: string, args: string[] = []): string {
  return execFileSync('osascript', ['-e', script, '--', ...args], { encoding: 'utf8', timeout: 10_000 }).trim()
}

export async function verifyCodeMatePermissions(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  testInfo.setTimeout(8 * 60_000)
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
  let windowsTerminal: WindowsTerminal | undefined
  let terminalResource: string | undefined
  const windowContents = (id: string) =>
    app.record.platform === 'windows'
      ? windowsTerminalText(app.paths, windowsTerminal!)
      : appleScript(
          `on run argv
    tell application "Terminal" to return contents of selected tab of window id (item 1 of argv as integer)
  end run`,
          [id]
        )
  const terminalText = () => windowContents(terminalWindow!)
  // Ownership requires a new window and tty, plus workspace evidence from its buffer or a process cwd.
  const terminalWindows = () =>
    appleScript(
      `on run
    set rows to {}
    if application "Terminal" is not running then return ""
    tell application "Terminal"
      repeat with w in windows
        if (count of tabs of w) > 0 then
          set t to selected tab of w
          set end of rows to ((id of w as text) & "|" & (tty of t as text))
        end if
      end repeat
    end tell
    set AppleScript's text item delimiters to linefeed
    return rows as text
  end run`
    )
      .split('\n')
      .map((line) => line.split('|').map((part) => part.trim()))
      .filter((parts) => parts.length === 2)
      .map(([id, tty]) => ({ id, tty }))
  const frontWindowId = () => {
    try {
      return appleScript('tell application "Terminal" to return id of front window as text')
    } catch {
      return ''
    }
  }
  const workspaceSpellings = () => {
    const resolved = (path: string) => {
      try {
        return realpathSync(path)
      } catch {
        return path
      }
    }
    return [...new Set([app.paths.workspace, resolved(app.paths.workspace)])]
  }
  const showsWorkspace = (contents: string) =>
    workspaceSpellings().some((path) => {
      for (let index = contents.indexOf(path); index >= 0; index = contents.indexOf(path, index + 1)) {
        const next = contents[index + path.length]
        if (next === undefined || !/[A-Za-z0-9._-]/.test(next)) return true
      }
      return false
    })
  const ttyRunsInWorkspace = (tty: string) => {
    const device = tty.replace('/dev/', '')
    const spellings = workspaceSpellings()
    return execFileSync('/bin/ps', ['-Ao', 'pid=,tty=,command='], { encoding: 'utf8' })
      .split('\n')
      .some((row) => {
        const match = row.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/)
        if (!match || match[2] !== device) return false
        let cwd: string
        try {
          cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', match[1], '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
        } catch {
          // The process exited between ps and lsof; nothing to prove either way.
          return false
        }
        const reported = cwd
          .split('\n')
          .find((line) => line.startsWith('n'))
          ?.slice(1)
        return reported !== undefined && spellings.includes(reported)
      })
  }
  const windowContentsIfAlive = (id: string): string | null => {
    try {
      return windowContents(id)
    } catch (error) {
      // A window that vanished mid-poll is somebody else's business; any other failure is real.
      if (/\(-1728\)|Can.t get window|owned CLI terminal is no longer running/.test(String(error))) return null
      throw error
    }
  }
  const terminalInput = (text: string, keyCode = 36) =>
    app.record.platform === 'windows'
      ? windowsTerminalText(
          app.paths,
          windowsTerminal!,
          text,
          ({ 36: 13, 53: 27, 125: 40 } as Record<number, number>)[keyCode]
        )
      : appleScript(
          `on run argv
    tell application "Terminal"
      set index of window id (item 1 of argv as integer) to 1
      activate
    end tell
    tell application "System Events"
      tell process "Terminal"
        keystroke (item 2 of argv)
        key code (item 3 of argv as integer)
      end tell
    end tell
  end run`,
          [terminalWindow!, text, String(keyCode)]
        )
  const codeView = page.locator('[data-ui~="code.view"]:visible').first()
  const providerCard = codeView
    .locator('[data-ui~="code.provider-card"]')
    .filter({ has: page.getByText('Unified Gateway', { exact: true }) })
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
    const resource = registerExternalResource(app.paths, app.record.platform, {
      kind: 'terminal',
      directory: app.paths.workspace
    })
    terminalResource = resource
    const baselineWindows = app.record.platform === 'windows' ? listWindowsCodeTerminals(app.paths) : []
    const baseline = app.record.platform === 'macos' ? terminalWindows() : []
    const baselineIds = baseline.map((w) => w.id)
    const baselineTtys = baseline.map((w) => w.tty)
    await codeView.getByRole('button', { name: 'Launch', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Launch Claude Code', exact: true })
    await expect(dialog.getByRole('textbox')).toHaveValue(app.paths.workspace)
    if (app.record.platform === 'windows') {
      await dialog.getByRole('combobox').click()
      await page.getByRole('option', { name: 'Command Prompt', exact: true }).click()
    }
    await dialog.getByRole('button', { name: 'Launch', exact: true }).click()
    await expect(dialog).toBeHidden()
    if (app.record.platform === 'windows') {
      await expect
        .poll(
          () => {
            const terminals = listWindowsCodeTerminals(app.paths).filter(
              (candidate) =>
                !baselineWindows.some(
                  (previous) => previous.pid === candidate.pid && previous.startedAt === candidate.startedAt
                )
            )
            if (terminals.length === 1) windowsTerminal = terminals[0]
            return terminals.length
          },
          { timeout: 45_000 }
        )
        .toBe(1)
      terminalWindow = String(windowsTerminal!.pid)
    } else {
      let observed = ''
      const deadline = Date.now() + 45_000
      while (!terminalWindow && Date.now() < deadline) {
        const candidates = terminalWindows().filter(
          (w) => w.tty && !baselineIds.includes(w.id) && !baselineTtys.includes(w.tty)
        )
        const evidence = candidates.map((w) => ({
          ...w,
          buffer: showsWorkspace(windowContentsIfAlive(w.id) ?? ''),
          cwd: ttyRunsInWorkspace(w.tty)
        }))
        observed = evidence.map((w) => `${w.id}@${w.tty} (buffer: ${w.buffer}, cwd: ${w.cwd})`).join(', ')
        const front = frontWindowId()
        const owned = evidence
          .filter((w) => w.buffer || w.cwd)
          .sort((a, b) => Number(b.id === front) - Number(a.id === front))[0]
        terminalWindow = owned?.id
        if (!terminalWindow) await new Promise((resolve) => setTimeout(resolve, 500))
      }
      if (!terminalWindow) {
        throw new Error(
          `MP-97 could not verify which Terminal window this launch opened; new windows: ${observed || 'none'}`
        )
      }
    }
    observeExternalResource(app.paths, resource)
    for (let screen = 0; screen < 6; screen++) {
      await expect
        .poll(terminalText, { timeout: 45_000 })
        .toMatch(
          /Choose the text style|terminal setup|Press Enter to continue|trust this folder|trust the files|Yes, I trust|Make auto mode your default|select login method|Please run \/login|Sign in to continue|for shortcuts|shift\+tab/i
        )
      const contents = terminalText()
      if (/select login method|Please run \/login|Sign in to continue/i.test(contents)) {
        throw new Error('UNCOVERED: Claude Code requires an authenticated account')
      }
      if (/Use Claude Code's terminal setup/i.test(contents)) {
        terminalInput('', 53)
      } else if (/Make auto mode your default permission mode/i.test(contents)) {
        if (/❯\s*Yes, set auto mode/i.test(contents)) {
          terminalInput('', 125)
          await expect.poll(terminalText).toMatch(/❯\s*No, keep/i)
        }
        terminalInput('')
      } else if (/Yes, I trust this folder/i.test(contents)) {
        if (/❯\s*No, exit/i.test(contents)) {
          terminalInput('', 125)
          await expect.poll(terminalText).toMatch(/❯\s*Yes, I trust this folder/i)
        }
        terminalInput('')
      } else if (
        /Choose the text style|Press Enter to continue|trust this folder|trust the files|Yes, I trust/i.test(contents)
      ) {
        terminalInput('')
      } else {
        return
      }
      await expect.poll(terminalText, { timeout: 30_000 }).not.toBe(contents)
    }
    throw new Error('Claude Code onboarding did not reach its input prompt')
  }
  const closeTerminal = () => {
    if (!terminalResource) return
    cleanupExternalResources(app.paths, [terminalResource])
    terminalResource = undefined
    terminalWindow = undefined
    windowsTerminal = undefined
  }
  try {
    await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await page.evaluate(
      async ({ directory, terminal }) => {
        const configs = await window.api.preference.get('feature.code_cli.configs')
        const previous = configs['claude-code']
        await window.api.preference.set('feature.code_cli.configs', {
          ...configs,
          'claude-code': { providers: {}, current: null, ...previous, directory, terminal }
        })
      },
      {
        directory: app.paths.workspace,
        terminal: app.record.platform === 'macos' ? TerminalApp.SYSTEM_DEFAULT : TerminalApp.CMD
      }
    )
    await openLaunchpadApp(page, 'Code Mate')
    await codeView
      .locator('[data-ui~="code.navigation"]')
      .getByRole('button', { name: /^Claude Code\b/ })
      .click()
    const dialog = await configure()
    const modelSelection = dialog.getByRole('button', { name: 'Model Selection', exact: true })
    await modelSelection.click()
    const modelOption = page.getByRole('option').filter({ hasText: app.config.customProvider.chatModel }).first()
    const modelUnchanged = (await modelOption.getAttribute('aria-selected')) === 'true'
    await modelOption.click()
    await dialog.getByRole('button', { name: modelUnchanged ? 'Cancel' : 'Save', exact: true }).click()
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
    // Unsupported enum values are sanitized on save instead of blocking it.
    const unsupported = JSON.stringify(
      { ...JSON.parse(validText), permissions: { defaultMode: 'mp97-invalid' }, effortLevel: 'mp97-invalid' },
      null,
      2
    )
    await editor.fill(unsupported)
    await attachScreenshot('MP-97 unsupported CLI parameter values')
    const save = reopened.getByRole('button', { name: 'Save', exact: true })
    await expect(save, 'Unsupported CLI parameter values must not block Save').toBeEnabled()
    await save.click()
    await expect(reopened).toBeHidden()
    const sanitized = JSON.parse((await readSettings()).content ?? '{}')
    expect(sanitized.permissions?.defaultMode, 'An unsupported approval mode must not persist').not.toBe('mp97-invalid')
    expect(sanitized.effortLevel, 'An unsupported reasoning effort must not persist').not.toBe('mp97-invalid')
    expect(sanitized.permissions?.defaultMode).toBeUndefined()
    expect(sanitized.effortLevel).toBeUndefined()
    expect(sanitized.env).toMatchObject(JSON.parse(validText).env)

    // Malformed JSON is the rejection path the editor enforces.
    const malformed = await configure()
    await malformed.getByRole('button', { name: 'Advanced Settings', exact: true }).click()
    const malformedEditor = malformed.locator('.cm-content').first()
    await expect(malformedEditor).toBeVisible()
    await malformedEditor.fill('{ "permissions": ')
    await attachScreenshot('MP-97 malformed CLI configuration')
    await expect(
      malformed.getByRole('button', { name: 'Save', exact: true }),
      'Malformed JSON must block Save'
    ).toBeDisabled()
    await malformed.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(malformed).toBeHidden()

    // Sanitizing the unsupported enums also drops the managed mode, so the automatic-edit run has
    // to restore Accept Edits and confirm it persisted before launching.
    await setParameters('Accept Edits', 'High')
    await expect
      .poll(async () => JSON.parse((await readSettings()).content ?? '{}'))
      .toMatchObject({ permissions: { defaultMode: 'acceptEdits' } })

    const file = join(app.paths.workspace, 'mp97-permissions.txt')
    await writeFile(file, 'original\n')
    await launch()
    for (const marker of ['MP97-AUTO-FIRST', 'MP97-AUTO-SECOND']) {
      terminalInput(
        `Use the Edit tool to replace the entire content of mp97-permissions.txt with ${marker}. Do not use Bash.`
      )
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 60_000 }).toContain(marker)
      expect(terminalText()).not.toMatch(/Do you want to (?:make this edit(?: to [^\r\n?]+)?|proceed)\?/i)
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
      await expect
        .poll(terminalText, { timeout: 60_000 })
        .toMatch(/Do you want to (?:make this edit(?: to [^\r\n?]+)?|proceed)\?/i)
      expect(await readFile(file, 'utf8')).toBe(previous)
      terminalInput('1')
      await expect.poll(() => readFile(file, 'utf8'), { timeout: 60_000 }).toContain(marker)
    }
    await attachScreenshot('MP-97 per-edit confirmation restored')
  } catch (error) {
    if (terminalWindow) {
      const contents = windowContentsIfAlive(terminalWindow)
      if (contents !== null) {
        await testInfo.attach('MP-97 terminal failure state', {
          body: createRedactor(getSensitiveConfigValues())(contents),
          contentType: 'text/plain'
        })
      }
    }
    throw error
  } finally {
    try {
      try {
        closeTerminal()
      } finally {
        await page.evaluate(
          (configs) => window.api.preference.set('feature.code_cli.configs', configs),
          originalPreferences
        )
      }
      await page.keyboard.press('Escape')
    } finally {
      if (originalSettings.content === null) await rm(originalSettings.path, { force: true })
      else await writeFile(originalSettings.path, originalSettings.content)
    }
  }
}
