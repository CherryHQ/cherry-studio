import { application } from '@application'
import { CHERRY_HOME } from '@main/core/paths/constants'
import { resolveProfileRoots } from '@main/core/profile/profileRegistry'
import { resolveBootProfile } from '@main/core/profile/profileStore'
import { app } from 'electron'

/**
 * Preboot Seam A (RFC §4.6): resolve which profile is active and install its
 * path slot before `initPathRegistry()` builds the app slot, so every
 * per-profile path (DB, Data subtree, credentials) resolves to the active
 * profile from its first access. `initPathRegistry()` leaves an already-installed
 * slot intact, so this determines which profile the process boots into.
 *
 * Runs after `resolveUserDataLocation()` (so `userData` is final) and before
 * `initPathRegistry()` — it must not use `application.getPath`, which is not yet
 * available; it reads `userData` from Electron directly.
 */
export function installActiveProfilePathRegistry(): void {
  const entry = resolveBootProfile()
  const roots = resolveProfileRoots(entry, app.getPath('userData'), CHERRY_HOME)
  application.setProfilePathRegistry(roots.profileRoot, roots.credentialRoot)
}
