import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync }))

import { ensureRunDirectories, getRunPaths } from '../paths'
import { closeExternalText, openExternalText } from '../systemAutomation'

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
