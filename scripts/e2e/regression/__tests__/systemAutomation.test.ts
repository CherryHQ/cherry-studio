import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync }))

import { ensureRunDirectories, getRunPaths } from '../paths'
import type * as SystemAutomation from '../systemAutomation'

let automation: typeof SystemAutomation

let directory: string

beforeEach(async () => {
  vi.resetModules()
  automation = await import('../systemAutomation')
  directory = mkdtempSync(join(tmpdir(), 'cherry-text-fixture-'))
  execFileSync.mockReset()
})

afterEach(() => {
  execFileSync.mockReset()
  automation.closeExternalText('macos')
  rmSync(directory, { recursive: true, force: true })
})

it('closes only the owned TextEdit document without quitting the application', () => {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const filePath = join(paths.fixtures, 'selection "quoted".txt')
  writeFileSync(filePath, 'Test selection')
  automation.openExternalText('macos', paths, filePath)
  execFileSync.mockClear()
  automation.closeExternalText('macos')
  const [command, args] = execFileSync.mock.calls[0]
  expect(command).toBe('osascript')
  expect(args.slice(-2)).toEqual(['--', pathToFileURL(filePath).href])
  expect(args[1]).toContain('if value of attribute "AXDocument" of docWindow is item 1 of argv then')
  expect(args[1]).not.toContain('tell application "TextEdit"')
  expect(args[1]).not.toMatch(/\bquit\b/)
  execFileSync.mockClear()
  automation.closeExternalText('macos')
  expect(execFileSync).not.toHaveBeenCalled()
})

it('retains the document for cleanup when activation or closing fails', () => {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const filePath = join(paths.fixtures, 'selection.txt')
  writeFileSync(filePath, 'Test selection')
  execFileSync.mockImplementation((file) => {
    if (file === 'osascript') throw new Error('Automation denied')
  })
  expect(() => automation.openExternalText('macos', paths, filePath)).toThrow('Automation denied')
  expect(() => automation.closeExternalText('macos')).toThrow('Automation denied')
  execFileSync.mockReset()
  automation.closeExternalText('macos')
  expect(execFileSync.mock.calls[0][1].at(-1)).toBe(pathToFileURL(filePath).href)
})

function nativeFixture() {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const filePath = join(paths.workspace, 'folder "quoted" $literal.txt')
  writeFileSync(filePath, 'Native selection')
  writeFileSync(
    paths.appRecord,
    JSON.stringify({
      schemaVersion: 1,
      ownership: 'regression-driver',
      policy: 'ephemeral',
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

it('uses locale-independent macOS 27 selection and keeps path and PID exclusively in argv', () => {
  const { paths, filePath } = nativeFixture()
  execFileSync.mockImplementation((command) => (command === 'sw_vers' ? '27.0.1\n' : undefined))
  expect(automation.chooseNativeFile('macos', paths, filePath)).toBe(filePath)
  const [command, args, options] = execFileSync.mock.calls[1]
  expect(execFileSync.mock.calls[0].slice(0, 2)).toEqual(['sw_vers', ['-productVersion']])
  expect(command).toBe('osascript')
  expect(args.slice(2)).toEqual(['--', filePath, '456'])
  const script = args[1]
  expect(script).not.toContain(filePath)
  expect(script).not.toContain('"Open"')
  expect(script).not.toContain('AXIdentifier')
  expect(script).toContain('first application process whose unix id is (item 2 of argv as integer)')
  expect(script).toContain('count of buttons of splitter group 1 of window 1')
  expect(script).toContain('enabled of last button of splitter group 1 of window 1')
  expect(script).toContain('click last button of splitter group 1 of window 1')
  expect(script).toContain('(value of text field 1 of sheet 1 of window 1 as text) equals (item 1 of argv)')
  expect(script).toContain('set deadline to startedAt + 35')
  expect(script).toContain('(count of windows) < previousWindowCount')
  expect(options).toEqual({ stdio: ['ignore', 'ignore', 'pipe'], timeout: 45_000 })
  automation.chooseNativeFile('macos', paths, filePath)
  expect(execFileSync.mock.calls.filter(([command]) => command === 'sw_vers')).toHaveLength(1)
})

it('preserves the legacy macOS 26 panel, path-entry and accept sequence', () => {
  const { paths, filePath } = nativeFixture()
  execFileSync.mockImplementation((command) => (command === 'sw_vers' ? '26.5\n' : undefined))
  automation.chooseNativeFile('macos', paths, filePath)
  const [, args] = execFileSync.mock.calls[1]
  const script = args[1]
  expect(script).toContain('if exists button "Open" of splitter group 1 of window 1 then exit repeat')
  expect(script).toContain('set value of text field 1 of sheet 1 of window 1 to item 1 of argv\nkey code 36')
  expect(script).toContain(
    'if not (enabled of button "Open" of splitter group 1 of window 1) then error "Selected path cannot be opened"\nclick button "Open" of splitter group 1 of window 1'
  )
  expect(script.match(/repeat 100 times/g)).toHaveLength(4)
  expect(script).not.toContain('set deadline')
  expect(args.slice(2)).toEqual(['--', filePath, '456'])
})

it('surfaces macOS stage diagnostics and subprocess stderr', () => {
  const { paths, filePath } = nativeFixture()
  execFileSync.mockImplementation((command) => {
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
