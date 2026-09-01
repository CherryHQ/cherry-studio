import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { miniAppTable } from '@data/db/schemas/miniApp'
import { transcodeToEntityWebp } from '@main/utils/image'
import type { LocalMiniApp } from '@shared/data/types/miniApp'
import type { WindowId } from '@shared/ipc/types'
import type { MiniAppDistributionManifest } from '@shared/types/miniAppManifest'
import { declaredGrants, type MiniAppManifest, MiniAppManifestSchema } from '@shared/types/miniAppManifest'
import { eq } from 'drizzle-orm'
import { eq as semverEq, gt as semverGt } from 'semver'

import { miniAppBuiltinPath } from '../paths'
import { previewMiniAppArchive, sha256File } from './archive'
import { stageBuiltinMiniApp } from './builtin'
import { bestEffortCleanup } from './cleanup'
import { assertSupportedIconBytes } from './icon'
import {
  assertOfficialNamespace,
  installationOf,
  installExtracted,
  type InstallGrantOptions,
  type MiniAppInstallSourceInfo,
  type ReinstallOptions,
  stageMiniAppFromFile
} from './installer'
import {
  installFromUrlConfirmed,
  previewMiniAppUrl,
  reviewUpgradeOverInstalled,
  type UpdateStatus
} from './webInstaller'

const REVIEW_TTL_MS = 10 * 60_000

/**
 * What each source needs to re-derive the package at confirm time. Task 27 adds
 * `{ kind: 'url', … }`, Task 28A adds `{ kind: 'builtin', … }` — same discriminated
 * shape as the update flow's `ReviewedUpdate` payload.
 */
export type PendingInstallPayload =
  | { kind: 'file'; zipPath: string; zipSha256: string }
  | { kind: 'url'; manifestUrl: string; origins: string[]; distribution: MiniAppDistributionManifest }
  | { kind: 'builtin'; appId: string }

export interface PendingInstall {
  installToken: string
  ownerId: WindowId
  /** What the consent card showed. Confirm re-derives from the source and must match. */
  manifest: MiniAppManifest
  payload: PendingInstallPayload
  /** The card said "already installed at this version": confirm must be a reinstall of exactly that. */
  installed?: { version: string }
  expiresAt: number
}

type MiniAppSource = MiniAppInstallSourceInfo['source']

/** The app already there, as the card describes it. */
export interface InstalledAppSummary {
  version: string
  source: MiniAppSource
}

/**
 * The card's input. Which of the two it is was decided by VERSION: a higher one is the
 * update flow (token, diffed grants, snapshot); the same or a lower one is a reinstall
 * behind the ordinary consent card, with the "already installed" facts alongside.
 */
export type InstallPreviewSummary =
  | {
      kind: 'install'
      installToken: string
      manifest: MiniAppManifest
      iconDataUrl: string | null
      required: string[]
      optional: string[]
      /** Where THIS package comes from — the card names a source change next to `installed.source`. */
      source: MiniAppSource
      installed?: InstalledAppSummary & { relation: 'same' | 'downgrade' }
    }
  | {
      kind: 'upgrade'
      appId: string
      manifest: MiniAppManifest
      iconDataUrl: string | null
      source: MiniAppSource
      installed: InstalledAppSummary
      update: Exclude<UpdateStatus, { status: 'current' }>
    }

type Placement = { relation: 'fresh' } | { relation: 'upgrade' | 'same' | 'downgrade'; installed: InstalledAppSummary }

/**
 * Where a package lands relative to what is installed. A `site` row under the same id
 * is refused outright: it is not an app and nothing about it can be "reinstalled".
 */
function placementOf(manifest: MiniAppManifest): Placement {
  const [app] = application
    .get('DbService')
    .getDb()
    .select({ kind: miniAppTable.kind })
    .from(miniAppTable)
    .where(eq(miniAppTable.appId, manifest.id))
    .all()
  if (!app) return { relation: 'fresh' }
  if (app.kind !== 'app') throw new Error(`"${manifest.id}" is already used by a website entry`)
  const row = installationOf(manifest.id)
  const installed = { version: row.version, source: row.source }
  if (semverGt(manifest.version, row.version)) return { relation: 'upgrade', installed }
  return { relation: semverEq(manifest.version, row.version) ? 'same' : 'downgrade', installed }
}

/** The common tail of every preview once the source-specific read is done. */
function summarize(
  input: {
    ownerId: WindowId
    claim: string
    manifest: MiniAppManifest & { package?: MiniAppDistributionManifest['package'] }
    iconDataUrl: string | null
    payload: PendingInstallPayload
    repin: MiniAppInstallSourceInfo
    /** How the update flow re-derives the bytes at apply — only built when it is an upgrade. */
    upgradePayload: () => Promise<Parameters<typeof reviewUpgradeOverInstalled>[2]>
  },
  placement: Placement
): Promise<InstallPreviewSummary> {
  const { ownerId, claim, manifest, iconDataUrl, payload, repin } = input
  if (placement.relation === 'upgrade') {
    return (async () => {
      // The namespace rule the install path enforces, applied to the source being pinned.
      assertOfficialNamespace(manifest.id, repin.source, repin.sourceOrigin, repin.sourceOriginCn)
      const upgradePayload = await input.upgradePayload()
      // The newest preview still wins, even though no install token is minted here.
      miniAppInstallConsentService.assertLive(ownerId, claim)
      const update = reviewUpgradeOverInstalled(manifest.id, manifest, upgradePayload, repin)
      if (update.status === 'current') throw new Error(`Mini app ${manifest.id} reviewed as current while newer`)
      return {
        kind: 'upgrade',
        appId: manifest.id,
        manifest,
        iconDataUrl,
        source: repin.source,
        installed: placement.installed,
        update
      }
    })()
  }
  const installed =
    placement.relation === 'fresh' ? undefined : { ...placement.installed, relation: placement.relation }
  const installToken = registerPending(
    { ownerId, manifest, payload, ...(installed ? { installed: { version: installed.version } } : {}) },
    claim
  )
  const { required, optional } = declaredGrants(manifest)
  return Promise.resolve({
    kind: 'install',
    installToken,
    manifest,
    iconDataUrl,
    required,
    optional,
    source: repin.source,
    installed
  })
}

/**
 * The pending-consent ledger. PURE MEMORY — entries are a few KB of names and hashes;
 * the package bytes stay where they already live — but memory retained ACROSS CALLS is
 * still state, so Naming Conventions §5.2 applies: a class managed as a singleton, in
 * the direct-import form (no long-lived resources, no persistent side effects — the
 * lifecycle-decision-guide's criteria for skipping BaseService).
 */
class MiniAppInstallConsentService {
  private readonly pending = new Map<string, PendingInstall>()
  /** IN-FLIGHT preview claims — at most one per window, empty at rest (see endPreview). */
  private readonly liveClaims = new Map<WindowId, string>()

  /**
   * Claim the OWNER'S newest-preview slot at request START, before any slow work.
   * Registration is then ordered by intent, not by completion: an old preview that
   * settles late loses to this guard instead of evicting the token a newer panel is
   * already showing. A UUID, not a counter: `endPreview` deletes entries, and a counter
   * restarting at 1 would let a still-unsettled old request impersonate a fresh one.
   */
  beginPreview(ownerId: WindowId): string {
    const claim = crypto.randomUUID()
    this.liveClaims.set(ownerId, claim)
    return claim
  }

  /**
   * Release at settle — every preview flow calls this in `finally`. Conditional, so an
   * old request cannot clear a newer claim; because every path settles, the map holds
   * only in-flight previews and window churn accumulates nothing.
   */
  endPreview(ownerId: WindowId, claim: string): void {
    if (this.liveClaims.get(ownerId) === claim) this.liveClaims.delete(ownerId)
  }

  assertLive(ownerId: WindowId, claim: string): void {
    if (claim !== this.liveClaims.get(ownerId)) throw new Error('Preview superseded by a newer one')
  }

  register(input: Omit<PendingInstall, 'installToken' | 'expiresAt'>, claim: string): string {
    this.assertLive(input.ownerId, claim)
    const now = Date.now()
    for (const [token, entry] of this.pending) if (entry.expiresAt <= now) this.pending.delete(token)
    // One pending consent per window: a second preview replaces the first.
    for (const [token, entry] of this.pending) if (entry.ownerId === input.ownerId) this.pending.delete(token)
    const installToken = crypto.randomUUID()
    this.pending.set(installToken, { ...input, installToken, expiresAt: now + REVIEW_TTL_MS })
    return installToken
  }

  take(installToken: string, ownerId: WindowId | null): PendingInstall {
    const entry = this.pending.get(installToken)
    // One refusal for missing, expired and foreign alike — an error that distinguishes
    // "someone else's token" confirms to a prober that the token exists.
    if (!entry || entry.ownerId !== ownerId) throw new Error('Unknown or expired preview')
    this.pending.delete(installToken)
    // Enforced at CONSUMPTION — the lazy sweep in `register` only saves memory.
    if (entry.expiresAt <= Date.now()) throw new Error('Unknown or expired preview')
    return entry
  }

  /** Idempotent: the late-response compensation may race TTL expiry. */
  cancel(installToken: string, ownerId: WindowId | null): void {
    const entry = this.pending.get(installToken)
    if (entry && entry.ownerId === ownerId) this.pending.delete(installToken)
  }
}

export const miniAppInstallConsentService = new MiniAppInstallConsentService()

/** Function-shaped API for the flows and the later kinds. */
export const registerPending = (input: Omit<PendingInstall, 'installToken' | 'expiresAt'>, claim: string): string =>
  miniAppInstallConsentService.register(input, claim)
export const cancelPending = (installToken: string, ownerId: WindowId | null): void =>
  miniAppInstallConsentService.cancel(installToken, ownerId)

/** The file flow's preview half. Refuses a null owner BEFORE any source read. */
export async function previewFileForInstall(zipPath: string, ownerId: WindowId | null): Promise<InstallPreviewSummary> {
  if (ownerId === null) throw new Error('Mini app previews require a managed window caller')
  // BEFORE the slow read: settling order must not decide which preview registers.
  const claim = miniAppInstallConsentService.beginPreview(ownerId)
  try {
    const { manifest, iconDataUrl, sha256 } = await previewMiniAppArchive(zipPath)
    return await summarize(
      {
        ownerId,
        claim,
        manifest,
        iconDataUrl,
        payload: { kind: 'file', zipPath, zipSha256: sha256 },
        repin: { source: 'file' },
        // The update flow pins the TREE hash, not the file hash, so an upgrade has to
        // extract once here. The tree is dropped again: apply re-extracts and re-hashes.
        upgradePayload: async () => {
          const staged = await stageMiniAppFromFile(zipPath)
          await bestEffortCleanup('upgrade preview staging', () =>
            fs.promises.rm(staged.stagingDir, { recursive: true, force: true })
          )
          assertManifestUnchanged(staged.manifest, manifest)
          return { kind: 'file', zipPath, contentHash: staged.contentHash }
        }
      },
      placementOf(manifest)
    )
  } finally {
    miniAppInstallConsentService.endPreview(ownerId, claim)
  }
}

/** The url flow's preview half: webInstaller validates, the ledger binds it to a window. */
export async function previewUrlForInstall(
  manifestUrl: string,
  ownerId: WindowId | null
): Promise<InstallPreviewSummary> {
  if (ownerId === null) throw new Error('Mini app previews require a managed window caller')
  // BEFORE the network round-trip — the slowest source is where late-settling bites.
  const claim = miniAppInstallConsentService.beginPreview(ownerId)
  try {
    // `answered`, not the address typed: a manifest without `update.url` is checked at
    // `sourceUrl` later, and the typed address may be the directory that just 404'd.
    const { manifestUrl: answered, origins, manifest, iconDataUrl } = await previewMiniAppUrl(manifestUrl)
    return await summarize(
      {
        ownerId,
        claim,
        manifest,
        iconDataUrl,
        payload: { kind: 'url', manifestUrl: answered, origins, distribution: manifest },
        // PROVENANCE, as `installFromUrlConfirmed` records it: the address that answered, the origins declared.
        repin: { source: 'url', sourceUrl: answered, sourceOrigin: origins[0], sourceOriginCn: origins[1] },
        upgradePayload: async () => ({ kind: 'url', origins })
      },
      placementOf(manifest)
    )
  } finally {
    miniAppInstallConsentService.endPreview(ownerId, claim)
  }
}

/**
 * The builtin preview entry: the same null-owner-first refusal as the file flow, then
 * a straight READ of the shipped tree — no copy, no staging (design §10.2; the tree is
 * code-signed read-only, so there is nothing a hash would need to pin). The IPC
 * handler stays a one-line delegation to this.
 */
export async function previewBuiltinForInstall(
  appId: string,
  ownerId: WindowId | null
): Promise<InstallPreviewSummary> {
  if (ownerId === null) throw new Error('Mini app previews require a managed window caller')
  // Fast local reads, same guard anyway: one ordering rule for all three sources.
  const claim = miniAppInstallConsentService.beginPreview(ownerId)
  try {
    const root = miniAppBuiltinPath(appId)
    const manifest = MiniAppManifestSchema.parse(
      JSON.parse(await fs.promises.readFile(path.join(root, 'manifest.json'), 'utf8'))
    )
    if (manifest.id !== appId) throw new Error(`Builtin tree for ${appId} declares id ${manifest.id}`)
    // The SAME pipeline the other two preview sources use. Base64ing the raw file under an
    // `image/webp` label is a lie whenever the tree ships a PNG, and this was the one of the
    // three that skipped it. Trusted bytes do not make a wrong MIME type right, and
    // `transcodeToEntityWebp` is what bounds the decode.
    const iconDataUrl = manifest.icon
      ? `data:image/webp;base64,${(
          await transcodeToEntityWebp(
            await assertSupportedIconBytes(await fs.promises.readFile(path.join(root, manifest.icon.path)))
          )
        ).toString('base64')}`
      : null
    return await summarize(
      {
        ownerId,
        claim,
        manifest,
        iconDataUrl,
        payload: { kind: 'builtin', appId },
        repin: { source: 'builtin' },
        upgradePayload: async () => ({ kind: 'builtin', root })
      },
      placementOf(manifest)
    )
  } finally {
    miniAppInstallConsentService.endPreview(ownerId, claim)
  }
}

export async function confirmPendingInstall(
  installToken: string,
  ownerId: WindowId | null,
  grantedOptional?: readonly string[],
  reinstall?: ReinstallOptions
): Promise<LocalMiniApp> {
  const entry = miniAppInstallConsentService.take(installToken, ownerId)
  // The card said "already installed"; a confirm that does not answer it is a stale
  // client, not a fresh install — and the installed version must still be the one shown.
  if (entry.installed) {
    if (!reinstall) {
      throw new Error(`Mini app ${entry.manifest.id} is already installed; confirm it as a reinstall`)
    }
    const placement = placementOf(entry.manifest)
    if (placement.relation === 'fresh' || placement.installed.version !== entry.installed.version) {
      throw new Error(`Mini app ${entry.manifest.id} changed since the preview; preview it again`)
    }
  }
  const replace = entry.installed ? reinstall : undefined
  const grants = { grantedOptional }
  switch (entry.payload.kind) {
    case 'file':
      return confirmFromFile(entry.manifest, entry.payload, grants, replace)
    case 'url':
      return installFromUrlConfirmed(entry.payload, grants, replace)
    case 'builtin': {
      const staged = await stageBuiltinMiniApp(entry.payload.appId)
      try {
        assertManifestUnchanged(staged.manifest, entry.manifest)
        return await installExtracted(staged.manifest, staged.stagingDir, { source: 'builtin' }, grants, replace)
      } finally {
        await bestEffortCleanup('builtin confirm staging', () =>
          fs.promises.rm(staged.stagingDir, { recursive: true, force: true })
        )
      }
    }
  }
}

async function confirmFromFile(
  consented: MiniAppManifest,
  payload: { zipPath: string; zipSha256: string },
  grants: InstallGrantOptions,
  reinstall?: ReinstallOptions
): Promise<LocalMiniApp> {
  // HONESTY gate: the user's file changed since the card was shown — say so, plainly,
  // never install silently past it (design §10.2).
  //
  // Reading the path AGAIN below is reported as a TOCTOU every review round, and the answer
  // is `assertManifestUnchanged` — read its doc before acting on such a report. It compares
  // the EXTRACTED manifest, so the envelope is verified against the bytes that get installed,
  // not against the ones that were hashed here. A swap inside the window is therefore either
  // refused there or carries the identical envelope, and what is left is a different
  // implementation inside a capability set the user did consent to — placed by something
  // already executing as the user, which owns this process and any private copy it could
  // make. Sealing the archive first moves the bytes to a path with the same owner and the
  // same permissions: it narrows a window without raising a bar, and it costs this plain
  // error, silently installing stale bytes whenever the swap lands after the copy.
  if ((await sha256File(payload.zipPath)) !== payload.zipSha256) {
    throw new Error('Package file changed since preview; pick it again')
  }
  const staged = await stageMiniAppFromFile(payload.zipPath)
  try {
    assertManifestUnchanged(staged.manifest, consented)
    return await installExtracted(staged.manifest, staged.stagingDir, { source: 'file' }, grants, reinstall)
  } finally {
    await bestEffortCleanup('confirm staging', () =>
      fs.promises.rm(staged.stagingDir, { recursive: true, force: true })
    )
  }
}

/**
 * The SECURITY invariant (design §10.2): the envelope granted is byte-for-byte the one
 * consented to. This closes the hash-to-extract window — a file swapped inside it
 * either differs here and is refused, or carries the identical envelope the sandbox
 * was going to enforce anyway.
 */
export function assertManifestUnchanged(extracted: MiniAppManifest, consented: MiniAppManifest): void {
  if (JSON.stringify(extracted) !== JSON.stringify(consented)) {
    throw new Error('Package file changed since preview; pick it again')
  }
}
