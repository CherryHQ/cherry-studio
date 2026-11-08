import { execFile } from 'node:child_process'
import { mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { createProfileEnvironment } from '../../../../scripts/e2e/regression/lifecycle'
import { findListeningPid, windowsProcessExecutablePath } from '../../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { readWindowsFileOwners } from '../../../../scripts/e2e/regression/windowsFileOwners'
import { WINDOWS_DIAGNOSTIC_RECTANGLE } from '../../../../scripts/e2e/regression/windowsNativeDiagnostics'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

const exec = promisify(execFile)

export async function singleInstanceRelaunch(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  // Catches duplicate database owners, lost second-launch focus, and dropped deep-link arguments.
  const record = app.record
  let executable: string | undefined
  let bundle: string | undefined
  if (record.platform === 'windows') {
    executable = windowsProcessExecutablePath(record.electronPid)
    expect(executable).toBeTruthy()
    expect(findListeningPid(record.platform, record.cdpPort)).toBe(record.electronPid)
  } else {
    expect(findListeningPid(record.platform, record.cdpPort)).toBe(record.electronPid)
    const { stdout: cwd } = await exec('lsof', ['-a', '-p', String(record.electronPid), '-d', 'cwd', '-Fn'])
    // Installer launches run from the executable's directory and record it in `cwd`;
    // only branch launches start from the repository root.
    expect(cwd.split('\n')).toContain(`n${await realpath(record.cwd)}`)
    const { stdout: binaries } = await exec('lsof', ['-a', '-p', String(record.electronPid), '-d', 'txt', '-Fn'])
    executable =
      record.executablePath ??
      binaries
        .split('\n')
        .find((line) => /\.app\/Contents\/MacOS\/Electron$/.test(line))
        ?.slice(1)
    if (!executable) throw new Error('Could not identify the owned application executable')
    bundle = executable.slice(0, executable.indexOf('.app/') + 4)
    expect(bundle).toMatch(/\.app$/)
  }
  if (!executable) throw new Error('Could not identify the owned application executable')
  const executablePath = executable
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
  let lastNativeState: Record<string, unknown> | undefined
  const nativePhases: { stage: string; state: Record<string, unknown> }[] = []
  const persistNativeState = async () => {
    if (!lastNativeState) return
    try {
      const directory = join(app.paths.evidence, 'native-diagnostics')
      await mkdir(directory, { recursive: true })
      await writeFile(
        join(directory, 'mp133-native-window.json'),
        JSON.stringify({ ...lastNativeState, phases: nativePhases }),
        { mode: 0o600 }
      )
    } catch {}
  }
  const recordNativePhase = async (stage: string) => {
    if (lastNativeState && nativePhases.length < 4) {
      nativePhases.push({ stage, state: lastNativeState })
      await persistNativeState()
    }
  }
  const nativeState = async () => {
    if (record.platform === 'windows') {
      const { stdout } = await exec(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            'Add-Type -AssemblyName UIAutomationClient',
            'Add-Type -AssemblyName UIAutomationTypes',
            `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class WindowState { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder value, int size); }'`,
            `$condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, ${record.electronPid})`,
            '$windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition)',
            `$main = $windows | Where-Object { $_.Current.Name -eq '${title.replaceAll("'", "''")}' } | Select-Object -First 1`,
            'if (-not $main) { throw "Owned main window was not found" }',
            '[uint32]$foregroundPid = 0',
            '$foregroundHandle = [WindowState]::GetForegroundWindow()',
            '$null = [WindowState]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundPid)',
            '$foregroundClass = [System.Text.StringBuilder]::new(256)',
            '$null = [WindowState]::GetClassName($foregroundHandle, $foregroundClass, $foregroundClass.Capacity)',
            '$foregroundIdentity = $null',
            'try { $foregroundProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $foregroundPid" -ErrorAction Stop; if ($foregroundProcess) { $foregroundIdentity = @{ processName = $foregroundProcess.Name; parentPid = $foregroundProcess.ParentProcessId; startTime = $(if ($foregroundProcess.CreationDate) { $foregroundProcess.CreationDate.ToUniversalTime().ToString("o") } else { $null }); executable = $(if ($foregroundProcess.ExecutablePath) { [IO.Path]::GetFileName($foregroundProcess.ExecutablePath) } else { $null }) } } } catch { $foregroundIdentity = @{ errorType = $_.Exception.GetType().Name; hresult = $_.Exception.HResult } }',
            '$ownedRoots = @()',
            'foreach ($root in @($windows | Select-Object -First 8)) {',
            '  try {',
            '    $rootCurrent = $root.Current; $rect = $rootCurrent.BoundingRectangle',
            `    $ownedRoots += @{ windowClass = $rootCurrent.ClassName; controlType = $rootCurrent.ControlType.ProgrammaticName; handle = ([IntPtr]$rootCurrent.NativeWindowHandle).ToInt64().ToString(); rect = ${WINDOWS_DIAGNOSTIC_RECTANGLE} }`,
            '  } catch { $ownedRoots += @{ errorType = $_.Exception.GetType().Name; hresult = $_.Exception.HResult } }',
            '}',
            '$current = $main.Current; $rect = $current.BoundingRectangle',
            `@{ minimized = [WindowState]::IsIconic([IntPtr]$current.NativeWindowHandle); frontmost = $foregroundPid -eq ${record.electronPid}; diagnostic = @{ ownedPid = ${record.electronPid}; ownedHandle = ([IntPtr]$current.NativeWindowHandle).ToInt64().ToString(); foregroundPid = $foregroundPid; foregroundHandle = $foregroundHandle.ToInt64().ToString(); foregroundClass = $foregroundClass.ToString(); foregroundIdentity = $foregroundIdentity; ownedRoots = $ownedRoots; windowClass = $current.ClassName; controlType = $current.ControlType.ProgrammaticName; rect = ${WINDOWS_DIAGNOSTIC_RECTANGLE} } } | ConvertTo-Json -Depth 6 -Compress`
          ].join('; ')
        ],
        { timeout: 10_000, windowsHide: true }
      )
      const { minimized, frontmost, diagnostic } = JSON.parse(stdout)
      lastNativeState = { at: new Date().toISOString(), minimized, frontmost, ...diagnostic }
      if (minimized || !frontmost) await persistNativeState()
      return { minimized: minimized as boolean, frontmost: frontmost as boolean }
    }
    // Preserve PID selectors when other development processes share Electron's name.
    const { stdout } = await exec('/usr/bin/osascript', [
      '-e',
      `on run argv
      set expectedTitle to (item 2 of argv) as text
      tell application "System Events"
        set targetProcess to a reference to (first application process whose unix id is (item 1 of argv as integer))
        set targetWindow to a reference to (first window of targetProcess whose name is expectedTitle)
        if not (exists targetWindow) then return {"missing", frontmost of targetProcess}
        return {(value of attribute "AXMinimized" of targetWindow), frontmost of targetProcess}
      end tell
    end run`,
      String(record.electronPid),
      title
    ])
    const [minimized, frontmost] = stdout.trim().split(', ')
    return { minimized: minimized === 'missing' ? null : minimized === 'true', frontmost: frontmost === 'true' }
  }
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const processSnapshot = async () => {
    let all: Array<{ pid: number; parent: number; command: string; executable?: string }>
    if (record.platform === 'windows') {
      const { stdout } = await exec(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine, ExecutablePath | ConvertTo-Json -Compress'
        ],
        { timeout: 10_000, windowsHide: true }
      )
      all = (
        JSON.parse(stdout) as Array<{
          ProcessId: number
          ParentProcessId: number
          CommandLine: string | null
          ExecutablePath: string | null
        }>
      ).map((row) => ({
        pid: row.ProcessId,
        parent: row.ParentProcessId,
        command: row.CommandLine ?? '',
        executable: row.ExecutablePath ?? ''
      }))
    } else {
      const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,command='])
      all = stdout.split('\n').flatMap((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
        return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] }] : []
      })
    }
    const owned = new Set([record.electronPid])
    for (let previous = 0; previous !== owned.size;) {
      previous = owned.size
      for (const process of all) if (owned.has(process.parent)) owned.add(process.pid)
    }
    const mains = all.filter(
      (process) =>
        (record.platform === 'windows'
          ? process.executable?.toLowerCase() === executablePath.toLowerCase()
          : process.command.startsWith(executablePath)) && !process.command.includes('--type=')
    )
    expect(mains.map(({ pid }) => pid)).toEqual([record.electronPid])
    return all.filter((process) => owned.has(process.pid))
  }
  await selectSidebarApp(page, 'Chat')
  const baseline = await processSnapshot()
  let databases: string[]
  if (record.platform === 'windows') {
    const entries = await readdir(join(app.paths.profiles, record.profile), { recursive: true, withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isFile() && /\.(db|sqlite|sqlite3)$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name))
    databases = candidates.filter((file) => readWindowsFileOwners(app.paths, file).includes(record.electronPid))
  } else {
    const { stdout: openFiles } = await exec('lsof', ['-a', '-p', String(record.electronPid), '-Fn'])
    const profiles = await realpath(app.paths.profiles)
    databases = [
      ...new Set(
        openFiles
          .split('\n')
          .filter((line) => line.startsWith(`n${profiles}/`) && /\.(db|sqlite|sqlite3)$/.test(line))
          .map((line) => line.slice(1))
      )
    ]
  }
  expect(databases.length, 'The running app must have an open SQLite database').toBeGreaterThan(0)
  const assertReused = async (name: string) => {
    await expect.poll(nativeState).toEqual({ minimized: false, frontmost: true })
    expect(await mainTargets()).toEqual(original)
    expect(findListeningPid(record.platform, record.cdpPort)).toBe(record.electronPid)
    const current = await processSnapshot()
    expect(current.length, 'A relaunch must not leave additional application processes').toBe(baseline.length)
    const databaseOwners: Array<{ database: string; owners: number[] }> = []
    for (const database of databases) {
      const owners =
        record.platform === 'windows'
          ? readWindowsFileOwners(app.paths, database)
          : [...new Set((await exec('lsof', ['-t', database])).stdout.trim().split('\n').map(Number))]
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
    try {
      await expect.poll(async () => (await nativeState()).minimized).toBe(true)
    } catch (error) {
      await persistNativeState()
      throw error
    }
  }
  await screenshot('MP-133 original application before second launch')
  if (record.platform === 'windows') {
    await nativeState().catch(() => {})
    await recordNativePhase('before-minimize')
  }
  await minimize()
  await recordNativePhase('minimized')
  if (record.platform === 'windows') {
    await exec(executablePath, args, { cwd: record.cwd, timeout: 30_000, env: environment })
    await nativeState().catch(() => {})
    await recordNativePhase('second-launch-returned')
  } else {
    // Finder opens through LaunchServices; -n also exercises the actual same-profile exclusion guard.
    await exec(
      '/usr/bin/open',
      [
        '-n',
        '-W',
        '-a',
        bundle!,
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
      // LaunchServices inherits this process's home; forward the prepared environment
      // so packaged startup cannot read BootConfig from the controller profile.
      { timeout: 30_000, env: environment }
    )
  }
  try {
    await assertReused('MP-133 desktop relaunch reuses original window')
  } finally {
    await recordNativePhase('final')
  }
  await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
  await minimize()
  await exec(executablePath, [...args, 'cherrystudio://navigate/settings/provider'], {
    cwd: record.targetRoot,
    env: environment,
    timeout: 30_000
  })
  await expect(page.locator('[data-ui~="settings.view"]:visible')).toBeVisible()
  await expect(page.getByPlaceholder('Search Providers...', { exact: true })).toBeVisible()
  await assertReused('MP-133 command-line deep link reaches provider settings')
}
