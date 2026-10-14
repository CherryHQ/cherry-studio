import { evaluateCdpExpression } from './cdpClient'
import { CHERRYIN_CALLBACK } from './cherryInOauth'
import { type AppRecord, readCdpTargets } from './lifecycle'
import { assertOwnedProcess, findListeningPid, isAlive, MAIN_INSPECTOR_PORT } from './process'

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
