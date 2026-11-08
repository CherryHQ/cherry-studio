import { execFileSync } from 'node:child_process'

import { evaluateCdpExpression } from './cdpClient'
import { CHERRYIN_CALLBACK } from './cherryInOauth'
import { type AppRecord, readCdpTargets } from './lifecycle'
import { isPathInside, type RunPaths } from './paths'
import { assertOwnedProcess, findListeningPid, isAlive, MAIN_INSPECTOR_PORT } from './process'
import { registerWindowsNotificationShortcut } from './windowsNotificationShortcut'

interface InspectorTarget {
  type: string
  webSocketDebuggerUrl?: string
}

const MAIN_WINDOW_PATH = '/windows/main/index.html'

async function ownedMainInspectorUrl(record: AppRecord): Promise<string> {
  if (findListeningPid(record.platform, MAIN_INSPECTOR_PORT) !== record.electronPid) {
    throw new Error('Owned Cherry Studio instance does not own the main-process inspector')
  }

  const response = await fetch(`http://127.0.0.1:${MAIN_INSPECTOR_PORT}/json/list`, {
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) throw new Error(`Main-process inspector discovery failed with HTTP ${response.status}`)
  const targets = (await response.json()) as InspectorTarget[]
  const target = targets.find((candidate) => candidate.type === 'node' && candidate.webSocketDebuggerUrl)
  if (!target?.webSocketDebuggerUrl) throw new Error('Main-process inspector target is unavailable')

  const debuggerUrl = new URL(target.webSocketDebuggerUrl)
  if (
    debuggerUrl.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(debuggerUrl.hostname) ||
    debuggerUrl.port !== String(MAIN_INSPECTOR_PORT)
  ) {
    throw new Error('Main-process inspector target is not loopback-owned')
  }
  return debuggerUrl.toString()
}

export async function inspectOwnedAppEnvironment(record: AppRecord): Promise<{
  version: string
  locale: string
  timezone: string
}> {
  assertOwnedProcess(record, record.electronPid, 'electron')
  return evaluateCdpExpression(
    await ownedMainInspectorUrl(record),
    `(() => {
    const { app } = process.mainModule.require('electron')
    return { version: app.getVersion(), locale: app.getLocale(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  })()`
  )
}

export async function isOwnedGlobalShortcutRegistered(record: AppRecord, accelerator: string): Promise<boolean> {
  assertOwnedProcess(record, record.electronPid, 'electron')
  return evaluateCdpExpression(
    await ownedMainInspectorUrl(record),
    `process.mainModule.require('electron').globalShortcut.isRegistered(${JSON.stringify(accelerator)})`
  )
}

export async function inspectOwnedWindowsByUrl(
  record: AppRecord,
  url: string
): Promise<
  {
    id: number
    visible: boolean
    focused: boolean
    minimized: boolean
    bounds: { x: number; y: number; width: number; height: number }
  }[]
> {
  assertOwnedProcess(record, record.electronPid, 'electron')
  return evaluateCdpExpression(
    await ownedMainInspectorUrl(record),
    `process.mainModule.require('electron').BrowserWindow.getAllWindows()
      .filter(window => window.webContents.getURL() === ${JSON.stringify(url)}).slice(0, 8)
      .map(window => ({ id: window.id, visible: window.isVisible(), focused: window.isFocused(),
        minimized: window.isMinimized(), bounds: window.getBounds() }))`
  )
}

export async function prepareOwnedMacNotifications(record: AppRecord): Promise<void> {
  if (record.platform !== 'macos') throw new Error('Native macOS notification preparation requires macOS')
  assertOwnedProcess(record, record.electronPid, 'electron')
  await evaluateCdpExpression(
    await ownedMainInspectorUrl(record),
    `(async () => { await process.mainModule.require('electron').Notification.getHistory(); return true })()`
  )
}

export async function prepareOwnedWindowsNotifications(record: AppRecord, paths: RunPaths): Promise<void> {
  if (record.platform !== 'windows' || record.mode !== 'branch')
    throw new Error('Notification shortcut preparation requires a Windows development run')
  assertOwnedProcess(record, record.electronPid, 'electron')
  const source = await evaluateCdpExpression<string>(
    await ownedMainInspectorUrl(record),
    `(async () => {
      const { Notification, shell } = process.mainModule.require('electron')
      const { readdirSync } = process.mainModule.require('node:fs')
      const { join, normalize } = process.mainModule.require('node:path')
      if (!Notification.isSupported()) throw new Error('Windows notifications are unsupported')
      const programs = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      const deadline = Date.now() + 10000
      do {
        for (const name of readdirSync(programs).filter(name => name.endsWith('.lnk'))) {
          const path = join(programs, name)
          try {
            const link = shell.readShortcutLink(path)
            if (normalize(link.target).toLowerCase() === normalize(process.execPath).toLowerCase() &&
                link.appUserModelId.endsWith('.Development') && link.appUserModelId.length <= 128 &&
                !/\\s/.test(link.appUserModelId) && link.toastActivatorClsid) return path
          } catch {}
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      } while (Date.now() < deadline)
      throw new Error('The SDK did not register a valid isolated notification shortcut')
    })()`
  )
  const programs = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)'
    ],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true }
  ).trim()
  registerWindowsNotificationShortcut(paths, source, programs)
}

export async function inspectOwnedNotificationHistory(record: AppRecord, text: string): Promise<string[]> {
  if (record.platform !== 'macos') throw new Error('Notification history inspection requires macOS')
  assertOwnedProcess(record, record.electronPid, 'electron')
  return evaluateCdpExpression(
    await ownedMainInspectorUrl(record),
    `(async () => {
      const history = await process.mainModule.require('electron').Notification.getHistory()
      return history.filter(notification => notification.body.includes(${JSON.stringify(text)}))
        .map(notification => notification.id)
    })()`
  )
}

export async function requestOwnedAppQuit(record: AppRecord): Promise<void> {
  assertOwnedProcess(record, record.electronPid, 'electron')
  await evaluateCdpExpression(
    await ownedMainInspectorUrl(record),
    `(() => {
      const { app } = process.mainModule.require('electron')
      setImmediate(() => app.quit())
      return true
    })()`
  )
}

export async function hasOwnedAppActiveTasks(record: AppRecord): Promise<boolean> {
  assertOwnedProcess(record, record.electronPid, 'electron')
  return evaluateCdpExpression(
    await ownedMainInspectorUrl(record),
    `(() => {
      const application = Object.values(process.mainModule.require('node:module')._cache)
        .map(module => module.exports?.application).find(candidate => candidate?.getPath)
      return application.get('RuntimeActivityService').hasActiveTasks()
    })()`
  )
}

export async function assertOwnedAppIsolation(record: AppRecord, homeDirectory: string): Promise<void> {
  assertOwnedProcess(record, record.electronPid, 'electron')
  const directories = await evaluateCdpExpression<Record<string, string | undefined>>(
    await ownedMainInspectorUrl(record),
    `(() => {
      const application = Object.values(process.mainModule.require('node:module')._cache)
        .map(module => module.exports?.application).find(candidate => candidate?.getPath)
      return {
        home: application.getPath('sys.home'), temp: application.getPath('sys.temp'),
        appData: application.getPath('sys.appdata'),
        claude: process.env.CLAUDE_CONFIG_DIR, codex: process.env.CODEX_HOME
      }
    })()`
  )
  const required = ['home', 'temp', 'claude', 'codex']
  if (record.platform === 'windows') required.push('appData')
  for (const key of required) {
    const directory = directories[key]
    if (!directory || !isPathInside(homeDirectory, directory)) {
      throw new Error(`Regression ${key} directory is outside the isolated profile; restart the regression app`)
    }
  }
}

export async function setOwnedMainWindowFocus(record: AppRecord, focused: boolean): Promise<{ focused: boolean }> {
  assertOwnedProcess(record, record.electronPid, 'electron')
  return evaluateCdpExpression(
    await ownedMainInspectorUrl(record),
    `(() => {
      const { app, BrowserWindow } = process.mainModule.require('electron')
      const window = BrowserWindow.getAllWindows().find(candidate => {
        const url = candidate.webContents.getURL()
        if (!URL.canParse(url)) return false
        return new URL(url).pathname.endsWith(${JSON.stringify(MAIN_WINDOW_PATH)})
      })
      if (!window) throw new Error('Owned main window is unavailable')
      if (${JSON.stringify(focused)}) {
        if (${JSON.stringify(record.platform)} === 'macos') {
          app.show()
          app.focus({ steal: true })
        }
        window.show()
        window.focus()
        window.webContents.focus()
      } else {
        window.blur()
      }
      return { focused: window.isFocused() }
    })()`
  )
}

export async function prepareWindowsCdpConnection(record: AppRecord): Promise<void> {
  if (record.platform !== 'windows') return
  if (!isAlive(record.electronPid)) throw new Error('Owned Cherry Studio instance is not running')
  assertOwnedProcess(record, record.electronPid, 'electron')
  const debuggerUrl = await ownedMainInspectorUrl(record)
  const destroyed = await evaluateCdpExpression<number>(
    debuggerUrl,
    `(() => {
      const electron = process.mainModule?.require?.('electron')
      if (!electron?.BrowserWindow) throw new Error('Electron BrowserWindow is unavailable')
      const mainWindowPath = ${JSON.stringify(MAIN_WINDOW_PATH)}
      let destroyed = 0
      for (const window of electron.BrowserWindow.getAllWindows()) {
        let pathname = ''
        try {
          pathname = new URL(window.webContents.getURL()).pathname.toLowerCase()
        } catch {}
        if (!pathname.endsWith(mainWindowPath)) {
          window.destroy()
          destroyed += 1
        }
      }
      return destroyed
    })()`
  )
  if (!Number.isInteger(destroyed) || destroyed < 0) {
    throw new Error('Windows CDP preparation returned an invalid result')
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const targets = await readCdpTargets()
    const hasNonMainTarget = targets.some((target) => {
      try {
        return target.type === 'page' && !new URL(target.url).pathname.toLowerCase().endsWith(MAIN_WINDOW_PATH)
      } catch {
        return target.type === 'page'
      }
    })
    if (!hasNonMainTarget) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Non-main Windows CDP targets did not close')
}

export async function captureCherryInAuthorizationUrl(
  record: AppRecord,
  authorize: () => Promise<void>
): Promise<string> {
  if (!isAlive(record.electronPid)) throw new Error('Owned Cherry Studio instance is not running')
  assertOwnedProcess(record, record.electronPid, 'electron')
  const debuggerUrl = await ownedMainInspectorUrl(record)
  try {
    await evaluateCdpExpression(
      debuggerUrl,
      `(() => {
      const { shell } = process.mainModule.require('electron')
      const original = shell.openExternal
      const capture = { original, url: undefined }
      globalThis.__cherryRegressionOauth = capture
      shell.openExternal = async (url, ...args) => {
        const target = new URL(url)
        if (target.origin === 'https://open.cherryin.ai' && target.pathname === '/oauth2/auth') {
          capture.url = url
          shell.openExternal = original
          return
        }
        return original.call(shell, url, ...args)
      }
    })()`
    )
    await authorize()
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const url = await evaluateCdpExpression<string | undefined>(
        debuggerUrl,
        'globalThis.__cherryRegressionOauth?.url'
      )
      if (url) return url
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    }
    throw new Error('CherryIN authorization URL was not opened by the owned application')
  } finally {
    await evaluateCdpExpression(
      debuggerUrl,
      `(() => {
      const capture = globalThis.__cherryRegressionOauth
      if (!capture) return
      process.mainModule.require('electron').shell.openExternal = capture.original
      delete globalThis.__cherryRegressionOauth
    })()`
    )
  }
}

export async function sendCherryInCallbackToOwnedApp(record: AppRecord, callback: string): Promise<void> {
  const url = new URL(callback)
  if (
    `${url.origin}${url.pathname}` !== CHERRYIN_CALLBACK ||
    url.username ||
    url.password ||
    url.hash ||
    !url.searchParams.get('code') ||
    !url.searchParams.get('state')
  )
    throw new Error('CherryIN OAuth returned an invalid application callback')
  assertOwnedProcess(record, record.electronPid, 'electron')
  if (findListeningPid(record.platform, Number(url.port)) !== record.electronPid) {
    throw new Error('Owned Cherry Studio instance does not own the OAuth callback listener')
  }
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Callback rejected')
    await response.body?.cancel()
  } catch {
    throw new Error('Failed to deliver the OAuth callback to the owned Cherry Studio instance')
  }
}
