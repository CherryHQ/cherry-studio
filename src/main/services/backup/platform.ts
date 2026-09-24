import type { BackupPlatform } from './portability/managedPathRebase'

/**
 * The running platform as the archive's three-value platform tag.
 *
 * `BackupPlatform` is a closed set because path semantics only fork three ways
 * (case folding, separators, volume shape) and the manifest must round-trip the
 * value. Every other POSIX platform Electron can run on behaves like `linux`
 * for those rules, so it maps there rather than widening the format.
 */
export function currentBackupPlatform(): BackupPlatform {
  if (process.platform === 'win32') return 'win32'
  if (process.platform === 'darwin') return 'darwin'
  return 'linux'
}
