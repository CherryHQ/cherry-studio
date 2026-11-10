import { createHash } from 'node:crypto'
import { constants, copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'

import { type RunPaths, resolveAllowedPath } from './paths'

const checksum = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const leasePath = (paths: RunPaths) => join(paths.private, 'windows-notification-shortcut.json')
const shortcutName = (paths: RunPaths) =>
  `Cherry Studio E2E ${createHash('sha256').update(paths.root).digest('hex').slice(0, 12)}.lnk`

export function registerWindowsNotificationShortcut(paths: RunPaths, source: string, programs: string): void {
  resolveAllowedPath(source, [paths.root])
  if (!isAbsolute(programs) || !source.endsWith('.lnk')) throw new Error('Invalid notification shortcut path')
  const destination = join(programs, shortcutName(paths))
  const lease = { destination, checksum: checksum(source) }
  writeFileSync(leasePath(paths), JSON.stringify(lease), { flag: 'wx', mode: 0o600 })
  try {
    copyFileSync(source, destination, constants.COPYFILE_EXCL)
  } catch (error) {
    rmSync(leasePath(paths))
    throw error
  }
}

export function cleanupWindowsNotificationShortcut(paths: RunPaths): void {
  const path = leasePath(paths)
  if (!existsSync(path)) return
  const lease = JSON.parse(readFileSync(path, 'utf8')) as { destination: string; checksum: string }
  if (!isAbsolute(lease.destination) || basename(lease.destination) !== shortcutName(paths))
    throw new Error('Invalid notification shortcut ownership record')
  if (existsSync(lease.destination)) {
    if (checksum(lease.destination) !== lease.checksum)
      throw new Error('Refusing to remove a modified notification shortcut')
    rmSync(lease.destination)
  }
  rmSync(path)
}
