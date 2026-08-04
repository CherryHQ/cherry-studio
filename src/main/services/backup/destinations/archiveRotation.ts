import { loggerService } from '@logger'
import { getDeviceType, getHostname } from '@main/utils/system'

import type { DestinationTransport, RemoteArchive } from './destinationTransport'

const logger = loggerService.withContext('BackupArchiveRotation')

const ARCHIVE_PREFIX = 'cherry-studio'
const ARCHIVE_SUFFIX = '.zip'

/**
 * `cherry-studio.<timestamp>.<hostname>.<device>.zip`.
 *
 * THE NAME AND {@link isOwnArchive} ARE ONE UNIT. Rotation decides what to
 * delete by reading this name back, so a change to either side alone starts
 * deleting another machine's backups out of a shared folder. Extension stays
 * `.zip` because every already-shipped backup carries it and the picker lists on
 * it; the contents have been a v2 archive for a while.
 */
export function archiveName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const timestamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${ARCHIVE_PREFIX}.${timestamp}.${sanitize(getHostname())}.${getDeviceType()}${ARCHIVE_SUFFIX}`
}

/**
 * Hostnames reach us from the OS and can hold dots, which are this name's
 * separator. Collapsing them keeps a `.` from splitting one field into two.
 */
function sanitize(hostname: string): string {
  return hostname.replace(/[^a-zA-Z0-9_-]/g, '-')
}

/**
 * Was this archive written by THIS device?
 *
 * Rotation only ever deletes its own. Several machines commonly sync one cloud
 * folder, and a limit of 5 applied to the pooled listing means each machine
 * deletes the others' backups to make room for its own. Nutstore did exactly
 * that until this moved here: it matched every `cherry-studio*.zip` in the
 * directory regardless of origin.
 *
 * Archives that predate the naming convention match nothing and are therefore
 * never pruned. That is the safe direction — leaving a file the app cannot
 * account for beats deleting one it cannot account for.
 */
export function isOwnArchive(name: string): boolean {
  return (
    name.startsWith(`${ARCHIVE_PREFIX}.`) &&
    name.endsWith(ARCHIVE_SUFFIX) &&
    name.includes(`.${sanitize(getHostname())}.`) &&
    name.includes(`.${getDeviceType()}${ARCHIVE_SUFFIX}`)
  )
}

/**
 * Delete this device's oldest archives until `maxBackups` remain.
 *
 * ONLY EVER CALLED AFTER A SUCCESSFUL UPLOAD. Pruning first is how a failed
 * upload used to leave a user with nothing: with a limit of 1, "make room"
 * meant deleting the only backup they had, and then the replacement never
 * arrived.
 */
export async function pruneToLimit(transport: DestinationTransport, maxBackups: number): Promise<void> {
  if (maxBackups <= 0) return

  const own = (await transport.list())
    .filter((archive) => isOwnArchive(archive.name))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)

  const stale: RemoteArchive[] = own.slice(maxBackups)
  if (stale.length === 0) return

  logger.info(`Pruning ${stale.length} archive(s) beyond the limit of ${maxBackups}`)
  for (const archive of stale) {
    try {
      await transport.remove(archive.name)
    } catch (error) {
      // One undeletable archive must not abort the rest, and it must not fail
      // the backup that already succeeded.
      logger.warn(`Could not delete old backup ${archive.name}`, error as Error)
    }
  }
}
