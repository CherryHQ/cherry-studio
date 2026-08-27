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

/** The previous tree, retained after an update so a rollback is one rename. */
export function miniAppBackupPath(appId: string): string {
  return `${miniAppInstallPath(appId)}.backup`
}

/** The tree a rollback sets aside, so an interrupted rollback can be undone. */
export function miniAppRollingPath(appId: string): string {
  return `${miniAppInstallPath(appId)}.rolling`
}
