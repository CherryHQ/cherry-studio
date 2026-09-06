import fs from 'node:fs'

import { application } from '@application'
import { miniAppInstallationTable } from '@data/db/schemas/miniApp'
import { miniAppService } from '@data/services/MiniAppService'
import { getAppLanguage } from '@main/i18n'
import { getDirectorySize } from '@main/utils/fileOperations'
import type { MiniAppDetail } from '@shared/ipc/schemas/miniApp'
import {
  declaredGrantKeys,
  declaredGrants,
  MiniAppManifestSchema,
  resolveLocalizedText
} from '@shared/types/miniAppManifest'
import { eq } from 'drizzle-orm'

import { miniAppActivityLog } from './activityLog'
import { fileCapability } from './capabilities/file'
import { storageCapability } from './capabilities/storage'
import { grantMiniAppPermissionsTx, listGrants, pendingDeclaredAdditions, revokeGrant } from './grants'
import { installationOf, wipeMiniAppData } from './install/installer'
import { checkForUpdate, type UpdateStatus } from './install/webInstaller'
import { miniAppBackupPath, miniAppInstallPath } from './paths'

export async function miniAppDetail(appId: string): Promise<MiniAppDetail> {
  const row = installationOf(appId)
  const manifest = MiniAppManifestSchema.parse(row.manifestJson)
  const locale = getAppLanguage()
  const runtime = application.get('MiniAppRuntimeService')
  // The same resolution the launcher tile uses — one place knows how a logo becomes a URL.
  const { logo, logoSrc } = miniAppService.getByAppId(appId)
  return {
    appId,
    version: row.version,
    logo,
    logoSrc,
    name: resolveLocalizedText(manifest.name, locale),
    description: resolveLocalizedText(manifest.description, locale),
    // The DECLARED set with each leaf's state: a revoked leaf is in neither `grants` nor
    // `pendingAdditions`, so a panel rendering only those two can never offer it back.
    declared: (() => {
      const { required, optional } = declaredGrants(manifest)
      const granted = new Set(listGrants(appId))
      return [
        ...required.map((key) => ({ key, optional: false, granted: true })),
        ...optional.map((key) => ({ key, optional: true, granted: granted.has(key) }))
      ]
    })(),
    grants: listGrants(appId),
    // Straight off the manifest — hosts are the network permission's scope, not grants,
    // so there is nothing in the grant table to read them from (design §7).
    network: manifest.network,
    pendingAdditions: pendingDeclaredAdditions(appId, manifest, row.consentedDeclaredJson),
    updateVersion: runtime.updateVersionOf(appId),
    aiModelId: row.aiModelId,
    aiQuickModelId: row.aiQuickModelId,
    // Derived here rather than shipping the column: the panel decides whether to show
    // a rollback button, and `previousContentHash` means nothing to the renderer.
    //
    // BOTH halves, because `rollbackUpdate` gates on both. The record and the snapshot are
    // written at different moments — a publish that fails or crashes after dropping the old
    // snapshot but before committing leaves the columns describing a tree that is gone — and
    // a button offered off the record alone would then throw on every click. Its THIRD gate,
    // `hashTree(backup)`, is deliberately NOT mirrored: hashing a whole tree on every panel
    // open buys only a corrupt-snapshot case whose one path-collision cause no longer exists.
    canRollback: row.previousContentHash !== null && fs.existsSync(miniAppBackupPath(appId)),
    source: row.source,
    sourceUrl: row.sourceUrl,
    // `storageCapability.usage` is synchronous and `fileCapability.usage` is not (Tasks 19/20).
    storage: storageCapability.usage(appId),
    file: await fileCapability.usage(appId),
    packageBytes: await directoryBytes(miniAppInstallPath(appId)),
    snapshotBytes: await directoryBytes(miniAppBackupPath(appId))
  }
}

/** Zero for a tree that is not there — `.backup` exists only while a rollback is possible. */
const directoryBytes = (dir: string) => (fs.existsSync(dir) ? getDirectorySize(dir) : Promise.resolve(0))

/** `packages/<appId>/` is deliberately untouched: "clear data" keeps the app installed and runnable (design §11). */
export async function clearMiniAppData(appId: string): Promise<void> {
  await application.get('MiniAppRuntimeService').withAppQuiesced(appId, () => wipeMiniAppData(appId))
  // Reached only when BOTH stores cleared: `wipeMiniAppData` throws otherwise, and this
  // line must never log a clear whose cookies outlived it. Do not wrap the await.
  miniAppActivityLog.recordGrant(appId, { name: 'clear_data' })
}

/**
 * Give back one leaf the user had revoked.
 *
 * Without this, revoke is a one-way door: the row is gone, so it is not "granted", and
 * `consentedDeclaredJson` still lists it, so it is not "pending" either — the only way
 * back was a reset that wipes all data, or a reinstall. The consent baseline is
 * deliberately NOT touched here; its job is only to stop the host asking again by itself.
 */
export async function grantMiniAppPermission(appId: string, permission: string): Promise<void> {
  const row = installationOf(appId)
  const manifest = MiniAppManifestSchema.parse(row.manifestJson)
  // OPTIONAL only, and against the CURRENT manifest: a required grant is a precondition
  // of the install, so there is no state in which it is absent and needs giving back.
  if (!declaredGrants(manifest).optional.some((key) => key === permission)) {
    throw new Error(`Mini app ${appId} does not declare ${permission} as optional`)
  }

  // No event: the app reads its own state with `app.getPermissions()`, and it re-reads
  // on `app.visibilityChange` — which fired when the user opened this panel.
  application.get('DbService').withWriteTx((tx) => grantMiniAppPermissionsTx(tx, appId, [permission], row.version))
  miniAppActivityLog.recordGrant(appId, { name: 'grant', permissions: [permission] })
}

export async function grantPendingAdditions(appId: string): Promise<void> {
  const row = installationOf(appId)
  const manifest = MiniAppManifestSchema.parse(row.manifestJson)
  const pending = pendingDeclaredAdditions(appId, manifest, row.consentedDeclaredJson)
  if (pending.length === 0) return

  application.get('DbService').withWriteTx((tx) => {
    grantMiniAppPermissionsTx(tx, appId, pending, row.version)
    // The full expansion is correct HERE and nowhere else: the user just looked at
    // these leaves and agreed. `publishUpdate` may not do this — see its comment.
    tx.update(miniAppInstallationTable)
      .set({ consentedDeclaredJson: declaredGrantKeys(manifest) })
      .where(eq(miniAppInstallationTable.appId, appId))
      .run()
  })
  const runtime = application.get('MiniAppRuntimeService')
  runtime.clearPendingSnooze(appId)
  runtime.broadcastAttentionState()
  miniAppActivityLog.recordGrant(appId, { name: 'grant_pending', permissions: pending })
}

/** "Not now": the dot goes out for this launch; the leaves stay listed in the panel with their grant button. */
export async function snoozePendingAdditions(appId: string): Promise<void> {
  installationOf(appId)
  application.get('MiniAppRuntimeService').snoozePending(appId)
  miniAppActivityLog.recordGrant(appId, { name: 'snooze_pending' })
}

export async function revokeMiniAppGrant(appId: string, permission: string): Promise<void> {
  // OPTIONAL only, against the CURRENT manifest: without this the renderer can hand in a
  // REQUIRED leaf and get the installed-but-broken app §6.0.1 exists to prevent.
  const manifest = MiniAppManifestSchema.parse(installationOf(appId).manifestJson)
  if (!declaredGrants(manifest).optional.some((key) => key === permission)) {
    throw new Error(`Mini app ${appId} does not declare ${permission} as optional; it cannot be revoked`)
  }
  // No quiesce, no connection reset: the bridge re-checks every call, so the next one already
  // fails, and an in-flight `net.fetch` runs on the default session where a reset cannot reach it.
  revokeGrant(appId, permission)
  miniAppActivityLog.recordGrant(appId, { name: 'revoke', permissions: [permission] })
}

export async function checkUpdateOnOpen(appId: string): Promise<UpdateStatus> {
  if (!application.get('PreferenceService').get('feature.mini_app.check_updates_on_open')) return { status: 'current' }
  // A local package has no endpoint to check; `checkForUpdate` refuses it outright.
  if (installationOf(appId).source === 'file') return { status: 'current' }
  return checkForUpdate(appId)
}
