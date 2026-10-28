/**
 * Every path a mini app publish can touch, derived from the appId.
 *
 * NOTHING persists these — not the database, not the publish journal. userData
 * relocation copies the whole tree, so a stored absolute path goes stale for every
 * app at once, and a stale path that is also a recursive-delete target is the worst
 * combination available.
 */
import path from 'node:path'

import { application } from '@application'

export function miniAppInstallPath(appId: string): string {
  return path.join(application.getPath('feature.mini_app.packages'), appId)
}

/**
 * Where the app's OWN data lives. Deliberately not under `packages/<appId>/`: that tree
 * is replaced wholesale by `rename` on update, is restored on rollback, and is what
 * `hashTree` covers — a save file in there would be deleted by the next update AND
 * would change `contentHash` on every write, breaking crash recovery's only signal.
 */
export function miniAppDataPath(appId: string): string {
  return path.join(application.getPath('feature.mini_app.data'), appId)
}

export function miniAppStorageFile(appId: string): string {
  return path.join(miniAppDataPath(appId), 'storage.json')
}

/** The app's activity log days. Under logs, not data: "clear data" leaves it, uninstall removes it. */
export function miniAppLogsPath(appId: string): string {
  return path.join(application.getPath('feature.mini_app.logs'), appId)
}

/**
 * Where a Cherry release ships a builtin app's unpacked tree. Under `resources/`, not
 * userData: it is part of the installed application, replaced by upgrading Cherry.
 */
export function miniAppBuiltinPath(appId: string): string {
  return path.join(application.getPath('feature.mini_app.builtin'), appId)
}

/**
 * Snapshots live in their OWN root, never beside the install trees. `.` is a legal appId
 * character, so `packages/<appId>.backup` is at the same time the install directory of an
 * app legitimately called `<appId>.backup`: installing that app would reclaim the other
 * app's snapshot as an orphan, and rolling the other app back would publish this app's
 * tree under the wrong identity and grants.
 */
function miniAppSnapshotPath(appId: string, suffix: string): string {
  return path.join(application.getPath('feature.mini_app.snapshots'), `${appId}.${suffix}`)
}

/** The previous tree, retained after an update so a rollback is one rename. */
export function miniAppBackupPath(appId: string): string {
  return miniAppSnapshotPath(appId, 'backup')
}

/** The tree a rollback sets aside, so an interrupted rollback can be undone. */
export function miniAppRollingPath(appId: string): string {
  return miniAppSnapshotPath(appId, 'rolling')
}
