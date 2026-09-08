/**
 * Remote source install and update.
 *
 * Auto-update is real supply-chain surface: a benign app with users is a standing
 * invitation to ship something else later. Silence is broken by ANY growth in the
 * declared set AND by any growth in the declared HOSTS — a new domain adds no permission
 * but opens an exfiltration channel, so it stops the update just as a new capability does.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import type { MiniAppInstallationRow } from '@data/db/schemas/miniApp'
import { miniAppInstallationTable, miniAppTable } from '@data/db/schemas/miniApp'
import { loggerService } from '@logger'
import { notifyDataApiDataChange } from '@main/data/dataApiDataChange'
import { getAppLanguage } from '@main/i18n'
import { transcodeToEntityWebp } from '@main/utils/image'
import type { LocalMiniApp } from '@shared/data/types/miniApp'
import {
  declaredGrantKeys,
  type LocalizedText,
  MINI_APP_SCHEME,
  type MiniAppDistributionManifest,
  type MiniAppManifest,
  MiniAppManifestSchema,
  resolveLocalizedText
} from '@shared/types/miniAppManifest'
import { eq } from 'drizzle-orm'
import { gt as semverGt } from 'semver'

import { miniAppActivityLog } from '../activityLog'
import {
  diffDeclaredHosts,
  diffDeclaredSets,
  grantMiniAppPermissionsTx,
  listGrants,
  listGrantsTx,
  replaceGrantsTx,
  revokeGrantTx
} from '../grants'
import { miniAppBackupPath, miniAppBuiltinPath, miniAppInstallPath, miniAppRollingPath } from '../paths'
import { extractMiniAppArchive } from './archive'
import { bestEffortCleanup } from './cleanup'
import { assertHttps, fetchIcon, fetchManifest, fetchPackage, mirrorOrder } from './httpSource'
import { applyPackagedIcon, assertSupportedIconBytes } from './icon'
import {
  assertIconMatchesDigest,
  copyTreeToStaging,
  createStagingDir,
  hashTree,
  installationOf,
  installExtracted,
  type InstallGrantOptions,
  type MiniAppInstallSourceInfo,
  type ReinstallOptions
} from './installer'
import { clearPublishJournal, writePublishJournal } from './publishJournal'
import { withPublishLock } from './publishLock'

const logger = loggerService.withContext('miniAppWebInstaller')

// The snapshot the token resolves to. It carries `identityChange` because the panel
// renders WHAT THE USER SAW, never a diff recomputed at apply time.

/** `identityChange` is present whenever the app renames itself or swaps its icon. */
export interface MiniAppIdentityChange {
  /** Whole tables, not resolved strings: a rename in a locale the user is not
   *  currently reading is still a rename, and switching language afterwards must not
   *  make the change invisible. */
  name?: { from: LocalizedText; to: LocalizedText }
  icon?: { from: string | null; to: string | null }
}

/** Key-sorted, so two equal tables written in different orders compare equal. */
function normalizeLocalizedText(text: LocalizedText): string {
  if (typeof text === 'string') return JSON.stringify(text)
  return JSON.stringify(Object.fromEntries(Object.entries(text).sort(([a], [b]) => (a < b ? -1 : 1))))
}

export type UpdateStatus =
  // The absent fields are declared so callers can read `updateToken` off the union.
  | { status: 'current'; updateToken?: undefined; identityChange?: undefined }
  | {
      status: 'ready'
      version: string
      /** Newly OFFERED optional leaves. Shown, never blocking — declining just means not granted. */
      addedOptional: string[]
      /** Leaves the next manifest no longer declares; revoked on apply. */
      removed: string[]
      updateToken: string
      identityChange?: MiniAppIdentityChange
      /** Already resolved for the UI language — the panel never sees the raw locale table. */
      releaseNotes?: string
    }
  | {
      status: 'needs-consent'
      version: string
      added: string[]
      addedOptional: string[]
      /** Leaves the next manifest no longer declares; revoked on apply. */
      removed: string[]
      addedHosts: string[]
      updateToken: string
      identityChange?: MiniAppIdentityChange
      releaseNotes?: string
    }

/**
 * What the user actually reviewed. `applyUpdate` consumes THIS, never a fresh
 * fetch: re-fetching between the review and the apply lets the server swap the
 * payload, turning a specific consent into a blank cheque.
 */
interface ReviewedUpdate {
  appId: string
  /** The url payload pins the DISTRIBUTION manifest — `package` is read off it at apply. */
  manifest: MiniAppManifest & { package?: MiniAppDistributionManifest['package'] }
  added: string[]
  removed: string[]
  /**
   * What the user was SHOWN about the app's identity, pinned at check time.
   *
   * The panel renders this; it is deliberately a SNAPSHOT rather than something the
   * apply step recomputes, because "what did the user agree to" and "what is different
   * now" are different questions and only the first one is consent.
   */
  identityChange?: MiniAppIdentityChange
  /**
   * The installed version the diff was computed AGAINST. Without it two tokens
   * issued at v1 can both be applied: the second would replay a v1-relative diff
   * onto v2, revoking grants v2 legitimately declares and re-adding ones it dropped.
   */
  baseVersion: string
  baseContentHash: string
  /**
   * Where the bytes come from, and what binds them to what the user reviewed.
   *
   * `web` re-downloads and checks the sha256 the manifest pinned. `local` re-reads the
   * file the user picked, which can be swapped in between — identical manifests would
   * sail through `assertManifestMatchesReviewed`, so the tree hash computed at preview
   * time is the only thing tying the confirmation to these bytes.
   *
   * A union rather than two optional fields: "web with a zipPath" and "local with an
   * origin" are states this must not be able to represent.
   */
  payload:
    | { kind: 'url'; origins: readonly string[] }
    | { kind: 'file'; zipPath: string; contentHash: string }
    /** The read-only tree this Cherry release ships. No pin needed: it cannot change under us. */
    | { kind: 'builtin'; root: string }
  /**
   * Hosts this update adds. Kept beside `added` rather than inside it: a host is not a
   * grant (design §7), but a NEW host is still a new place the app's data can go, so it
   * gates the apply exactly the same way.
   */
  addedHosts: string[]
  /**
   * Newly OFFERED optional leaves. Pinned even though they never block the apply: the
   * consent BASELINE has to record what the user was shown, or every one of them stays
   * "pending" for ever and keeps the attention badge lit.
   */
  addedOptional: string[]
  /**
   * Set when the update arrives through the INSTALL entry over an installed app: the
   * user chose a source themselves (a file over a web install, a new address over an
   * old one), and the installation row is re-pinned to it at apply. An ordinary
   * check-for-updates never moves the pin — that is what the origin check is for.
   */
  repin?: MiniAppInstallSourceInfo
  expiresAt: number
}

export const REVIEW_TTL_MS = 10 * 60_000

/** The update-consent ledger — the same §5.2 normalization as the install ledger. */
class MiniAppUpdateReviewService {
  private readonly reviewed = new Map<string, ReviewedUpdate>()

  issue(review: Omit<ReviewedUpdate, 'expiresAt'>): string {
    // `expiresAt` decides VALIDITY, nothing decides LIFETIME — so sweep on issue, the
    // only operation that grows the map. Two live tokens for one app is a real state.
    const now = Date.now()
    for (const [key, entry] of this.reviewed) {
      if (entry.expiresAt <= now) this.reviewed.delete(key)
    }

    const token = crypto.randomUUID()
    this.reviewed.set(token, { ...review, expiresAt: now + REVIEW_TTL_MS })
    return token
  }

  /** One-shot: consuming removes it, so a replay cannot re-apply a stale snapshot. */
  consume(appId: string, token: string | undefined): ReviewedUpdate {
    const review = token ? this.reviewed.get(token) : undefined
    if (!review) throw new Error(`Unknown or already-spent update token for ${appId}`)
    this.reviewed.delete(token!)
    if (review.appId !== appId) throw new Error(`Update token does not belong to ${appId}`)
    if (Date.now() > review.expiresAt) throw new Error(`Update token for ${appId} has expired; check again`)
    return review
  }
}

export const miniAppUpdateReviewService = new MiniAppUpdateReviewService()

/**
 * The remote manifest is what the user saw and consented to; the packaged manifest
 * is what will actually run. Any divergence in identity, version, entry, permissions
 * or network means the consent does not cover these bytes.
 */
function assertManifestMatchesReviewed(review: MiniAppManifest, packaged: MiniAppManifest): void {
  const project = (m: MiniAppManifest) =>
    JSON.stringify({
      id: m.id,
      // Reviewed, not decoration — the notification prefix is built from them. Compared
      // as a NORMALIZED table: a resolved string lets every other locale change freely.
      name: normalizeLocalizedText(m.name),
      // Part of what the user read when granting. NOT in `identityChange`: rewording is
      // ordinary authorship, while a rename changes WHO the product says is talking.
      description: normalizeLocalizedText(m.description),
      icon: m.icon ?? null,
      version: m.version,
      entry: m.entry,
      permissions: [...m.permissions].sort(),
      // Optional ones too: without this a package can grow an optional capability AFTER the
      // preview, and the install records it as "already shown" to a user who never saw it.
      optionalPermissions: [...m.optionalPermissions].sort(),
      network: [...m.network].sort(),
      // BOTH of them. The origin pin stops a domain swap but not a different PATH on the
      // same origin — and the next check would go there.
      update: [m.update?.url ?? null, m.update?.urlCn ?? null]
    })
  if (project(review) !== project(packaged)) {
    throw new Error(`Packaged manifest does not match the reviewed manifest for ${review.id}`)
  }
}

/**
 * Where to ask about new versions: the INSTALLED manifest's own `update.url`, falling
 * back to the URL the app was installed from.
 *
 * Derived, never stored. An update that moves the endpoint rewrites `manifestJson`, so
 * the next check follows it; a rollback restores `manifestJson`, so the endpoint comes
 * back with it. A `sourceUrl` column updated in parallel would need its own `previous`
 * twin to be rollback-correct, which is two more ways to be wrong for no gain.
 *
 * Safe because `checkForUpdate` refuses any manifest whose `update.url` leaves
 * `sourceOrigin` — a hijacked domain cannot walk the endpoint off the pinned origin.
 */
function updateEndpointsOf(row: MiniAppInstallationRow): { url: string; urlCn?: string } {
  const update = MiniAppManifestSchema.parse(row.manifestJson).update
  const url = update?.url ?? row.sourceUrl!
  const pinned = pinnedOrigins(row)
  // BEFORE the request: validating the response is too late twice over — the request
  // is already made, and a response that OMITS `update` used to fall back and pass.
  for (const candidate of [url, update?.urlCn]) {
    if (candidate && !pinned.includes(new URL(candidate).origin)) {
      throw new Error(`Update endpoint for ${row.appId} left its origin pin (${pinned.join(', ')})`)
    }
  }
  return { url, urlCn: update?.urlCn }
}

/**
 * The one or two origins an app may talk to for its whole life, decided at install.
 *
 * `update.url` is canonical and `update.urlCn` the accelerator, so ORDER IS MEANINGFUL:
 * `[0]` lands in `sourceOrigin`, `[1]` in `sourceOriginCn`. A manifest with no `update`
 * block installs fine — its only origin is where the manifest came from — it simply
 * never has an update to check for.
 */
function declaredOrigins(manifest: MiniAppDistributionManifest): string[] {
  // One or two, canonical first. The accelerator is optional; the schema keeps
  // `update.urlCn` and `package.urlCn` both-or-neither, so a lone package mirror never lands here.
  const { url, urlCn } = manifest.update
  return urlCn ? [new URL(url).origin, new URL(urlCn).origin] : [new URL(url).origin]
}

/**
 * The pointer is pinned; the payload has to be too, or `package.url` is a free hop.
 *
 * Pinned BY REGION, not to the union: the global package belongs on the global origin
 * and the accelerated one on the accelerator. Allowing any of the four to sit on either
 * origin turns "two pinned origins" into a four-way choice, and an author has no reason
 * to split one region's files across two hosts.
 */
function assertPackageOrigins(manifest: MiniAppDistributionManifest, origins: readonly string[]): void {
  const pairs: Array<[string | undefined, string | undefined]> = [
    [manifest.package.url, origins[0]],
    [manifest.package.urlCn, origins[1]]
  ]
  for (const [url, origin] of pairs) {
    if (!url) continue
    if (!origin) throw new Error(`Mini app ${manifest.id} declares a package mirror with no matching update origin`)
    if (new URL(url).origin !== origin) {
      throw new Error(`Package url ${url} is not on its region's declared origin ${origin}`)
    }
  }
  // The icon has no region: any pinned origin will do, an unpinned one will not.
  if (manifest.package.iconUrl && !origins.includes(new URL(manifest.package.iconUrl).origin)) {
    throw new Error(`Icon url ${manifest.package.iconUrl} is not on a declared origin`)
  }
}

/**
 * POSITIONAL equality, not set equality: index 0 is the global source and index 1 the
 * China one, and `mirrorOrder` picks between them by region. Sorting first would accept a
 * manifest that swaps the two, after which Chinese users get the global source first and
 * everyone else gets the China one — a silent regional inversion, pinned for good.
 */
function sameOrigins(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** The pinned origins as stored: `sourceOrigin` is NOT NULL for `source='url'`; the accelerator may be absent. */
function pinnedOrigins(row: MiniAppInstallationRow): string[] {
  return row.sourceOriginCn ? [row.sourceOrigin!, row.sourceOriginCn] : [row.sourceOrigin!]
}

/**
 * Surfaced alongside permissions, for the same reason: a rename is not cosmetic when
 * the product uses the name as the app's identity in notifications and lists.
 */
function describeIdentityChange(previous: MiniAppManifest, next: MiniAppManifest): MiniAppIdentityChange | undefined {
  const change: MiniAppIdentityChange = {}
  if (normalizeLocalizedText(previous.name) !== normalizeLocalizedText(next.name)) {
    change.name = { from: previous.name, to: next.name }
  }
  // By DIGEST, not by path: a same-path byte swap is the ordinary way to change an
  // app's face, and a path comparison cannot see it.
  if ((previous.icon?.sha256 ?? null) !== (next.icon?.sha256 ?? null)) {
    change.icon = { from: previous.icon?.path ?? null, to: next.icon?.path ?? null }
  }
  return Object.keys(change).length > 0 ? change : undefined
}

/**
 * The author's note for the version being offered, resolved for the UI language.
 *
 * Read off the manifest already pinned into the token, never re-fetched: the panel has to
 * show the notes belonging to the bytes it is about to install.
 */
function resolveReleaseNotes(manifest: MiniAppManifest): string | undefined {
  return manifest.releaseNotes ? resolveLocalizedText(manifest.releaseNotes, getAppLanguage()) : undefined
}

/**
 * The half every update path shares: diff OLD declared vs NEW declared (never against
 * current grants, which would report a user-revoked permission as newly requested), pin
 * what the user saw into the token, and say what they must do about it.
 */
function reviewUpdate(
  appId: string,
  row: MiniAppInstallationRow,
  next: MiniAppManifest,
  payload: ReviewedUpdate['payload'],
  opts: { announce: boolean; repin?: MiniAppInstallSourceInfo }
): UpdateStatus {
  const previous = MiniAppManifestSchema.parse(row.manifestJson)
  const { added, addedOptional, removed } = diffDeclaredSets(previous, next)
  const addedHosts = diffDeclaredHosts(previous, next)
  const identityChange = describeIdentityChange(previous, next)
  const updateToken = miniAppUpdateReviewService.issue({
    appId,
    manifest: next,
    added,
    removed,
    addedOptional,
    addedHosts,
    // Pinned into the token, not recomputed at apply time: the gate has to ask "what did
    // the user actually see", and a fresh diff answers a different question.
    identityChange,
    baseVersion: row.version,
    baseContentHash: row.contentHash,
    payload,
    repin: opts.repin
  })
  // A CHECK lights the dot; an install the user is holding in their hands has nothing to
  // go and tell them about.
  if (opts.announce) application.get('MiniAppRuntimeService').noteUpdateAvailable(appId, next.version)
  const releaseNotes = resolveReleaseNotes(next)
  // `addedOptional` rides along on BOTH branches: it is shown, never blocking (§6.0.1).
  if (added.length > 0 || addedHosts.length > 0) {
    return {
      status: 'needs-consent',
      version: next.version,
      added,
      addedOptional,
      removed,
      addedHosts,
      updateToken,
      identityChange,
      releaseNotes
    }
  }
  return { status: 'ready', version: next.version, addedOptional, removed, updateToken, identityChange, releaseNotes }
}

/**
 * The install entry landing on an installed app at a HIGHER version: the same review,
 * token and apply as a web update — diffed grants, quiesce, rollback snapshot, data
 * untouched — with the source re-pinned to what the user just chose. The caller has
 * already compared versions and checked the reserved namespace against `repin`.
 */
export function reviewUpgradeOverInstalled(
  appId: string,
  next: MiniAppManifest & { package?: MiniAppDistributionManifest['package'] },
  payload: ReviewedUpdate['payload'],
  repin: MiniAppInstallSourceInfo
): UpdateStatus {
  return reviewUpdate(appId, installationOf(appId), next, payload, { announce: false, repin })
}

/**
 * A builtin app changes exactly once: when a Cherry release replaces its shipped tree.
 * No network and no manifest url — the tree hash IS the signal — but everything after
 * that point is the ordinary review, so a new permission still stops at `needs-consent`.
 */
async function checkBuiltinUpdate(appId: string, row: MiniAppInstallationRow, root: string): Promise<UpdateStatus> {
  const runtime = application.get('MiniAppRuntimeService')
  if ((await hashTree(root)) === row.contentHash) {
    runtime.noteUpdateAvailable(appId, null)
    return { status: 'current' }
  }
  const shipped = MiniAppManifestSchema.parse(
    JSON.parse(await fs.promises.readFile(path.join(root, 'manifest.json'), 'utf8'))
  )
  // The same check the url path does. A `resources/` directory holding the wrong app's
  // manifest would otherwise write that manifest onto THIS appId's installation row.
  if (shipped.id !== appId) throw new Error(`Builtin tree for ${appId} declares id ${shipped.id}`)
  // NO `semverGt` gate here, unlike the url path, and the difference is deliberate: that
  // gate refuses a SERVER-pushed downgrade or a same-version replay, and a builtin tree
  // arrives inside the signed Cherry the user already installed — there is no such pusher.
  // The shipped bytes are what this release means to run, so the hash is the signal.
  //
  // Which leaves one real mistake it cannot defend against, and this is where it surfaces:
  // shipping changed bytes without bumping the version. Loud, because the update then
  // offers a version the user already has, and only a log can say why.
  if (!semverGt(shipped.version, row.version)) {
    logger.error('Builtin mini app tree changed without a version bump', {
      appId,
      installed: row.version,
      shipped: shipped.version
    })
  }
  return reviewUpdate(appId, row, shipped, { kind: 'builtin', root }, { announce: true })
}

/**
 * Only ever CHECKS, and the token it returns is the whole consent record. Applying
 * is always an explicit user action from the detail panel — there is no timer and no
 * silent auto-install (product decision).
 *
 * Deliberately ignores the `check_updates_on_open` preference, which gates only the on-open check: a user
 * who turned that off must still be able to check manually.
 */
/** One check per app at a time: every open fires one, and a hanging server must not stack them. */
const inFlightChecks = new Map<string, Promise<UpdateStatus>>()

export function checkForUpdate(appId: string, builtinRoot?: string): Promise<UpdateStatus> {
  const pending = inFlightChecks.get(appId)
  if (pending) return pending
  const check = runUpdateCheck(appId, builtinRoot).finally(() => inFlightChecks.delete(appId))
  inFlightChecks.set(appId, check)
  return check
}

async function runUpdateCheck(appId: string, builtinRoot?: string): Promise<UpdateStatus> {
  const row = installationOf(appId)
  // `builtinRoot` is injectable for tests only; production always reads `resources/`.
  if (row.source === 'builtin') return checkBuiltinUpdate(appId, row, builtinRoot ?? miniAppBuiltinPath(appId))
  // A local package has no `sourceOrigin` to pin, and its own `update.url` cannot supply one.
  if (row.source !== 'url' || !row.sourceUrl || !row.sourceOrigin) {
    throw new Error(`Mini app ${appId} has no pinned update origin and cannot check for updates online`)
  }
  const endpoints = updateEndpointsOf(row)
  const pinned = pinnedOrigins(row)
  const remote = await fetchManifest(await mirrorOrder(endpoints.url, endpoints.urlCn))

  // Refuses a response that MOVES, ADDS or DROPS an endpoint: changing mirrors is a
  // re-install, or a hijacked endpoint walks the supply chain one "update" at a time.
  if (!sameOrigins(declaredOrigins(remote), pinned)) {
    throw new Error(`Update origins changed for ${appId}: pinned ${pinned.join(', ')}; re-install to move mirrors`)
  }
  if (remote.id !== appId) throw new Error(`Update manifest id mismatch for ${appId}`)
  const runtime = application.get('MiniAppRuntimeService')
  // STRICTLY greater: `!==` accepts a server-pushed downgrade, and same-version-new-bytes
  // is deliberately "current" — not bumping the version IS refusing to say it changed.
  if (!semverGt(remote.version, row.version)) {
    // EVERY exit records the answer: a check that finds nothing must CLEAR a dot an
    // earlier one lit, or the badge outlives its reason and nobody trusts it.
    runtime.noteUpdateAvailable(appId, null)
    return { status: 'current' }
  }
  if (!remote.package) throw new Error(`Update manifest for ${appId} declares no package url/hash`)
  assertPackageOrigins(remote, pinned)

  return reviewUpdate(appId, row, remote, { kind: 'url', origins: pinned }, { announce: true })
}

export async function applyUpdate(
  appId: string,
  opts: { updateToken: string; consented?: boolean; grantedOptional?: readonly string[] }
): Promise<void> {
  const review = miniAppUpdateReviewService.consume(appId, opts.updateToken)
  if ((review.added.length > 0 || review.addedHosts.length > 0) && !opts.consented) {
    const what = [...review.added, ...review.addedHosts.map((h) => `host ${h}`)]
    throw new Error(`Update for ${appId} needs consent for: ${what.join(', ')}`)
  }
  const runtime = application.get('MiniAppRuntimeService')
  // Registered BEFORE the download: from here the tile shows "updating" and refuses a second run.
  runtime.beginUpdate(appId, review.manifest.version)
  try {
    await applyReviewedUpdate(appId, review, opts.grantedOptional)
  } finally {
    runtime.endUpdate(appId)
  }
}

/** The apply proper: download outside the lock, publish inside it, the app quiesced only for the swap. */
async function applyReviewedUpdate(
  appId: string,
  review: ReviewedUpdate,
  grantedOptional?: readonly string[]
): Promise<void> {
  // Bound to a local `const` before the branch: TypeScript does not keep a narrowing
  // of `review.payload` alive inside the closures below.
  const payload = review.payload
  if (payload.kind === 'file') {
    // Nothing to download and nothing to clean up — the bytes are the user's own file.
    await withPublishLock(appId, () =>
      application
        .get('MiniAppRuntimeService')
        .withAppQuiesced(appId, () =>
          publishUpdate(appId, review, (staging) => extractMiniAppArchive(payload.zipPath, staging), grantedOptional)
        )
    )
    return
  }

  if (payload.kind === 'builtin') {
    // No download either: the bytes shipped with this Cherry release and are already on
    // disk, read-only. `copyBuiltinTree` is the same one the first install used.
    await withPublishLock(appId, () =>
      application
        .get('MiniAppRuntimeService')
        .withAppQuiesced(appId, () =>
          publishUpdate(appId, review, (staging) => copyTreeToStaging(payload.root, staging), grantedOptional)
        )
    )
    return
  }

  // Downloaded OUTSIDE the lock: it is the slow part and it touches nothing shared.
  const pkg = review.manifest.package!
  const downloaded = await fetchPackage(
    await mirrorOrder(pkg.url, pkg.urlCn),
    { sha256: pkg.sha256, size: pkg.size, origins: payload.origins },
    (received, total) => application.get('MiniAppRuntimeService').noteUpdateProgress(appId, received / total)
  )
  try {
    await withPublishLock(appId, () =>
      // Offline BEFORE the mutation: until the old page is gone, the new grants belong
      // to code the user never reviewed.
      application
        .get('MiniAppRuntimeService')
        .withAppQuiesced(appId, () =>
          publishUpdate(appId, review, (staging) => extractMiniAppArchive(downloaded.path, staging), grantedOptional)
        )
    )
  } finally {
    await bestEffortCleanup('update download', () => downloaded.cleanup())
  }
}

/**
 * `fill` is the ONLY thing that differs between a zip update and a builtin one: how the
 * new bytes reach `staging`. Everything after it — hash, icon digest, backup, journal,
 * rename, grants, rollback snapshot — is shared, which is what makes shipping the first
 * builtin app a content change rather than an infrastructure change.
 */
async function publishUpdate(
  appId: string,
  review: ReviewedUpdate,
  fill: (staging: string) => Promise<MiniAppManifest>,
  grantedOptional?: readonly string[]
): Promise<void> {
  const { manifest: remote, added, addedOptional, removed } = review
  const row = installationOf(appId)
  // The token describes a diff FROM a specific version. If the app moved since,
  // replaying it revokes grants the current version declares.
  if (row.version !== review.baseVersion || row.contentHash !== review.baseContentHash) {
    throw new Error(`Update token for ${appId} was issued against ${review.baseVersion}; the app is now ${row.version}`)
  }

  const installPath = miniAppInstallPath(appId)
  // `createStagingDir()`, not a hand-built path: the sweeper matches
  // `startsWith('.staging-')`, which a `<appId>.staging-x7` basename never satisfies.
  const staging = await createStagingDir()
  const backup = miniAppBackupPath(appId)
  // Snapshot BEFORE mutating: rollback has to restore what the user actually held.
  const previousGrants = listGrants(appId)
  const previousConsented = row.consentedDeclaredJson
  // Until this flips, `.backup` is the RETAINED previous version, not this update's.
  let movedToBackup = false
  let granted: string[] = []

  try {
    const manifest = await fill(staging)
    // The user consented to the REVIEWED manifest. If the manifest inside the
    // package declares anything different, the bytes are not what was reviewed.
    assertManifestMatchesReviewed(remote, manifest)
    const contentHash = await hashTree(staging)
    // The web path is bound to the reviewed bytes by the pinned sha256; the local path
    // has no such pin, and the file can be swapped under a byte-identical manifest.
    if (review.payload.kind === 'file' && contentHash !== review.payload.contentHash) {
      throw new Error(`Package for ${appId} changed since it was reviewed; pick it again`)
    }

    // The digest must describe the bytes actually shipped — otherwise it is a
    // self-certifying claim, and `checkForUpdate` compared nothing.
    await assertIconMatchesDigest(staging, manifest)

    // Keep the previous tree until the new one is committed — rollback is one rename.
    await fs.promises.rm(backup, { recursive: true, force: true })
    writePublishJournal({ kind: 'update', appId, contentHash })
    await fs.promises.rename(installPath, backup)
    movedToBackup = true
    await fs.promises.rename(staging, installPath)

    application.get('DbService').withWriteTx((tx) => {
      tx.update(miniAppInstallationTable)
        .set({
          version: manifest.version,
          contentHash,
          manifestJson: manifest,
          // Captured here, consumed by rollbackUpdate — without these the rollback
          // path reads columns nothing ever wrote.
          previousManifestJson: MiniAppManifestSchema.parse(row.manifestJson),
          previousContentHash: row.contentHash,
          previousGrantsJson: previousGrants,
          previousConsentedDeclaredJson: previousConsented,
          // The OLD baseline plus exactly what the user SAW — agreed-to plus merely offered —
          // never the new manifest's expansion. Only a human extends a record of what a human saw.
          consentedDeclaredJson: [...new Set([...previousConsented, ...added, ...addedOptional])].sort(),
          // Provenance follows the user's choice and is NOT snapshotted: a rollback
          // restores code and declarations, never where the app came from.
          ...(review.repin
            ? {
                source: review.repin.source,
                sourceUrl: review.repin.sourceUrl ?? null,
                sourceOrigin: review.repin.sourceOrigin ?? null,
                sourceOriginCn: review.repin.sourceOriginCn ?? null
              }
            : {})
        })
        .where(eq(miniAppInstallationTable.appId, appId))
        .run()
      tx.update(miniAppTable)
        .set({
          name: resolveLocalizedText(manifest.name, 'en'),
          url: `${MINI_APP_SCHEME}://${appId}/${manifest.entry}`,
          ...(review.repin ? { presetMiniAppId: review.repin.source === 'builtin' ? appId : null } : {})
        })
        .where(eq(miniAppTable.appId, appId))
        .run()
      // ONLY what the user just consented to — the new required leaves plus the newly offered
      // optional ones they left ticked. Re-granting the full declared set would restore every
      // permission they had revoked.
      const chosenOptional = grantedOptional
        ? addedOptional.filter((key) => grantedOptional.includes(key))
        : addedOptional
      granted = [...added, ...chosenOptional]
      grantMiniAppPermissionsTx(tx, appId, granted, manifest.version)
      for (const key of removed) revokeGrantTx(tx, appId, key)
    })
  } catch (error) {
    // Not committed: put the previous tree back under the unchanged rows.
    if (movedToBackup) {
      await fs.promises.rm(installPath, { recursive: true, force: true })
      await fs.promises.rename(backup, installPath)
    }
    clearPublishJournal(appId)
    throw error
  } finally {
    await bestEffortCleanup('update staging', () => fs.promises.rm(staging, { recursive: true, force: true }))
  }

  // Committed. The icon is cosmetic and must not undo an applied update.
  await applyPackagedIcon(appId, installPath, remote).catch((error) =>
    logger.warn('Updated without a packaged icon', { appId, error })
  )
  clearPublishJournal(appId)
  // The dot's reason is gone. Missing this leaves a badge lit on a current app, which
  // is worse than no badge — it trains the user to ignore it.
  application.get('MiniAppRuntimeService').noteUpdateAvailable(appId, null)
  logger.info('Updated mini app', { appId, version: remote.version })
  miniAppActivityLog.recordGrant(appId, {
    name: 'update',
    version: remote.version,
    permissions: granted,
    removed: [...removed]
  })
  // Name, version and entry url may all have changed; the row set did not.
  notifyDataApiDataChange([{ endpoint: '/mini-apps', kind: 'projection' }])
}

/**
 * Undo a half-done rollback, WITHOUT destroying the version it was rolling back to.
 *
 * By this point `installPath` may already hold the previous tree and `.backup` may
 * already be gone. Deleting `installPath` to make room for `.rolling` would consume
 * the only remaining copy of that previous version — while the database still says
 * a previous version is retained. The user would then be permanently unable to roll
 * back, with the records insisting they can. So the old tree goes back to `.backup`
 * first, restoring exactly the state a successful update leaves behind.
 */
async function undoRollback(appId: string): Promise<void> {
  const installPath = miniAppInstallPath(appId)
  const backup = miniAppBackupPath(appId)
  const rolling = miniAppRollingPath(appId)
  if (!fs.existsSync(rolling)) return

  if (fs.existsSync(installPath) && !fs.existsSync(backup)) {
    await fs.promises.rename(installPath, backup)
  } else {
    await fs.promises.rm(installPath, { recursive: true, force: true })
  }
  await fs.promises.rename(rolling, installPath)
}

/**
 * What a declared-key SET should be after rolling back — NOT simply the snapshot.
 *
 * Used for BOTH grants and the consent baseline: they are the same kind of thing, a
 * record of user decisions that the update straddles.
 *
 * Restoring `previousGrantsJson` verbatim protects "revoked before the update" but
 * silently undoes "revoked AFTER it": a leaf both versions declare stays on the panel
 * the whole time, so a revoke made since the update is a decision the user can see, and
 * a rollback that reverses it is the same betrayal the snapshot exists to prevent —
 * just in the other direction.
 *
 * Split by WHERE the declaration lives:
 *  - in both manifests → the user could act on it all along, so the CURRENT grant wins
 *  - only in the old one → it vanished from the panel at update time, so the snapshot is
 *    the user's last effective word on it
 *
 * (Leaves only the NEW manifest declares are not declared after the rollback at all, so
 * `declared ∩ granted` drops them without any row bookkeeping here.)
 *
 * No "required floor" on top: the snapshot was taken from a real state, and "install
 * grants every required leaf + revoke refuses a required one" already keeps it ⊇ required.
 * A floor would only ever act on states that violate that invariant — and applied to the
 * consent baseline it would also mark a leaf consented that `pendingDeclaredAdditions`
 * is about to report as pending.
 */
function rolledBackSet(
  previousManifest: MiniAppManifest,
  currentManifest: MiniAppManifest,
  snapshot: readonly string[],
  current: readonly string[]
): string[] {
  const oldDeclared = declaredGrantKeys(previousManifest)
  const stillDeclared = new Set(declaredGrantKeys(currentManifest))
  return oldDeclared.filter((key) => (stillDeclared.has(key) ? current.includes(key) : snapshot.includes(key))).sort()
}

/** Records and grants in ONE transaction — a partial rollback is a mixed state. */
function commitRollback(
  appId: string,
  previous: MiniAppManifest,
  previousContentHash: string,
  previousGrants: string[],
  // The whole row, not just the three fields above: rollback restores the consent
  // baseline and the icon baseline too, and both live only on the row.
  row: MiniAppInstallationRow
): void {
  // Parsed once: both merges below need the leaves the panel has been showing.
  const currentManifest = MiniAppManifestSchema.parse(row.manifestJson)
  application.get('DbService').withWriteTx((tx) => {
    tx.update(miniAppInstallationTable)
      .set({
        version: previous.version,
        contentHash: previousContentHash,
        manifestJson: previous,
        // Same rule as grants, not a wholesale restore: a leaf the host added mid-version
        // and the user consented to would otherwise come back "granted yet pending".
        consentedDeclaredJson: rolledBackSet(
          previous,
          currentManifest,
          row.previousConsentedDeclaredJson ?? [],
          row.consentedDeclaredJson
        ),
        previousManifestJson: null,
        previousContentHash: null,
        previousGrantsJson: null,
        previousConsentedDeclaredJson: null
      })
      .where(eq(miniAppInstallationTable.appId, appId))
      .run()
    tx.update(miniAppTable)
      .set({ name: resolveLocalizedText(previous.name, 'en'), url: `${MINI_APP_SCHEME}://${appId}/${previous.entry}` })
      .where(eq(miniAppTable.appId, appId))
      .run()
    // Same transaction as the record they describe. `row.manifestJson` is the CURRENT
    // manifest — the leaves the panel has been showing, i.e. what the user could act on.
    const grants = rolledBackSet(previous, currentManifest, previousGrants, listGrantsTx(tx, appId))
    replaceGrantsTx(tx, appId, grants, previous.version)
  })
}

/**
 * Rollback is integral or it is worse than nothing: restoring only the directory
 * leaves "files are v1, records say v2", which is harder to diagnose than a failed
 * update. Grants come from the recorded snapshot, NOT from the previous manifest —
 * see `previousGrantsJson`.
 */
export async function rollbackUpdate(appId: string): Promise<void> {
  return withPublishLock(appId, () =>
    application.get('MiniAppRuntimeService').withAppQuiesced(appId, async () => {
      const row = installationOf(appId)
      const installPath = miniAppInstallPath(appId)
      const backup = miniAppBackupPath(appId)
      const rolling = miniAppRollingPath(appId)
      if (!fs.existsSync(backup)) throw new Error(`No previous version retained for ${appId}`)
      if (!row.previousManifestJson || !row.previousContentHash) {
        throw new Error(`No previous record retained for ${appId}`)
      }

      // The snapshot path is derived from the appId, so its EXISTENCE proves nothing about
      // its contents. Publishing an unverified tree would run it under this app's identity,
      // version and grants; `previousContentHash` is what the records actually promise.
      if ((await hashTree(backup)) !== row.previousContentHash) {
        throw new Error(`Retained version of ${appId} does not match the recorded content hash`)
      }

      const previous = MiniAppManifestSchema.parse(row.previousManifestJson)
      const previousGrants = row.previousGrantsJson ?? []

      // The stale tree goes FIRST. A rollback whose post-commit sweep failed leaves
      // `.rolling` behind, and a later update never touches it — arming the journal over
      // that survivor would let recovery rename an arbitrary older tree over `installPath`.
      await fs.promises.rm(rolling, { recursive: true, force: true })
      // Its OWN journal state: `.backup` is already consumed, so an update-shaped
      // repair restores nothing. `.rolling` is what gives recovery something to use.
      writePublishJournal({ kind: 'rollback', appId, contentHash: row.previousContentHash })

      try {
        await fs.promises.rename(installPath, rolling)
        await fs.promises.rename(backup, installPath)
        commitRollback(appId, previous, row.previousContentHash, previousGrants, row)
      } catch (error) {
        // Compensate NOW: leaving it to the journal keeps the running app serving from
        // a missing directory until restart.
        await undoRollback(appId)
        clearPublishJournal(appId)
        throw error
      }
      // Committed. A `.rolling` that will not delete stays journalled so startup retries it.
      const swept = await bestEffortCleanup('rollback retained tree', () =>
        fs.promises.rm(rolling, { recursive: true, force: true })
      )
      if (swept) clearPublishJournal(appId)
      // Cosmetic and therefore last, as in install and update: a failed icon may not
      // undo a committed rollback.
      await applyPackagedIcon(appId, installPath, previous).catch((error) =>
        logger.warn('Rolled back without a packaged icon', { appId, error })
      )
      // Same reason as apply: the rolled-back version is the installed one now, and the
      // next check is what decides whether a newer one exists.
      application.get('MiniAppRuntimeService').noteUpdateAvailable(appId, null)
      logger.warn('Rolled mini app back to its previous version', { appId, version: previous.version })
      miniAppActivityLog.recordGrant(appId, { name: 'rollback', version: previous.version })
      notifyDataApiDataChange([{ endpoint: '/mini-apps', kind: 'projection' }])
    })
  )
}

/**
 * Fetches and VALIDATES — it neither installs nor registers. The ledger lives in
 * `installFlow.ts` (`previewUrlForInstall` wraps this and registers there); keeping
 * this module ledger-free keeps the import direction one-way: installFlow → webInstaller.
 */
export async function previewMiniAppUrl(manifestUrl: string): Promise<{
  manifestUrl: string
  /** The one or two pinned origins, canonical first — see `declaredOrigins`. */
  origins: string[]
  /** The DISTRIBUTION manifest: the confirm branch reads `package` off it. */
  manifest: MiniAppDistributionManifest
  /** The card's icon, when the manifest points at one and it verifies; `null` renders the placeholder. */
  iconDataUrl: string | null
}> {
  // ONE address, as typed: the user enters whichever mirror they can reach, and the
  // manifest itself carries the pair every later fetch chooses between.
  const { url: resolvedUrl, manifest } = await fetchManifestAt(manifestUrl)
  const origins = declaredOrigins(manifest)
  // The host that served the manifest must be one the manifest declares, or a host merely
  // relaying someone else's manifest could pin an official-looking origin.
  if (!origins.includes(new URL(resolvedUrl).origin)) {
    throw new Error(`Mini app ${manifest.id} declares updates from a different origin`)
  }
  if (!manifest.package) throw new Error(`Mini app manifest for ${manifest.id} declares no package url/hash`)
  assertPackageOrigins(manifest, origins)

  return { manifestUrl: resolvedUrl, origins, manifest, iconDataUrl: await previewIcon(manifest, origins) }
}

/**
 * The address as typed first, then the conventional file inside it. `https://foo/bar` is
 * usually a directory — often one that redirects to `bar/`, which `redirect: 'error'`
 * refuses — and the file may be called anything. Same origin either way, so the pin
 * below holds for whichever one answered. Both failing names both addresses: a user
 * cannot act on an error about a fallback they never typed.
 */
async function fetchManifestAt(manifestUrl: string): Promise<{ url: string; manifest: MiniAppDistributionManifest }> {
  const typed = assertHttps(manifestUrl)
  const candidates = [manifestUrl]
  if (!typed.pathname.endsWith('/manifest.json')) {
    const inside = new URL(typed)
    inside.pathname = `${typed.pathname.replace(/\/+$/, '')}/manifest.json`
    candidates.push(inside.href)
  }
  let lastError: unknown
  for (const url of candidates) {
    try {
      return { url, manifest: await fetchManifest([url]) }
    } catch (error) {
      lastError = error
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  if (candidates.length === 1) throw new Error(reason)
  throw new Error(`Neither ${candidates[0]} nor ${candidates[1]} is a mini app manifest: ${reason}`)
}

/**
 * Decoration, not a gate: an icon that cannot be fetched or does not verify hides itself
 * and the card goes on with its placeholder — the install decision does not rest on it.
 */
async function previewIcon(manifest: MiniAppDistributionManifest, origins: readonly string[]): Promise<string | null> {
  if (!manifest.package.iconUrl || !manifest.icon) return null
  try {
    const bytes = await assertSupportedIconBytes(
      await fetchIcon(manifest.package.iconUrl, { sha256: manifest.icon.sha256, origins })
    )
    // The SAME pipeline the file preview uses (128x128 webp, bomb-guarded).
    return `data:image/webp;base64,${(await transcodeToEntityWebp(bytes)).toString('base64')}`
  } catch (error) {
    logger.warn('Mini app icon unavailable for the consent card', { id: manifest.id, error })
    return null
  }
}

/**
 * The `url` branch of `confirmPendingInstall` — consumes the reviewed snapshot the
 * ledger held, never re-fetches the manifest. `assertManifestMatchesReviewed` below is
 * this source's manifest-equality invariant (design §10.2), field-wise because the
 * packaged copy legitimately lacks `package`.
 */
export async function installFromUrlConfirmed(
  review: {
    manifestUrl: string
    origins: string[]
    distribution: MiniAppDistributionManifest
  },
  grants: InstallGrantOptions = {},
  reinstall?: ReinstallOptions
): Promise<LocalMiniApp> {
  const { distribution: remote, origins, manifestUrl } = review
  const downloaded = await fetchPackage(await mirrorOrder(remote.package.url, remote.package.urlCn), {
    sha256: remote.package.sha256,
    size: remote.package.size,
    origins
  })
  // The download is guarded the moment it exists: `createStagingDir` failing between
  // the fetch and an inner try would otherwise strand the temp file for good.
  try {
    const staging = await createStagingDir()
    try {
      const manifest = await extractMiniAppArchive(downloaded.path, staging)
      assertManifestMatchesReviewed(remote, manifest)
      return await installExtracted(
        manifest,
        staging,
        {
          source: 'url',
          // PROVENANCE, not the update endpoint — that is read fresh from `manifestJson`
          // every check. A second copy here would need a `previousSourceUrl` to undo.
          sourceUrl: manifestUrl,
          sourceOrigin: origins[0],
          sourceOriginCn: origins[1]
        },
        grants,
        reinstall
      )
    } finally {
      await bestEffortCleanup('url-install staging', () => fs.promises.rm(staging, { recursive: true, force: true }))
    }
  } finally {
    // Same policy one frame out: `cleanup()` itself may reject, and a committed
    // install must not come back to the caller as a failure because of it.
    await bestEffortCleanup('install download', () => downloaded.cleanup())
  }
}
