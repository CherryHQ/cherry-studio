import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { ensureRunDirectories, getRunPaths } from '../paths'
import { cleanupWindowsNotificationShortcut, registerWindowsNotificationShortcut } from '../windowsNotificationShortcut'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cherry-notification-shortcut-'))
  directories.push(directory)
  const paths = getRunPaths(join(directory, 'run'))
  ensureRunDirectories(paths)
  const source = join(paths.private, 'sdk.lnk')
  const programs = join(directory, 'Programs')
  mkdirSync(programs)
  writeFileSync(source, 'SDK shortcut with the owned executable and activator')
  const record = join(paths.private, 'windows-notification-shortcut.json')
  const destination = () => (JSON.parse(readFileSync(record, 'utf8')) as { destination: string }).destination
  return { paths, source, programs, record, destination }
}

it('removes only the unchanged registered copy and keeps the isolated SDK source', () => {
  const { paths, source, programs, record, destination } = fixture()
  registerWindowsNotificationShortcut(paths, source, programs)
  const copy = destination()
  expect(readFileSync(copy)).toEqual(readFileSync(source))

  cleanupWindowsNotificationShortcut(paths)
  cleanupWindowsNotificationShortcut(paths)
  expect(existsSync(copy)).toBe(false)
  expect(existsSync(record)).toBe(false)
  expect(existsSync(source)).toBe(true)
})

it('preserves a pre-existing shortcut when registration collides', () => {
  const { paths, source, programs, record, destination } = fixture()
  registerWindowsNotificationShortcut(paths, source, programs)
  const copy = destination()
  cleanupWindowsNotificationShortcut(paths)
  writeFileSync(copy, 'Pre-existing user shortcut')

  expect(() => registerWindowsNotificationShortcut(paths, source, programs)).toThrow()
  expect(readFileSync(copy, 'utf8')).toBe('Pre-existing user shortcut')
  expect(existsSync(record)).toBe(false)
})

it('preserves a shortcut changed after registration and keeps its cleanup record', () => {
  const { paths, source, programs, record, destination } = fixture()
  registerWindowsNotificationShortcut(paths, source, programs)
  const copy = destination()
  writeFileSync(copy, 'User replaced the shortcut')

  expect(() => cleanupWindowsNotificationShortcut(paths)).toThrow('modified notification shortcut')
  expect(readFileSync(copy, 'utf8')).toBe('User replaced the shortcut')
  expect(existsSync(record)).toBe(true)
})

it('cleans a registered copy through the controller after scenario cleanup was interrupted', () => {
  const { paths, source, programs, record, destination } = fixture()
  registerWindowsNotificationShortcut(paths, source, programs)
  const copy = destination()
  execFileSync(
    process.execPath,
    ['--import', 'tsx', resolve('scripts/e2e/regression/cli.ts'), 'cleanup', '--run-dir', paths.root],
    { stdio: 'pipe' }
  )
  expect(existsSync(copy)).toBe(false)
  expect(existsSync(record)).toBe(false)
})
