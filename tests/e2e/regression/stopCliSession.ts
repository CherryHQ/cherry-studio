import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { openLaunchpadApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

function processes() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,tty=,command='], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]), tty: match[3], command: match[4] }] : []
    })
}

function terminal(tty: string, command?: string): string {
  return execFileSync(
    'osascript',
    [
      '-e',
      `tell application "Terminal"
repeat with w in windows
repeat with t in tabs of w
if tty of t is ${JSON.stringify(`/dev/${tty}`)} then
${command === undefined ? 'return contents of t' : `do script ${JSON.stringify(command)} in t\nreturn "sent"`}
end if
end repeat
end repeat
error "Case-owned terminal tab not found"
end tell`
    ],
    { encoding: 'utf8', timeout: 10_000 }
  )
}

export async function stopCliSession(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const original = await page.evaluate(() => window.api.preference.get('feature.code_cli.configs'))
  const errors: string[] = []
  const onError = (error: Error) => errors.push(error.message)
  page.on('pageerror', onError)
  const owned = new Set<number>()
  try {
    await page.evaluate(
      async ({ original, directory }) => {
        await window.api.preference.set('feature.code_cli.configs', {
          ...original,
          'claude-code': {
            providers: { 'cherry:cli-own-login': { modelId: null } },
            current: 'cherry:cli-own-login',
            terminal: 'Terminal',
            directory
          }
        })
      },
      { original, directory: app.paths.workspace }
    )
    await openLaunchpadApp(page, 'Code Mate')
    await page
      .locator('[data-ui~="code.navigation"]:visible')
      .getByRole('button', { name: /Claude Code/ })
      .click()
    const view = page.locator('[data-ui~="code.view"]:visible').first()
    const launch = async () => {
      const baseline = new Set(processes().map(({ pid }) => pid))
      await view.getByRole('button', { name: 'Launch', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('textbox')).toHaveValue(app.paths.workspace)
      await expect(dialog.getByRole('combobox')).toHaveText('Terminal')
      await dialog.getByRole('button', { name: 'Launch', exact: true }).click()
      await expect(dialog).toBeHidden()
      let session: ReturnType<typeof processes>[number] | undefined
      await expect
        .poll(
          () => {
            session = processes().find(
              ({ pid, command, tty }) => !baseline.has(pid) && tty !== '??' && /(?:^|\/)claude(?:\s|$)/.test(command)
            )
            if (session) owned.add(session.pid)
            return !!session
          },
          { timeout: 30_000, message: 'Launch must start a real CLI process in a terminal' }
        )
        .toBe(true)
      if (!session) throw new Error('CLI session missing')
      return session
    }

    const first = await launch()
    await screenshot('MP-98 running CLI session')
    // CLI shell mode executes locally and does not require a model response.
    terminal(first.tty, '!sleep 60')
    let sleeper: ReturnType<typeof processes>[number] | undefined
    await expect
      .poll(
        () => {
          sleeper = processes().find(({ tty, command }) => tty === first.tty && /(?:^|\/)sleep 60$/.test(command))
          if (sleeper) owned.add(sleeper.pid)
          return !!sleeper
        },
        { timeout: 15_000, message: 'The long command must actually be running before Stop' }
      )
      .toBe(true)
    const sessionPids = processes()
      .filter(({ tty }) => tty === first.tty)
      .map(({ pid }) => pid)
    const stop = view.getByRole('button', { name: 'Stop', exact: true })
    await expect(stop, 'A running CLI session must expose Stop in Code Mate').toBeVisible({ timeout: 5_000 })
    await stop.dblclick()
    await expect
      .poll(() => processes().filter(({ pid }) => sessionPids.includes(pid) && owned.has(pid)), {
        timeout: 10_000,
        message: 'ps must show neither the stopped CLI nor its sleep child'
      })
      .toEqual([])
    await expect(view.getByText(/stopped/i).first()).toBeVisible()
    expect(errors, 'Repeated Stop must not cause renderer errors').toEqual([])
    await screenshot('MP-98 stopped terminal panel')

    const config = await page.evaluate(() => window.api.preference.get('feature.code_cli.configs'))
    expect(config['claude-code']).toEqual({
      providers: { 'cherry:cli-own-login': { modelId: null } },
      current: 'cherry:cli-own-login',
      terminal: 'Terminal',
      directory: app.paths.workspace
    })
    const second = await launch()
    expect(second.pid).not.toBe(first.pid)
    const marker = `MP98-RESTART-${Date.now()}`
    terminal(second.tty, `!printf '${marker}:%s\\n' "$PWD"`)
    await expect.poll(() => terminal(second.tty)).toContain(`${marker}:${app.paths.workspace}`)
    await screenshot('MP-98 new session with retained configuration')
    await stop.click()
    await expect.poll(() => processes().some(({ pid }) => pid === second.pid)).toBe(false)
  } finally {
    for (const pid of owned) {
      if (processes().some((entry) => entry.pid === pid)) process.kill(pid, 'SIGTERM')
    }
    page.off('pageerror', onError)
    await page.evaluate((original) => window.api.preference.set('feature.code_cli.configs', original), original)
  }
}
