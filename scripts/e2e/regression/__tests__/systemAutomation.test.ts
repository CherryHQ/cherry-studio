import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { vi } from 'vitest'

const { execFileSync, execFile } = vi.hoisted(() => ({ execFileSync: vi.fn(), execFile: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync, execFile }))

import { ensureRunDirectories, getRunPaths } from '../paths'
import { closeExternalText, dismissNativeMessageBox, openExternalText } from '../systemAutomation'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cherry-text-fixture-'))
  execFileSync.mockReset()
})

afterEach(() => {
  execFileSync.mockReset()
  closeExternalText('macos')
  rmSync(directory, { recursive: true, force: true })
})

it('closes only the owned TextEdit document without quitting the application', () => {
  const paths = getRunPaths(directory)
  ensureRunDirectories(paths)
  const filePath = join(paths.fixtures, 'selection "quoted".txt')
  writeFileSync(filePath, 'Test selection')
  openExternalText('macos', paths, filePath)
  execFileSync.mockClear()
  closeExternalText('macos')
  const [command, args] = execFileSync.mock.calls[0]
  expect(command).toBe('osascript')
  expect(args.slice(-2)).toEqual(['--', pathToFileURL(filePath).href])
  expect(args[1]).toContain('if value of attribute "AXDocument" of docWindow is item 1 of argv then')
  expect(args[1]).not.toContain('tell application "TextEdit"')
  expect(args[1]).not.toMatch(/\bquit\b/)
  execFileSync.mockClear()
  closeExternalText('macos')
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
  expect(() => openExternalText('macos', paths, filePath)).toThrow('Automation denied')
  expect(() => closeExternalText('macos')).toThrow('Automation denied')
  execFileSync.mockReset()
  closeExternalText('macos')
  expect(execFileSync.mock.calls[0][1].at(-1)).toBe(pathToFileURL(filePath).href)
})

it('acknowledges an owned pre-main native dialog without requiring a main-window record', async () => {
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
      cdpPort: 9222,
      logPath: join(paths.logs, 'electron.log')
    })
  )
  execFileSync.mockImplementation((file, args) => {
    if (file === 'lsof') return '42001'
    if (file === 'ps' && args.includes('command=')) return `electron ${directory}`
    if (file === 'ps' && args.includes('ppid=')) return '42000'
    throw new Error('Unexpected process query')
  })
  execFile.mockImplementation((_file, _args, _options, callback) => callback(null))
  await dismissNativeMessageBox('macos', paths, 'Manual Restart Required')
  const [command, args] = execFile.mock.calls.at(-1)!
  expect(command).toBe('osascript')
  expect(args.slice(-2)).toEqual(['Manual Restart Required', '42001'])
  execFile.mockClear()
  execFileSync.mockImplementation((file, args) => {
    if (file === 'lsof') return '42001'
    if (file === 'ps' && args.includes('command=')) return `electron ${directory}`
    if (file === 'ps' && args.includes('ppid=')) return '0'
    throw new Error('Unexpected process query')
  })
  await expect(dismissNativeMessageBox('macos', paths, 'Manual Restart Required')).rejects.toThrow(
    'outside the owned run'
  )
  expect(execFile).not.toHaveBeenCalled()
})
