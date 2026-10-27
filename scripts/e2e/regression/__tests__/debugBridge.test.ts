import type * as ChildProcess from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createContext as createVmContext, runInContext } from 'node:vm'

import { afterEach, vi } from 'vitest'

import {
  assertOwnedAppIsolation,
  captureCherryInAuthorizationUrl,
  sendCherryInCallbackToOwnedApp,
  setOwnedMainWindowFocus
} from '../debugBridge'
import type { AppRecord } from '../lifecycle'

const { evaluateCdpExpressionMock, execFileSyncMock } = vi.hoisted(() => ({
  evaluateCdpExpressionMock: vi.fn(),
  execFileSyncMock: vi.fn()
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync: execFileSyncMock
}))
vi.mock('../cdpClient', () => ({ evaluateCdpExpression: evaluateCdpExpressionMock }))

afterEach(() => {
  evaluateCdpExpressionMock.mockReset()
  execFileSyncMock.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function ownedApp(platform: 'macos' | 'windows', listenerPid = 42_001): AppRecord {
  const targetRoot = platform === 'macos' ? '/tmp/target-app' : 'D:\\target-app'
  const record: AppRecord = {
    schemaVersion: 1,
    ownership: 'regression-driver',
    policy: 'ephemeral',
    mode: 'branch',
    platform,
    profile: 'authenticated',
    runKey: 'test-run',
    targetRoot,
    command: 'pnpm',
    args: ['debug'],
    cwd: targetRoot,
    runnerPid: 42_000,
    electronPid: 42_001,
    cdpPort: 9222,
    targetUrl: 'http://127.0.0.1:9222',
    logPath: `${targetRoot}/electron.log`,
    startedAt: '2026-08-22T00:00:00.000Z',
    restartCount: 0
  }
  vi.spyOn(process, 'kill').mockReturnValue(true)
  execFileSyncMock.mockImplementation((file: string, args: string[]) => {
    const script = String(args.at(-1))
    if (file === 'lsof') return String(args.includes('-iTCP:9222') ? record.electronPid : listenerPid)
    if (script.includes('Get-NetTCPConnection'))
      return String(script.includes('9222') ? record.electronPid : listenerPid)
    if (file === 'ps' || script.includes('CommandLine'))
      return `${targetRoot}/node_modules/electron/Electron ${targetRoot}`
    throw new Error(`Unexpected command: ${file}`)
  })
  return record
}

function mainInspector() {
  const opened: string[] = []
  const original = async (url: string) => {
    opened.push(url)
  }
  const shell = { openExternal: original }
  const context = createVmContext({ URL, process: { mainModule: { require: () => ({ shell }) } } })
  evaluateCdpExpressionMock.mockImplementation(async (_url: string, expression: string) =>
    runInContext(expression, context)
  )
  vi.stubGlobal('fetch', async () =>
    Response.json([{ type: 'node', webSocketDebuggerUrl: 'ws://127.0.0.1:9229/main-process' }])
  )
  return { shell, original, opened, context }
}

const authorizationUrl = 'https://open.cherryin.ai/oauth2/auth?state=test-state'
const callback = 'http://127.0.0.1:29873/oauth/callback?code=test-code&state=test-state'

describe('owned application debug bridge', () => {
  it.each([false, true])('sets main-window focus to %s when another owned window is listed first', async (focused) => {
    const record = ownedApp('windows')
    mainInspector()
    let mainFocused = !focused
    const window = (pathname: string, setFocus: (value: boolean) => void, isFocused: () => boolean) => ({
      webContents: { getURL: () => `http://localhost:5173${pathname}`, focus: () => {} },
      focus: () => setFocus(true),
      blur: () => setFocus(false),
      isFocused
    })
    const main = window(
      '/windows/main/index.html',
      (value) => (mainFocused = value),
      () => mainFocused
    )
    const secondary = window(
      '/windows/selection/index.html',
      () => {},
      () => true
    )
    const context = createVmContext({
      URL,
      process: { mainModule: { require: () => ({ BrowserWindow: { getAllWindows: () => [secondary, main] } }) } }
    })
    evaluateCdpExpressionMock.mockImplementation(async (_url: string, expression: string) =>
      runInContext(expression, context)
    )
    expect(await setOwnedMainWindowFocus(record, focused)).toEqual({ focused })
    expect(mainFocused).toBe(focused)
  })

  it.each(['macos', 'windows'] as const)(
    'accepts profile-owned %s paths before connecting the UI',
    async (platform) => {
      const record = ownedApp(platform)
      mainInspector()
      const homeDirectory = join(process.cwd(), 'isolated-profile', 'home')
      evaluateCdpExpressionMock.mockResolvedValue({
        home: homeDirectory,
        temp: join(homeDirectory, 'temp'),
        appData: join(homeDirectory, 'AppData'),
        claude: join(homeDirectory, '.claude'),
        codex: join(homeDirectory, '.codex')
      })
      await expect(assertOwnedAppIsolation(record, homeDirectory)).resolves.toBeUndefined()
    }
  )

  it.each(['home', 'temp', 'appData', 'claude', 'codex'])(
    'rejects a reused instance whose %s path still points outside the test profile',
    async (key) => {
      const record = ownedApp('windows')
      mainInspector()
      const homeDirectory = join(process.cwd(), 'isolated-profile', 'home')
      evaluateCdpExpressionMock.mockResolvedValue({
        ...Object.fromEntries(['home', 'temp', 'appData', 'claude', 'codex'].map((key) => [key, homeDirectory])),
        [key]: join(process.cwd(), 'personal-home')
      })
      await expect(assertOwnedAppIsolation(record, homeDirectory)).rejects.toThrow(`Regression ${key} directory`)
    }
  )

  it.each(['macos', 'windows'] as const)(
    'captures main-process authorization and restores the browser opener on %s',
    async (platform) => {
      const record = ownedApp(platform)
      const { shell, original, opened, context } = mainInspector()
      const captured = await captureCherryInAuthorizationUrl(record, async () => {
        await shell.openExternal('https://example.test')
        await shell.openExternal(authorizationUrl)
      })
      expect(captured).toBe(authorizationUrl)
      expect(opened).toEqual(['https://example.test'])
      expect(shell.openExternal).toBe(original)
      expect(context.__cherryRegressionOauth).toBeUndefined()
    }
  )

  it('restores the browser opener when the authorization click fails', async () => {
    const record = ownedApp('macos')
    const { shell, original, context } = mainInspector()
    await expect(
      captureCherryInAuthorizationUrl(record, async () => {
        throw new Error('Button unavailable')
      })
    ).rejects.toThrow('Button unavailable')
    expect(shell.openExternal).toBe(original)
    expect(context.__cherryRegressionOauth).toBeUndefined()
  })

  it('rejects a main-process inspector owned by another process', async () => {
    const record = ownedApp('macos', 99_999)
    await expect(captureCherryInAuthorizationUrl(record, async () => {})).rejects.toThrow(
      'does not own the main-process inspector'
    )
    expect(evaluateCdpExpressionMock).not.toHaveBeenCalled()
  })

  it('delivers the authorization code to the real HTTP listener without forwarding credentials', async () => {
    const record = ownedApp('macos')
    let received: { url?: string; cookie?: string; authorization?: string } | undefined
    const server = createServer((request, response) => {
      received = { url: request.url, cookie: request.headers.cookie, authorization: request.headers.authorization }
      response.end('Signed in successfully')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(29873, '127.0.0.1', resolve)
    })
    try {
      await sendCherryInCallbackToOwnedApp(record, callback)
      expect(received).toEqual({
        url: '/oauth/callback?code=test-code&state=test-state',
        cookie: undefined,
        authorization: undefined
      })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('rejects a callback listener owned by another process', async () => {
    const record = ownedApp('macos', 99_999)
    await expect(sendCherryInCallbackToOwnedApp(record, callback)).rejects.toThrow(
      'does not own the OAuth callback listener'
    )
  })

  it.each(['http://127.0.0.1:29874/oauth/callback', 'https://example.test/oauth/callback'])(
    'does not send the code to an unexpected destination: %s',
    async (url) => {
      await expect(sendCherryInCallbackToOwnedApp(ownedApp('macos'), `${url}?code=code&state=state`)).rejects.toThrow(
        'invalid application callback'
      )
    }
  )
})
