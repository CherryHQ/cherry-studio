import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { createProfileEnvironment } from '../../../../scripts/e2e/regression/lifecycle'
import { findListeningPid } from '../../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

const exec = promisify(execFile)

export async function singleInstanceRelaunch(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  // Catches duplicate database owners, lost second-launch focus, and dropped deep-link arguments.
  const record = app.record
  expect(record.platform).toBe('macos')
  expect(findListeningPid(record.platform, record.cdpPort)).toBe(record.electronPid)
  const { stdout: cwd } = await exec('lsof', ['-a', '-p', String(record.electronPid), '-d', 'cwd', '-Fn'])
  // Installer launches run from the executable's directory and record it in `cwd`;
  // only branch launches start from the repository root.
  expect(cwd.split('\n')).toContain(`n${record.cwd}`)
  const { stdout: binaries } = await exec('lsof', ['-a', '-p', String(record.electronPid), '-d', 'txt', '-Fn'])
  const executable =
    record.executablePath ??
    binaries
      .split('\n')
      .find((line) => /\.app\/Contents\/MacOS\/Electron$/.test(line))
      ?.slice(1)
  if (!executable) throw new Error('Could not identify the owned application executable')
  const bundle = executable.slice(0, executable.indexOf('.app/') + 4)
  expect(bundle).toMatch(/\.app$/)
  const args =
    record.mode === 'branch' ? [record.targetRoot] : [`--user-data-dir=${app.paths.profiles}/${record.profile}`]
  const environment: NodeJS.ProcessEnv = {
    ...createProfileEnvironment(app.paths, record.profile),
    CS_DEV_PROFILE_ROOT: `${app.paths.profiles}/${record.profile}`,
    CS_DEV_USER_DATA_SUFFIX: `Regression-${record.runKey}-${record.profile}`,
    ...(record.mode === 'branch'
      ? {
          ELECTRON_VITE: 'development',
          NODE_ENV: 'development',
          ELECTRON_RENDERER_URL: new URL(page.url()).origin
        }
      : {})
  }
  delete environment.ELECTRON_RUN_AS_NODE
  const mainTargets = async () => {
    const response = await fetch(`http://127.0.0.1:${record.cdpPort}/json/list`)
    expect(response.ok).toBe(true)
    const targets = (await response.json()) as Array<{ id: string; type: string; url: string }>
    return targets.filter(
      (target) => target.type === 'page' && new URL(target.url).pathname.endsWith('/windows/main/index.html')
    )
  }
  const original = await mainTargets()
  expect(original).toHaveLength(1)
  expect(original[0].url).toBe(page.url())
  const title = await page.title()
  const nativeState = async () => {
    const { stdout } = await exec('/usr/bin/osascript', [
      '-e',
      `on run argv
      tell application "System Events"
        set targetProcess to first application process whose unix id is (item 1 of argv as integer)
        set targetWindow to first window of targetProcess whose name is (item 2 of argv)
        return {(value of attribute "AXMinimized" of targetWindow), frontmost of targetProcess}
      end tell
    end run`,
      String(record.electronPid),
      title
    ])
    const [minimized, frontmost] = stdout
      .trim()
      .split(', ')
      .map((value) => value === 'true')
    return { minimized, frontmost }
  }
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const processSnapshot = async () => {
    const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,command='])
    const all = stdout.split('\n').flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : []
    })
    const owned = new Set([record.electronPid])
    for (let previous = 0; previous !== owned.size;) {
      previous = owned.size
      for (const process of all) if (owned.has(process.parent)) owned.add(process.pid)
    }
    const mains = all.filter(
      (process) => process.command.startsWith(executable) && !process.command.includes('--type=')
    )
    expect(mains.map(({ pid }) => pid)).toEqual([record.electronPid])
    return all.filter((process) => owned.has(process.pid))
  }
  await selectSidebarApp(page, 'Chat')
  const baseline = await processSnapshot()
  const { stdout: openFiles } = await exec('lsof', ['-a', '-p', String(record.electronPid), '-Fn'])
  const databases = [
    ...new Set(
      openFiles
        .split('\n')
        .filter((line) => line.startsWith(`n${app.paths.profiles}/`) && /\.(db|sqlite|sqlite3)$/.test(line))
        .map((line) => line.slice(1))
    )
  ]
  expect(databases.length, 'The running app must have an open SQLite database').toBeGreaterThan(0)
  const assertReused = async (name: string) => {
    await expect.poll(nativeState).toEqual({ minimized: false, frontmost: true })
    expect(await mainTargets()).toEqual(original)
    expect(findListeningPid(record.platform, record.cdpPort)).toBe(record.electronPid)
    const current = await processSnapshot()
    expect(current.length, 'A relaunch must not leave additional application processes').toBe(baseline.length)
    const databaseOwners: Array<{ database: string; owners: number[] }> = []
    for (const database of databases) {
      const { stdout } = await exec('lsof', ['-t', database])
      const owners = [...new Set(stdout.trim().split('\n').map(Number))]
      expect(owners).toEqual([record.electronPid])
      databaseOwners.push({ database, owners })
    }
    await testInfo.attach(`${name} process and database owners`, {
      body: JSON.stringify({ primaryPid: record.electronPid, processes: current, databaseOwners }, null, 2),
      contentType: 'application/json'
    })
    await screenshot(name)
  }
  const minimize = async () => {
    expect(await page.evaluate(() => window.api.ipcApi.request('window.minimize'))).toMatchObject({ ok: true })
    await expect.poll(async () => (await nativeState()).minimized).toBe(true)
  }
  await screenshot('MP-133 original application before second launch')
  await minimize()
  // Finder opens through LaunchServices; -n also exercises the actual same-profile exclusion guard.
  await exec(
    '/usr/bin/open',
    [
      '-n',
      '-W',
      '-a',
      bundle,
      '--env',
      `CS_DEV_PROFILE_ROOT=${environment.CS_DEV_PROFILE_ROOT}`,
      '--env',
      `CS_DEV_USER_DATA_SUFFIX=${environment.CS_DEV_USER_DATA_SUFFIX}`,
      ...['ELECTRON_VITE', 'NODE_ENV', 'ELECTRON_RENDERER_URL'].flatMap((key) =>
        environment[key] ? ['--env', `${key}=${environment[key]}`] : []
      ),
      '--args',
      ...args
    ],
    { timeout: 30_000 }
  )
  await assertReused('MP-133 LaunchServices relaunch reuses original window')
  await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
  await minimize()
  await exec(executable, [...args, 'cherrystudio://navigate/settings/provider'], {
    cwd: record.targetRoot,
    env: environment,
    timeout: 30_000
  })
  await expect(page.locator('[data-ui~="settings.view"]:visible')).toBeVisible()
  await expect(page.getByPlaceholder('Search Providers...', { exact: true })).toBeVisible()
  await assertReused('MP-133 command-line deep link reaches provider settings')
}
