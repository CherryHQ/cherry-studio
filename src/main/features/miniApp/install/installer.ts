/**
 * Local `.miniapp` installation.
 *
 * Order matters: extract and validate in a staging directory, publish to the
 * final path only once everything checks out, and write every row in one
 * transaction so a failure cannot leave an app row without its installation.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { application } from '@application'
import { miniAppFileRefTable } from '@data/db/schemas/fileRelations'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { loggerService } from '@logger'
import { notifyDataApiDataChange } from '@main/data/dataApiDataChange'
import { getAppLanguage } from '@main/i18n'
import type { LocalMiniApp } from '@shared/data/types/miniApp'
import {
  declaredGrantKeys,
  declaredGrants,
  MINI_APP_BUILTIN_ID_PREFIX,
  MINI_APP_OFFICIAL_ID_PREFIX,
  MINI_APP_OFFICIAL_ORIGINS,
  MINI_APP_SCHEME,
  type MiniAppManifest,
  MiniAppManifestSchema,
  resolveLocalizedText
} from '@shared/types/miniAppManifest'

import { miniAppActivityLog } from '../activityLog'
import { ownedFileEntryIds, reclaimEntries } from '../capabilities/file'
import { grantMiniAppPermissionsTx, replaceGrantsTx } from '../grants'
import { miniAppBackupPath, miniAppDataPath, miniAppInstallPath, miniAppRollingPath } from '../paths'
import { clearMiniAppPartition } from '../runtime/partition'
import { assertExtractedTree, extractMiniAppArchive } from './archive'
import { bestEffortCleanup } from './cleanup'
import { applyPackagedIcon } from './icon'
import { nextMiniAppOrderKey } from './orderKey'
import { clearPublishJournal, writePublishJournal } from './publishJournal'
import { withPublishLock } from './publishLock'

const logger = loggerService.withContext('miniAppInstaller')

/** Read the installation row, throwing when the app is not installed. */
export function installationOf(appId: string) {
  const [row] = application
    .get('DbService')
    .getDb()
    .select()
    .from(miniAppInstallationTable)
    .where(eq(miniAppInstallationTable.appId, appId))
    .all()
  if (!row) throw new Error(`Mini app is not installed: ${appId}`)
  return row
}

/**
 * Resolve a package-relative path inside an extracted tree, refusing anything that
 * escapes it. `PackageRelativePathSchema` already rejects traversal at parse time; this
 * is the runtime half, because a symlink inside the archive is not a path the schema
 * ever sees.
 */
export async function resolveInsideTree(root: string, relative: string): Promise<string> {
  const realRoot = await fs.promises.realpath(root)
  const target = await fs.promises.realpath(path.join(realRoot, relative))
  if (target !== realRoot && !target.startsWith(realRoot + path.sep)) {
    throw new Error(`Package path escapes the package: ${relative}`)
  }
  return target
}

/** Lowercase hex SHA-256 of one file — the shape `manifest.icon.sha256` declares. */
export async function hashFile(file: string): Promise<string> {
  return crypto
    .createHash('sha256')
    .update(await fs.promises.readFile(file))
    .digest('hex')
}

/**
 * The declared icon digest must match the bytes in the package.
 *
 * Called from `publishInstall` AND `publishUpdate` — the two places a package becomes
 * the installed truth. Everything downstream trusts it: `checkForUpdate` compares two
 * MANIFESTS, so if a manifest could claim any digest it liked, the preview would report
 * "icon unchanged" for a package that ships a new face. Verifying on only one of the two
 * paths leaves a first install free to lie, and every later comparison inherits the lie.
 */
export async function assertIconMatchesDigest(root: string, manifest: MiniAppManifest): Promise<void> {
  if (!manifest.icon) return
  const actual = await hashFile(await resolveInsideTree(root, manifest.icon.path))
  if (actual !== manifest.icon.sha256) {
    throw new Error(`Icon in package for ${manifest.id} does not match the digest its manifest declares`)
  }
}

export async function hashTree(dir: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const name of (await fs.promises.readdir(current)).sort()) {
      const full = path.join(current, name)
      const rel = prefix ? `${prefix}/${name}` : name
      const stat = await fs.promises.lstat(full)
      if (stat.isDirectory()) {
        hash.update(`d:${rel}\n`)
        await walk(full, rel)
      } else {
        hash.update(`f:${rel}:${stat.size}\n`)
        hash.update(await fs.promises.readFile(full))
      }
    }
  }
  await walk(dir, '')
  return `sha256:${hash.digest('hex')}`
}

/**
 * The reserved namespace is enforced HERE, not in `MiniAppIdSchema`.
 *
 * The schema does not know where a package came from, and it also parses journal
 * filenames and uninstall arguments — rejecting the prefix there would make a
 * legitimate builtin app's own journal unreadable.
 *
 * `'file'` is refused outright rather than merely denied a badge: `appId` is the
 * primary key, so one squatting install occupies the official id permanently and the
 * real package can never be installed afterwards. A downloaded file carries no
 * evidence of where it came from — OS quarantine attributes are strippable and do not
 * survive a copy — so there is nothing to verify it against.
 */
export function assertOfficialNamespace(
  appId: string,
  source: MiniAppInstallSourceInfo['source'],
  sourceOrigin: string | undefined,
  sourceOriginCn: string | undefined
): void {
  if (source === 'builtin') {
    if (!appId.startsWith(MINI_APP_BUILTIN_ID_PREFIX)) {
      throw new Error(`A builtin mini app must live under "${MINI_APP_BUILTIN_ID_PREFIX}", got "${appId}"`)
    }
    return
  }
  if (!appId.startsWith(MINI_APP_OFFICIAL_ID_PREFIX)) return
  /*
   * EVERY pinned origin, not just the global one. Either address can serve the bytes, so
   * "official global + attacker CN mirror" resolves to the attacker's manifest while
   * `sourceOrigin` still reads as official — and the reserved namespace is a primary key,
   * so one squatting install occupies the real package's id for ever.
   */
  const official =
    source === 'url' &&
    sourceOrigin !== undefined &&
    [sourceOrigin, sourceOriginCn].every(
      (origin) => origin === undefined || MINI_APP_OFFICIAL_ORIGINS.includes(origin as never)
    )
  if (!official) {
    throw new Error(`"${MINI_APP_OFFICIAL_ID_PREFIX}*" is a reserved namespace and this package cannot claim it`)
  }
}

export interface MiniAppInstallSourceInfo {
  source: 'file' | 'url' | 'builtin'
  sourceUrl?: string
  sourceOrigin?: string
  sourceOriginCn?: string
}

/** What the consent card sent back. `grantedOptional` omitted = every optional leaf stays on. */
export interface InstallGrantOptions {
  grantedOptional?: readonly string[]
}

/** The consent card's answer for an id that is already installed at the same or a lower version. */
export interface ReinstallOptions {
  /** Wipe what the app wrote — saves, files, cookies — before the new package lands. */
  clearData: boolean
}

export interface StagedMiniApp {
  stagingDir: string
  contentHash: string
  manifest: MiniAppManifest
}

/**
 * STAGE only — the file half of the two-phase flow (preview → consent → confirm).
 * Same shape as `stageBuiltinMiniApp`. The caller owns the returned tree
 * from this moment on; every failure inside cleans up after itself.
 */
export async function stageMiniAppFromFile(zipPath: string): Promise<StagedMiniApp> {
  const stagingDir = await createStagingDir()
  try {
    const manifest = await extractMiniAppArchive(zipPath, stagingDir)
    return { stagingDir, contentHash: await hashTree(stagingDir), manifest }
  } catch (error) {
    await bestEffortCleanup('file staging', () => fs.promises.rm(stagingDir, { recursive: true, force: true }))
    throw error
  }
}

/**
 * One-call stage+commit. No production caller — the product flow is two-phase through
 * `installFlow.ts` — but it is the composition every install-invariant
 * test exercises, and keeping it here keeps stage and commit from drifting apart.
 */
export async function installMiniAppFromFile(zipPath: string): Promise<LocalMiniApp> {
  const staged = await stageMiniAppFromFile(zipPath)
  try {
    return await installExtracted(staged.manifest, staged.stagingDir, { source: 'file' })
  } finally {
    await bestEffortCleanup('file-install staging', () =>
      fs.promises.rm(staged.stagingDir, { recursive: true, force: true })
    )
  }
}

/**
 * Copy an unpacked tree into staging and read its manifest.
 *
 * Never publish from the source tree directly: publishing RENAMES staging into place, and
 * a builtin app's source lives in read-only `resources/` (code-signed in the macOS bundle).
 */
export async function copyTreeToStaging(root: string, staging: string): Promise<MiniAppManifest> {
  await fs.promises.cp(root, staging, { recursive: true })
  const manifest = MiniAppManifestSchema.parse(
    JSON.parse(await fs.promises.readFile(path.join(staging, 'manifest.json'), 'utf8'))
  )
  // The archive path's post-extraction validation, same gate. Shipping inside
  // Cherry's resources buys no exemption: "full validation at install time" (§10.5).
  await assertExtractedTree(staging, manifest)
  return manifest
}

export async function createStagingDir(): Promise<string> {
  const packagesRoot = application.getPath('feature.mini_app.packages')
  await fs.promises.mkdir(packagesRoot, { recursive: true })
  return fs.promises.mkdtemp(path.join(packagesRoot, '.staging-'))
}

/**
 * Removes staging trees left behind by a CRASH mid-commit.
 *
 * Preview holds no staging (design §10.2) — a tree exists only during the few
 * seconds of a confirm or publish, and those delete it in `finally`. The one way
 * a tree survives is the process dying inside that window; this is its bound.
 *
 * Runs at startup, where every staging directory is by definition abandoned: no
 * commit can be in flight in a process that has just started.
 */
export async function sweepAbandonedStaging(): Promise<number> {
  const packagesRoot = application.getPath('feature.mini_app.packages')
  if (!fs.existsSync(packagesRoot)) return 0

  const stale = (await fs.promises.readdir(packagesRoot)).filter((n) => n.startsWith('.staging-'))
  let removed = 0
  for (const name of stale) {
    // Per-directory: one undeletable leftover must not shield every other one.
    if (
      await bestEffortCleanup(`stale staging ${name}`, () =>
        fs.promises.rm(path.join(packagesRoot, name), { recursive: true, force: true })
      )
    ) {
      removed += 1
    }
  }
  // Reality, not intent: a survivor must show up as `failed`, not inflate `removed`.
  if (stale.length > 0) logger.info('Swept mini app staging leftovers', { removed, failed: stale.length - removed })
  return removed
}

/**
 * The shared body of both install paths. Above it the two differ only in how the
 * package arrived; below it they are identical — and that identical part is the
 * crash-consistency protocol, which is the last thing that should exist twice.
 */
export async function installExtracted(
  manifest: MiniAppManifest,
  staging: string,
  info: MiniAppInstallSourceInfo,
  options: InstallGrantOptions = {},
  reinstall?: ReinstallOptions
): Promise<LocalMiniApp> {
  // Before the lock, because it needs nothing shared and a bad package should be
  // refused without making concurrent installs wait for it.
  assertOfficialNamespace(manifest.id, info.source, info.sourceOrigin, info.sourceOriginCn)
  await assertIconMatchesDigest(staging, manifest)
  // Check-then-act across BOTH filesystem and database, so the DB transaction alone
  // cannot make it safe — two installs would both pass the check before either writes.
  // Quiesced INSIDE the lock either way — the same nesting as update and uninstall. A
  // FRESH install needs it too, because it clears the partition and no guest may write
  // back into what it empties. "There is no installation row yet" does not stand in for
  // that: neither `ensurePartition` nor the attach gate consults one.
  const app = await withPublishLock(manifest.id, () =>
    application
      .get('MiniAppRuntimeService')
      .withAppQuiesced(manifest.id, () =>
        reinstall
          ? publishReinstall(manifest, staging, info, options, reinstall)
          : publishInstall(manifest, staging, info, options)
      )
  )
  // After the commit, outside the lock. Installing is an IpcApi write DataApi never
  // sees — without this signal the launcher's `/mini-apps` query keeps yesterday's list.
  notifyDataApiDataChange([{ endpoint: '/mini-apps', kind: reinstall ? 'projection' : 'membership' }])
  return app
}

/**
 * Everything the app WROTE, nothing it shipped with: the save file, the file blobs and
 * their refs, the session's cookies and caches. The package tree and the rows stay.
 * Callers hold the app quiesced — a live guest would write straight back into this.
 */
export async function wipeMiniAppData(appId: string): Promise<void> {
  // Collected BEFORE the delete: afterwards there is no ref row left to join through.
  const orphaned = ownedFileEntryIds(appId, application.get('DbService').getDb())
  // Journalled for the same reason an uninstall is: the rows go first and the stores after,
  // so a crash in between leaves the files unlisted while `storage.json` and the partition
  // survive — a "clear data" the app reads its old state straight back out of.
  writePublishJournal({ kind: 'clear-data', appId })
  application.get('DbService').withWriteTx((tx) => {
    // `sourceId`, not `appId` — that is the column name on this table.
    tx.delete(miniAppFileRefTable).where(eq(miniAppFileRefTable.sourceId, appId)).run()
  })
  // NOT counted below: recovery cannot redo it, because the orphan list is read before the
  // delete and nothing on disk records it.
  await reclaimEntries(orphaned)

  // Two INDEPENDENT attempts, never `swept &&= await ...`: that short-circuits, so a data
  // tree which refused would skip the partition and leave a "cleared" app's cookies alive.
  const treeSwept = await bestEffortCleanup('clear data tree', () =>
    fs.promises.rm(miniAppDataPath(appId), { recursive: true, force: true })
  )
  const partitionSwept = await bestEffortCleanup('clear data partition', () => clearMiniAppPartition(appId))
  // A store that would not clear stays journalled: startup recovery retries exactly it.
  if (treeSwept && partitionSwept) {
    clearPublishJournal(appId)
    return
  }
  // And THROWS. A half-done clear must not read as done: the caller records a `clear_data`
  // grant on the strength of this returning, and a reinstall writes its own entry over this
  // very journal file — which would drop the retry recovery is holding.
  throw new Error(`Mini app data for ${appId} could not be fully cleared`)
}

/**
 * The same or an older version over an installed one: "uninstall + install" as ONE
 * publish, keeping what an uninstall would lose for no reason — the launcher position,
 * the pinned/enabled status, the model slots and (unless asked) the app's data.
 *
 * The `mini_app` row is UPDATED, never deleted: the file refs and the logo slot hang off
 * it by cascade, and "keep my data" is exactly the promise a delete would break. No
 * rollback snapshot either — this is not an update, and a `.backup` here would offer a
 * rollback to a version the rows no longer describe.
 */
async function publishReinstall(
  manifest: MiniAppManifest,
  staging: string,
  info: MiniAppInstallSourceInfo,
  options: InstallGrantOptions,
  reinstall: ReinstallOptions
): Promise<LocalMiniApp> {
  const db = application.get('DbService').getDb()
  const [existing] = db
    .select({ kind: miniAppTable.kind, status: miniAppTable.status, orderKey: miniAppTable.orderKey })
    .from(miniAppTable)
    .where(eq(miniAppTable.appId, manifest.id))
    .all()
  if (!existing || existing.kind !== 'app') throw new Error(`Mini app is not installed: ${manifest.id}`)
  const row = installationOf(manifest.id)

  const installPath = miniAppInstallPath(manifest.id)
  const backup = miniAppBackupPath(manifest.id)
  const builtinId = info.source === 'builtin' ? manifest.id : null
  const url = `${MINI_APP_SCHEME}://${manifest.id}/${manifest.entry}`
  const contentHash = await hashTree(staging)

  // BEFORE any tree moves: a wipe that fails must stop the reinstall with the old
  // version still intact, not leave the new one running over half-deleted data.
  if (reinstall.clearData) await wipeMiniAppData(manifest.id)

  // The `update` protocol: the old tree parks in `.backup` until the rows commit, so
  // startup recovery (`publishJournal`) can put it back after a crash. The one
  // difference is at the end — the parked tree is deleted rather than retained.
  await fs.promises.rm(backup, { recursive: true, force: true })
  // `reinstall`, not `update`: the same version re-extracts to the hash the row already
  // holds, which would make recovery read "committed" before the transaction below runs.
  writePublishJournal({
    kind: 'reinstall',
    appId: manifest.id,
    contentHash,
    previousContentHash: row.contentHash
  })
  let movedToBackup = false
  let granted: string[] = []
  try {
    if (fs.existsSync(installPath)) {
      await fs.promises.rename(installPath, backup)
      movedToBackup = true
    }
    await fs.promises.rename(staging, installPath)
    application.get('DbService').withWriteTx((tx) => {
      tx.update(miniAppTable)
        .set({ presetMiniAppId: builtinId, name: resolveLocalizedText(manifest.name, 'en'), url })
        .where(eq(miniAppTable.appId, manifest.id))
        .run()
      tx.update(miniAppInstallationTable)
        .set({
          version: manifest.version,
          contentHash,
          source: info.source,
          sourceUrl: info.sourceUrl ?? null,
          sourceOrigin: info.sourceOrigin ?? null,
          sourceOriginCn: info.sourceOriginCn ?? null,
          manifestJson: manifest,
          consentedDeclaredJson: declaredGrantKeys(manifest),
          previousManifestJson: null,
          previousContentHash: null,
          previousGrantsJson: null,
          previousConsentedDeclaredJson: null
        })
        .where(eq(miniAppInstallationTable.appId, manifest.id))
        .run()
      // A fresh consent, not a diff: the card showed the whole list and the user answered it.
      const { required, optional } = declaredGrants(manifest)
      const chosen = options.grantedOptional
        ? optional.filter((key) => options.grantedOptional!.includes(key))
        : optional
      granted = [...required, ...chosen]
      replaceGrantsTx(tx, manifest.id, granted, manifest.version)
    })
  } catch (error) {
    // BOTH statements under the guard, as `publishUpdate` has them: if the park itself
    // threw, the live tree is still at `installPath` and there is no copy to put back —
    // an unconditional delete here destroys the installed app.
    if (movedToBackup) {
      await fs.promises.rm(installPath, { recursive: true, force: true })
      await fs.promises.rename(backup, installPath)
    }
    clearPublishJournal(manifest.id)
    throw error
  }

  // Committed. The parked tree has no rows describing it any more, so it goes.
  await bestEffortCleanup('reinstall backup', () => fs.promises.rm(backup, { recursive: true, force: true }))
  await applyPackagedIcon(manifest.id, installPath, manifest).catch((error) =>
    logger.warn('Reinstalled without a packaged icon', { id: manifest.id, error })
  )
  clearPublishJournal(manifest.id)
  // Whatever dot an earlier check lit was about the version that is now gone.
  application.get('MiniAppRuntimeService').noteUpdateAvailable(manifest.id, null)
  logger.info('Reinstalled mini app', { id: manifest.id, version: manifest.version, clearData: reinstall.clearData })
  miniAppActivityLog.recordGrant(manifest.id, { name: 'reinstall', version: manifest.version, permissions: granted })

  return {
    appId: manifest.id,
    kind: 'app',
    presetMiniAppId: builtinId,
    aiModelId: row.aiModelId,
    aiQuickModelId: row.aiQuickModelId,
    name: resolveLocalizedText(manifest.name, getAppLanguage()),
    nameI18n: manifest.name,
    url,
    status: existing.status,
    orderKey: existing.orderKey,
    version: manifest.version
  }
}

/**
 * A fresh install owns NOTHING of whoever held this appId before it.
 *
 * The previous owner's uninstall is best-effort by policy: a tree or a partition that
 * would not clear leaves the app gone from the launcher with its `storage.json` and its
 * cookies still on disk, journalled for a recovery that only runs at startup — which an
 * install in this same process never waits for. The appId comes from the manifest, so
 * the next owner need not be the same publisher, and inheriting a saved token or a live
 * session is not a continuity quirk.
 *
 * Every store is attempted, and every store must go: a partial slate is refused, not
 * published. Refusing is safe here in a way it is not in an uninstall — nothing has
 * been committed yet, so the user keeps an app they can retry rather than losing one.
 * The old journal deliberately survives the refusal; it is still the record of what is
 * owed. Callers hold `withAppQuiesced` (see `clearMiniAppPartition`).
 */
async function assertCleanSlate(appId: string): Promise<void> {
  // Logged before the sweep: past it the evidence is gone, and "there was debris" is the
  // signal that some earlier uninstall did not finish.
  if (fs.existsSync(miniAppInstallPath(appId))) {
    logger.warn('Reclaiming an orphan mini app directory before install', { id: appId })
  }
  let cleared = true
  for (const tree of [
    miniAppInstallPath(appId),
    miniAppBackupPath(appId),
    miniAppRollingPath(appId),
    miniAppDataPath(appId)
  ]) {
    // Its own `await`, never `cleared &&= await ...`: that short-circuits, so one tree
    // refusing would skip every store after it and report a slate nothing swept.
    const removed = await bestEffortCleanup('install slate tree', () =>
      fs.promises.rm(tree, { recursive: true, force: true })
    )
    cleared &&= removed
  }
  const partitionCleared = await bestEffortCleanup('install slate partition', () => clearMiniAppPartition(appId))
  cleared &&= partitionCleared
  if (cleared) return
  throw new Error(`Mini app ${appId} still holds state from a previous install that could not be cleared`)
}

async function publishInstall(
  manifest: MiniAppManifest,
  staging: string,
  info: MiniAppInstallSourceInfo,
  options: InstallGrantOptions
): Promise<LocalMiniApp> {
  const installPath = miniAppInstallPath(manifest.id)
  const builtinId = info.source === 'builtin' ? manifest.id : null

  const db = application.get('DbService').getDb()
  const taken = db.select().from(miniAppTable).where(eq(miniAppTable.appId, manifest.id)).all().length > 0
  if (taken) throw new Error(`A mini app with id "${manifest.id}" is already installed`)

  // Before the slate is swept, or recovery repairs these same trees underneath it and the
  // app starts life owning whatever the repair put back.
  const runtime = application.get('MiniAppRuntimeService')
  await runtime.recovered
  await assertCleanSlate(manifest.id)

  const contentHash = await hashTree(staging)
  const orderKey = nextMiniAppOrderKey()
  const url = `${MINI_APP_SCHEME}://${manifest.id}/${manifest.entry}`

  // Journal BEFORE the final path, carrying the hash the rows will hold: the two
  // sides of the commit need OPPOSITE repairs, and only the row tells them apart.
  writePublishJournal({ kind: 'install', appId: manifest.id, contentHash })

  await fs.promises.rename(staging, installPath)
  let granted: string[] = []
  try {
    application.get('DbService').withWriteTx((tx) => {
      tx.insert(miniAppTable)
        .values({
          appId: manifest.id,
          kind: 'app',
          // The ONE fact that says "Cherry ships this", for sites and apps alike.
          // Deriving it from `source` instead forks every "is this official?" read.
          presetMiniAppId: builtinId,
          // Denormalized for sorting and for the column site rows share. 'en' keeps it
          // stable; the DISPLAYED name is resolved per language from `manifestJson`.
          name: resolveLocalizedText(manifest.name, 'en'),
          url,
          status: 'enabled',
          orderKey
        })
        .run()
      tx.insert(miniAppInstallationTable)
        .values({
          appId: manifest.id,
          version: manifest.version,
          contentHash,
          source: info.source,
          sourceUrl: info.sourceUrl ?? null,
          sourceOrigin: info.sourceOrigin ?? null,
          sourceOriginCn: info.sourceOriginCn ?? null,
          manifestJson: manifest,
          // What the consent card actually listed — `storage.*` expands differently
          // over time, so `manifestJson` alone cannot separate a widening from a revoke.
          consentedDeclaredJson: declaredGrantKeys(manifest)
        })
        .run()
      // Same transaction as the rows. Optional leaves are on unless the user unticked them on
      // the card; filtered against the manifest so nothing undeclared rides in from the renderer.
      const { required, optional } = declaredGrants(manifest)
      const chosen = options.grantedOptional
        ? optional.filter((key) => options.grantedOptional!.includes(key))
        : optional
      granted = [...required, ...chosen]
      grantMiniAppPermissionsTx(tx, manifest.id, granted, manifest.version)
    })
  } catch (error) {
    // Nothing committed: the files are the only thing published, so undo them.
    await fs.promises.rm(installPath, { recursive: true, force: true })
    clearPublishJournal(manifest.id)
    throw error
  }

  // Past this line the install IS committed. The icon is cosmetic, so a failure here
  // may neither delete the app nor leave the journal armed for the next startup.
  await applyPackagedIcon(manifest.id, installPath, manifest).catch((error) =>
    logger.warn('Installed without a packaged icon', { id: manifest.id, error })
  )
  clearPublishJournal(manifest.id)
  // The barrier's verdict was about trees `assertCleanSlate` has since removed. Left
  // standing it would leave this install permanently unopenable — recovery cannot run
  // again in this process, so nothing else would ever lift it.
  await runtime.clearUnrepaired(manifest.id)
  logger.info('Installed mini app', { id: manifest.id, version: manifest.version })
  miniAppActivityLog.recordGrant(manifest.id, { name: 'install', version: manifest.version, permissions: granted })

  return {
    appId: manifest.id,
    kind: 'app',
    presetMiniAppId: builtinId,
    // A fresh install follows the global models until the user picks one in the panel.
    aiModelId: null,
    aiQuickModelId: null,
    // Resolved for the CURRENT language: this goes straight into the UI that just
    // finished installing. The stored column keeps the stable 'en' form.
    name: resolveLocalizedText(manifest.name, getAppLanguage()),
    nameI18n: manifest.name,
    url,
    status: 'enabled',
    orderKey,
    version: manifest.version
  }
}

export async function uninstallMiniApp(appId: string): Promise<void> {
  // Publish lock OUTSIDE, quiesce INSIDE — same nesting as `applyUpdate`. Reversing
  // them lets an install and an uninstall each hold what the other waits for.
  return withPublishLock(appId, () =>
    application.get('MiniAppRuntimeService').withAppQuiesced(appId, async () => {
      // Read BEFORE the cascade takes the ref rows with it. Reclaiming here rather than
      // in Task 11 is not tidiness: `capabilities/file` does not exist yet at Task 11.
      const db = application.get('DbService').getDb()
      const orphaned = ownedFileEntryIds(appId, db)

      // Verify WHAT is being uninstalled, inside the lock. `MiniAppIdSchema` admits
      // ids like `openai`, and the preset guard lives in a different entry point.
      const [target] = db
        .select({ kind: miniAppTable.kind })
        .from(miniAppTable)
        .where(eq(miniAppTable.appId, appId))
        .all()
      if (!target) throw new Error(`Mini app is not installed: ${appId}`)
      if (target.kind !== 'app') {
        throw new Error(`Only locally installed mini apps can be uninstalled; "${appId}" is a ${target.kind}`)
      }
      const installed =
        db
          .select({ appId: miniAppInstallationTable.appId })
          .from(miniAppInstallationTable)
          .where(eq(miniAppInstallationTable.appId, appId))
          .all().length > 0
      if (!installed) throw new Error(`Mini app has no installation record: ${appId}`)

      const installPath = miniAppInstallPath(appId)

      // Rows go first (everything cascades off the mini_app row), leaving a window
      // where the directory has nothing behind it — a crash there strands the appId.
      writePublishJournal({ kind: 'uninstall', appId })
      application.get('DbService').withWriteTx((tx) => {
        tx.delete(miniAppTable).where(eq(miniAppTable.appId, appId)).run()
      })
      // Committed: the launcher must drop the entry even if a tree below refuses to delete.
      notifyDataApiDataChange([{ endpoint: '/mini-apps', kind: 'membership' }])
      // The app's OWN data too, or a reinstall of the same appId reads back the previous
      // owner's `storage.json` — the one leak a fresh install must never have.
      let swept = true
      for (const tree of [installPath, miniAppBackupPath(appId), miniAppRollingPath(appId), miniAppDataPath(appId)]) {
        const removed = await bestEffortCleanup('uninstall tree', () =>
          fs.promises.rm(tree, { recursive: true, force: true })
        )
        swept &&= removed
      }
      // Cookies and the HTTP cache live on the partition, not on the `mini_app` row —
      // nothing cascades them, and a reinstall would resume the old server identity.
      // BEFORE the journal is cleared, and counted in `swept`: this is the other store
      // recovery can redo, so clearing the journal first would make a crash in between
      // leave it alive with nothing left on disk pointing at it.
      // Its own `await`, never `swept &&= await ...`: that short-circuits, so one tree
      // refusing would skip the partition and leave cookies for the next install of this id.
      const partitionSwept = await bestEffortCleanup('uninstall partition', () => clearMiniAppPartition(appId))
      swept &&= partitionSwept

      // A store that would not clear stays journalled: startup recovery retries it.
      if (swept) clearPublishJournal(appId)
      logger.info('Uninstalled mini app', { id: appId })

      // The blobs are the user's data too: an "uninstall" that leaves them listed on the
      // files page for the grace hour is the same unkept promise as "clear data".
      // NOT counted in `swept`: recovery cannot redo it — the orphan list is computed
      // before the commit and nothing on disk records it.
      await bestEffortCleanup('uninstall file entries', () => reclaimEntries(orphaned))

      // AFTER the commit: a failed uninstall must leave the badge as it was. Awaited, so
      // the documented "the log goes with the app" is true by the time this resolves.
      await application.get('MiniAppRuntimeService').forgetApp(appId)
    })
  )
}
