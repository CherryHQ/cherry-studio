import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

import { MAC_EXTERNAL_APP_SCRIPT } from './externalAppMac'
import { WINDOWS_EXTERNAL_APP_SCRIPT } from './externalAppWindows'
import type { Platform } from './types'

export type ExternalTarget =
  | { kind: 'document'; application: 'Preview' | 'Pages' | 'TextEdit' | 'Notepad'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'terminal'; directory: string }
  | { kind: 'browser'; title: string; application?: string }
  | { kind: 'settings' }

export interface ExternalProcess {
  pid: number
  startedAt: string
  application: string
  shared: boolean
}

export interface ExternalWindow {
  id: string
  pid: number
  matches: boolean
}

export interface ExternalSnapshot {
  processes: ExternalProcess[]
  windows: ExternalWindow[]
  browserApplication?: string
}

export interface ExternalAppRequest {
  action: 'inspect' | 'close' | 'quit' | 'force'
  target: ExternalTarget
  root: string
  process?: ExternalProcess
  window?: ExternalWindow
  owned?: string[]
}

export function externalAppRequest(platform: Platform, request: ExternalAppRequest): ExternalSnapshot {
  const key = (id: string) => createHash('sha256').update(id).digest('hex')
  let nativeRequest = request
  if (request.action !== 'inspect') {
    const snapshot = runNativeRequest(platform, { ...request, action: 'inspect' })
    nativeRequest = {
      ...request,
      window: request.window && snapshot.windows.find(({ id }) => key(id) === request.window?.id),
      owned: snapshot.windows.filter(({ id }) => request.owned?.includes(key(id))).map(({ id }) => id)
    }
    if (request.action === 'close' && !nativeRequest.window)
      return { ...snapshot, windows: snapshot.windows.map((window) => ({ ...window, id: key(window.id) })) }
    if (request.action === 'close' && !nativeRequest.window?.matches)
      throw new Error('External window contains unrelated content; refusing to close')
    if (
      request.action !== 'close' &&
      snapshot.windows.some(
        (window) =>
          window.pid === request.process?.pid && (!nativeRequest.owned?.includes(window.id) || !window.matches)
      )
    )
      throw new Error('External application contains unrelated windows; refusing to terminate')
  }
  const snapshot = runNativeRequest(platform, nativeRequest)
  return { ...snapshot, windows: snapshot.windows.map((window) => ({ ...window, id: key(window.id) })) }
}

function runNativeRequest(platform: Platform, request: ExternalAppRequest, attempt = 0): ExternalSnapshot {
  const args =
    platform === 'macos'
      ? ['-l', 'JavaScript', '-e', MAC_EXTERNAL_APP_SCRIPT, '--', JSON.stringify(request)]
      : [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(request)).toString('base64')}')) | ConvertFrom-Json\n${WINDOWS_EXTERNAL_APP_SCRIPT}`
        ]
  try {
    const output = execFileSync(platform === 'macos' ? 'osascript' : 'powershell.exe', args, {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return JSON.parse(output) as ExternalSnapshot
  } catch (error) {
    const failure = error as { stderr?: string; code?: string }
    if (platform === 'macos' && request.action === 'inspect' && attempt < 2 && /\(-1728\)/.test(failure.stderr ?? ''))
      return runNativeRequest(platform, request, attempt + 1)
    throw new Error(
      `External application ${request.action} failed: ${String(failure.stderr || failure.code || 'native automation error').trim()}`
    )
  }
}
