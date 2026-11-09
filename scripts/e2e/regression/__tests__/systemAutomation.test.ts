import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { vi } from 'vitest'

const { execFileSync, execFile, externalAppRequest } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
  externalAppRequest: vi.fn()
}))
vi.mock('node:child_process', () => ({ execFileSync, execFile }))
vi.mock('../externalAppDriver', () => ({ externalAppRequest }))

import { ensureRunDirectories, getRunPaths } from '../paths'
import type * as SystemAutomation from '../systemAutomation'

let automation: typeof SystemAutomation

let directory: string

beforeEach(async () => {
  vi.resetModules()
  automation = await import('../systemAutomation')
  directory = mkdtempSync(join(tmpdir(), 'cherry-text-fixture-'))
  execFileSync.mockReset()
  execFile.mockReset()
  externalAppRequest.mockReset().mockReturnValue({ processes: [], windows: [] })
})

afterEach(() => {
  vi.useRealTimers()
  execFileSync.mockReset()
  execFile.mockReset()
  automation.closeExternalText('macos')
  automation.closeExternalText('windows')
  rmSync(directory, { recursive: true, force: true })
})

it.each(['macos', 'windows'] as const)(
  'cleans the registered %s external editor and removes its recovery record',
  (platform) => {
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const filePath = join(paths.fixtures, 'selection.txt')
    writeFileSync(filePath, 'Test selection')
    let desktop = {
      processes: [] as { pid: number; startedAt: string; application: string; shared: boolean }[],
      windows: [] as { id: string; pid: number; matches: boolean }[]
    }
    execFileSync.mockImplementation((command) => {
      if (command === 'open' || command === 'powershell.exe')
        desktop = {
          processes: [
            { pid: 42, startedAt: 'viewer', application: platform === 'macos' ? 'TextEdit' : 'Notepad', shared: false }
          ],
          windows: [{ id: 'fixture', pid: 42, matches: true }]
        }
      return command === 'powershell.exe' ? '42' : ''
    })
    externalAppRequest.mockImplementation((_platform, request) => {
      if (request.action === 'close') desktop.windows = []
      if (request.action === 'quit') desktop.processes = []
      return structuredClone(desktop)
    })
    automation.openExternalText(platform, paths, filePath)
    automation.closeExternalText(platform)
    expect(desktop).toEqual({ processes: [], windows: [] })
    expect(JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))).toEqual([])
    automation.closeExternalText(platform)
  }
)

it('rejects external text outside the owned input and export directories', () => {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const filePath = join(directory, 'outside.txt')
  writeFileSync(filePath, 'Unrelated document')
  expect(() => automation.openExternalText('macos', paths, filePath)).toThrow('outside the regression test directories')
  expect(execFileSync).not.toHaveBeenCalled()
})

it('refuses to read a native editor when no Windows fixture is owned', () => {
  expect(() => automation.readWindowsExternalText()).toThrow('No owned Windows external text editor is open')
  expect(execFileSync).not.toHaveBeenCalled()
})

it('retains the native read error and publishes only redacted editor diagnostics', () => {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const filePath = join(paths.fixtures, 'selection.txt')
  writeFileSync(filePath, 'Owned text')
  execFileSync.mockReturnValue('42')
  automation.openExternalText('windows', paths, filePath)
  const nativeError = Object.assign(new Error('Owned external editor has no text control'), {
    stdout: JSON.stringify({
      processId: 42,
      nodes: [{ class: 'Bearer diagnostic-secret', bounds: { x: null, y: null, width: 0, height: 0 } }]
    })
  })
  execFileSync.mockImplementation(() => {
    throw nativeError
  })
  let failure: unknown
  try {
    automation.readWindowsExternalText()
  } catch (error) {
    failure = error
  }
  expect(failure).toBe(nativeError)
  const diagnostic = readFileSync(join(paths.evidence, 'native-diagnostics', 'native-external-text.json'), 'utf8')
  expect(JSON.parse(diagnostic)).toEqual({
    processId: 42,
    nodes: [{ class: 'Bearer [REDACTED]', bounds: { x: null, y: null, width: 0, height: 0 } }]
  })
  expect(diagnostic).not.toContain('diagnostic-secret')
  expect(existsSync(join(paths.logs, 'native-external-text.json'))).toBe(false)
})

it.each(['macos', 'windows'] as const)(
  'rejects a %s multi-file selection outside the fixture directories',
  (platform) => {
    const paths = getRunPaths(directory)
    ensureRunDirectories(paths)
    const allowed = join(paths.fixtures, 'allowed.txt')
    const outside = join(directory, 'outside.txt')
    writeFileSync(allowed, 'Owned input')
    writeFileSync(outside, 'Unrelated document')
    expect(() => automation.chooseNativeFiles(platform, paths, [allowed, outside])).toThrow(
      'outside the regression test directories'
    )
    expect(execFileSync).not.toHaveBeenCalled()
  }
)

it('does not select unrequested files when macOS selects an isolated directory', () => {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const requested = join(paths.fixtures, 'requested.txt')
  writeFileSync(requested, 'Requested input')
  writeFileSync(join(paths.fixtures, 'unrequested.txt'), 'Must not be imported')
  expect(() => automation.chooseNativeFiles('macos', paths, [requested])).toThrow('all files in one isolated directory')
  expect(execFileSync).not.toHaveBeenCalled()
})

it('retains launch intent after activation fails so fixture teardown can retry cleanup', () => {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const filePath = join(paths.fixtures, 'selection.txt')
  writeFileSync(filePath, 'Test selection')
  execFileSync.mockImplementation((file) => {
    if (file === 'osascript') throw new Error('Automation denied')
  })
  expect(() => automation.openExternalText('macos', paths, filePath)).toThrow('Automation denied')
  const records = JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))
  expect(records).toHaveLength(1)
  expect(records[0].target.path).toBe(filePath)
  execFileSync.mockReset()
  automation.closeExternalText('macos')
  expect(JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8'))).toEqual([])
})

function nativeFixture(platform: 'macos' | 'windows' = 'windows') {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const filePath = join(
    paths.workspace,
    process.platform === 'win32' ? "folder 'quoted' $literal.txt" : 'folder "quoted" $literal.txt'
  )
  writeFileSync(filePath, 'Native selection')
  writeFileSync(
    paths.appRecord,
    JSON.stringify({
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform,
      targetRoot: directory,
      cdpPort: 9222,
      runnerPid: 123,
      electronPid: 456,
      targetUrl: 'http://localhost:5173',
      logPath: join(paths.logs, 'app.log')
    })
  )
  return { paths, filePath }
}

it.each(['outside', 'missing'] as const)('rejects an %s path before any OS automation', (kind) => {
  const { paths } = nativeFixture()
  const candidate = kind === 'outside' ? join(directory, 'outside.txt') : join(paths.workspace, 'missing.txt')
  if (kind === 'outside') writeFileSync(candidate, 'Outside allowlist')
  expect(() => automation.chooseNativeFile('macos', paths, candidate)).toThrow(
    kind === 'outside' ? 'outside the regression test directories' : 'Selected file does not exist'
  )
  expect(execFileSync).not.toHaveBeenCalled()
})

it('rejects native saves outside the evidence directory before any OS automation', async () => {
  const { paths, filePath } = nativeFixture()
  await expect(automation.saveNativeFile('macos', paths, filePath)).rejects.toThrow(
    'outside the regression test directories'
  )
  expect(execFileSync).not.toHaveBeenCalled()
})

it('allows native saves under the private root so unredacted artifacts stay out of uploads', async () => {
  const { paths } = nativeFixture()
  const privateSave = join(paths.private, 'downloads', 'bundle.zip')
  await automation.saveNativeFile('macos', paths, privateSave).catch(() => undefined)
  expect(existsSync(join(paths.private, 'downloads'))).toBe(true)
})

it('serves fixture images during a native save without exceeding the Windows command limit', async () => {
  const { paths } = nativeFixture()
  execFileSync.mockImplementation((_file, args) => {
    const script = args.at(-1)!
    if (script.includes('CommandLine')) return `electron ${directory}`
    if (script.includes('Get-NetTCPConnection')) return '456'
    throw new Error(`Unexpected synchronous OS automation: ${_file}`)
  })
  let served = false
  const server = createServer((_request, response) => {
    served = true
    response.end('fixture image')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const output = join(paths.evidence, '导出 report.png')
  execFile.mockImplementation((_file, args, _options, callback) => {
    const stdin = new PassThrough()
    if (args.join(' ').length > 32767) {
      queueMicrotask(() =>
        callback(Object.assign(new Error('Windows command line too long'), { code: 'ENAMETOOLONG' }))
      )
      return { stdin }
    }
    let input = ''
    stdin.on('data', (chunk) => (input += chunk.toString()))
    stdin.once('finish', () => {
      void fetch(`http://127.0.0.1:${address.port}`)
        .then(async (response) => {
          expect(Buffer.from(input, 'base64').toString('utf16le')).toContain(output)
          expect(await response.text()).toBe('fixture image')
          callback(null, output)
        })
        .catch(callback)
    })
    return { stdin }
  })
  try {
    await expect(automation.saveNativeFile('windows', paths, output)).resolves.toBe(output)
    expect(served).toBe(true)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

it('does not cancel a file dialog after the recorded process identity changes', async () => {
  const { paths } = nativeFixture()
  execFileSync.mockReturnValue('unrelated application')
  await expect(automation.cancelNativeFileDialogs('windows', paths)).rejects.toThrow('command no longer matches')
  expect(execFile).not.toHaveBeenCalled()
})

it.each(['26.5', '27.0.1'])('passes quoted paths as data rather than script source on macOS %s', (version) => {
  const { paths, filePath } = nativeFixture('macos')
  execFileSync.mockImplementation((command) => {
    if (command === 'ps') return `electron ${directory}`
    if (command === 'lsof') return '456'
    return command === 'sw_vers' ? version : ''
  })
  automation.chooseNativeFile('macos', paths, filePath)
  const [, args] = execFileSync.mock.calls.find(([command]) => command === 'osascript')!
  expect(args.slice(2)).toEqual(['--', filePath, '456'])
  expect(args[1]).not.toContain(filePath)
})

it.each(['command', 'cdp'] as const)('refuses native file input after the owned %s identity changes', (identity) => {
  const { paths, filePath } = nativeFixture('macos')
  execFileSync.mockImplementation((command) => {
    if (command === 'ps') return identity === 'command' ? 'unrelated application' : `electron ${directory}`
    if (command === 'lsof') return '789'
    throw new Error('Unexpected native mutation')
  })
  expect(() => automation.chooseNativeFile('macos', paths, filePath)).toThrow(
    identity === 'command' ? 'command no longer matches' : 'no longer owns CDP port'
  )
  expect(execFileSync.mock.calls.some(([command]) => command === 'osascript')).toBe(false)
})

it('surfaces macOS stage diagnostics and subprocess stderr', () => {
  const { paths, filePath } = nativeFixture('macos')
  execFileSync.mockImplementation((command) => {
    if (command === 'ps') return `electron ${directory}`
    if (command === 'lsof') return '456'
    if (command === 'sw_vers') return '27.0.1'
    throw Object.assign(new Error('osascript failed'), {
      stderr: Buffer.from(
        'macOS 27 native file panel did not reach stage path-entry for pid 456 after 8s: readback mismatch'
      )
    })
  })
  expect(() => automation.chooseNativeFile('macos', paths, filePath)).toThrow(
    /osascript failed[\s\S]*stage path-entry for pid 456 after 8s: readback mismatch/
  )
})

it.each([
  ['macos', false],
  ['windows', false],
  ['macos', true],
  ['windows', true]
] as const)('acknowledges an owned %s native dialog before CDP readiness=%s', async (platform, beforeReady) => {
  vi.useFakeTimers()
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  writeFileSync(
    paths.appRecord,
    JSON.stringify({
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform,
      targetRoot: directory,
      runnerPid: 42000,
      cdpPort: 9222,
      logPath: join(paths.logs, 'electron.log')
    })
  )
  execFileSync.mockImplementation((file, args) => {
    if (file === 'lsof') return beforeReady && args.includes('-iTCP:9222') ? '' : '42001'
    if (file === 'ps' && args.includes('command=')) return `electron ${directory}`
    if (file === 'ps' && args.includes('ppid=')) return '42000'
    if (file === 'powershell.exe') {
      const script = args.at(-1)!
      if (script.includes('Get-NetTCPConnection'))
        return beforeReady && script.includes('-LocalPort 9222 ') ? '' : '42001'
      if (script.includes('CommandLine')) return `electron ${directory}`
      if (script.includes('ParentProcessId')) return '42000'
    }
    throw new Error('Unexpected process query')
  })
  execFile.mockImplementation((_file, _args, _options, callback) => callback(null))
  const completion = automation.dismissNativeMessageBox(platform, paths, 'Manual Restart Required').then(
    () => undefined,
    (error: unknown) => error
  )
  await vi.advanceTimersByTimeAsync(60_000)
  expect(await completion).toBeUndefined()
  const [command, args] = execFile.mock.calls.at(-1)!
  expect(command).toBe(platform === 'macos' ? 'osascript' : 'powershell.exe')
  if (platform === 'macos') expect(args.slice(-3)).toEqual(['Manual Restart Required', '42001', 'OK'])
  if (platform === 'windows') {
    const nativeError = Object.assign(new Error('Native invoke failed'), { code: 1, cmd: 'private command' })
    execFile.mockImplementation((_file, _args, _options, callback) =>
      callback(
        nativeError,
        JSON.stringify({ stage: 'matched', button: { name: 'Bearer diagnostic-secret', controlId: '1' } }) +
          '\n' +
          JSON.stringify({ stage: 'invoke-error', errorType: 'InvalidOperationException' }) +
          '\n',
        'PowerShell parse error: Bearer stderr-secret\n-EncodedCommand private-encoded-command'
      )
    )
    await expect(automation.dismissNativeMessageBox(platform, paths, 'Manual Restart Required')).rejects.toBe(
      nativeError
    )
    const diagnostic = readFileSync(join(paths.logs, 'native-message-box.json'), 'utf8')
    expect(JSON.parse(diagnostic)).toMatchObject({
      electronPid: 42001,
      events: [
        { stage: 'matched', button: { name: 'Bearer [REDACTED]', controlId: '1' } },
        { stage: 'invoke-error', errorType: 'InvalidOperationException' }
      ],
      execution: { failed: true, code: 1, stderr: 'PowerShell parse error: Bearer [REDACTED]\n[command omitted]' }
    })
    expect(diagnostic).not.toContain('diagnostic-secret')
    expect(diagnostic).not.toContain('private command')
    expect(diagnostic).not.toContain('stderr-secret')
    expect(diagnostic).not.toContain('private-encoded-command')

    rmSync(join(paths.logs, 'native-message-box.json'))
    mkdirSync(join(paths.logs, 'native-message-box.json'))
    const failedCapture = await automation
      .dismissNativeMessageBox(platform, paths, 'Manual Restart Required')
      .catch((error) => error)
    expect(failedCapture).toBeInstanceOf(AggregateError)
    expect(failedCapture.errors[0]).toBe(nativeError)
    expect(failedCapture.errors[1]).toMatchObject({ code: 'EISDIR' })
  }
  execFile.mockClear()
  execFileSync.mockImplementation((file, args) => {
    if (file === 'lsof') return beforeReady && args.includes('-iTCP:9222') ? '' : '42001'
    if (file === 'ps' && args.includes('command=')) return `electron ${directory}`
    if (file === 'ps' && args.includes('ppid=')) return '0'
    if (file === 'powershell.exe') {
      const script = args.at(-1)!
      if (script.includes('Get-NetTCPConnection'))
        return beforeReady && script.includes('-LocalPort 9222 ') ? '' : '42001'
      if (script.includes('CommandLine')) return `electron ${directory}`
      if (script.includes('ParentProcessId')) return '0'
    }
    throw new Error('Unexpected process query')
  })
  await expect(automation.dismissNativeMessageBox(platform, paths, 'Manual Restart Required')).rejects.toThrow(
    'outside the owned run'
  )
  expect(execFile).not.toHaveBeenCalled()
})

it('dismisses the private permission guide only when its protocol owner belongs to this application', () => {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  writeFileSync(
    paths.appRecord,
    JSON.stringify({
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
      mode: 'branch',
      platform: 'macos',
      targetRoot: directory,
      runnerPid: 42000,
      electronPid: 42001,
      cdpPort: 9222,
      targetUrl: 'http://localhost:5173/windows/main/index.html',
      logPath: join(paths.logs, 'electron.log')
    })
  )
  const guides = new Set([42003, 99003])
  let ownedProtocolAlive = true
  execFileSync.mockImplementation((file: string, args: string[]) => {
    if (file === 'lsof') return '42001'
    if (file === 'ps' && args.includes('command=')) return `electron ${directory}`
    if (file === 'ps' && args.includes('-axo'))
      return [
        '42003 /sdk/Cherry Computer Use.app/Contents/MacOS/CherryComputerUse __computer-use-sdk-agent /socket owned-session 42002',
        '99003 /sdk/Cherry Computer Use.app/Contents/MacOS/CherryComputerUse __computer-use-sdk-agent /socket foreign-session 99002'
      ].join('\n')
    if (file === 'ps' && args.includes('ppid=')) return args.includes('42002') && ownedProtocolAlive ? '42001' : '0'
    if (file === 'swift') {
      const pid = Number(args.at(-1)?.match(/closeGuide\((\d+)\)/)?.[1])
      guides.delete(pid)
      return 'true'
    }
    throw new Error('Unexpected native operation')
  })
  expect(automation.closeMacComputerUsePermissionGuide(paths)).toBe(true)
  expect([...guides]).toEqual([99003])
  guides.add(42003)
  ownedProtocolAlive = false
  expect(automation.closeMacComputerUsePermissionGuide(paths)).toBe(false)
  expect([...guides].sort()).toEqual([42003, 99003])
})
