/**
 * Agent-authored MiniApp previews (issue #21646, stage 2): an isolated run of a
 * validated `.miniapp` package through the REAL protocol, CSP, bridge and network
 * policy, without touching the install table.
 *
 * Isolation is structural, not promised:
 *
 *   - The runtime identifier is `preview-<previewId>`, so the Electron partition
 *     (`persist:miniapp:preview-<id>`), protocol host and network policy never
 *     overlap an installed app's — the runtime service resolves install paths for
 *     these ids from THIS registry, and a closed preview stops resolving the moment
 *     it leaves the map.
 *   - The unpacked tree lives under `feature.mini_app.previews/<previewId>`, a root
 *     the startup sweep empties wholesale. Nothing about a preview survives a
 *     restart: the registry is in memory, the partition storage is cleared on close,
 *     and the tree is temporary by contract.
 *   - Every preview belongs to ONE chat session. Another session cannot read, close
 *     or replace it, and session teardown invalidates both the previews and the
 *     artifact tokens that created them.
 *
 * On the `preview-` namespace: an installed appId CAN textually match that prefix
 * (`preview-foo` is schema-legal). The registry is consulted FIRST for live previews,
 * and a previewId carries 122 bits of `randomUUID`, so an installed app colliding
 * with a live preview would have to name itself after that exact random id during
 * the preview's lifetime — through the user's own install consent card.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { declaredGrantKeys, type MiniAppManifest } from '@shared/types/miniAppManifest'

import { clearPreviewStores } from '../capabilities/previewStores'
import { extractMiniAppArchive, sha256File } from '../install/archive'
import { bestEffortCleanup } from '../install/cleanup'
import { miniAppPreviewPath, miniAppPreviewsRoot } from '../paths'
import { clearMiniAppPartition } from '../runtime/partition'
import { expectArtifactToken, revokeSessionArtifactTokens } from './artifactTokens'
import { resetSessionRepairRounds } from './repairRounds'

const logger = loggerService.withContext('MiniAppPreviewService')

export const MINI_APP_PREVIEW_RUNTIME_PREFIX = 'preview-'

export function previewRuntimeId(previewId: string): string {
  return `${MINI_APP_PREVIEW_RUNTIME_PREFIX}${previewId}`
}

export interface MiniAppPreview {
  readonly previewId: string
  /** The id the partition, protocol host and webContents map know this run by. */
  readonly runtimeId: string
  readonly sessionId: string
  /** The manifest's own `id` — kept so the preview reports the app's real identity. */
  readonly appId: string
  readonly version: string
  /** Absolute path of the unpacked tree, under the previews root. */
  readonly dir: string
  /** Digest of the package bytes at open time — install (stage 3) re-checks it. */
  /** Manifest `entry` (package-relative); the pane navigates here, not to a fixed index.html. */
  readonly entry: string
  /**
   * The preview's grants: the manifest's full DECLARED set, held in memory for the
   * preview's life. A preview exists so its author can exercise the capabilities the
   * app declares (AC3) — there is no consent UI behind it and no DB row to grant
   * from, so the declared set IS the grant set, and it dies with the preview.
   */
  readonly grants: string[]
  /** The manifest's `network` allowlist — the bridge's host gate has no DB row to read. */
  readonly networkHosts: string[]
  readonly packageSha256: string
  readonly packagePath: string
  readonly openedAt: number
}

/** What the host tools and the renderer preview pane read back. */
export interface MiniAppPreviewSummary {
  previewId: string
  runtimeId: string
  sessionId: string
  appId: string
  version: string
  /** Package-relative entry page from the manifest — NOT always `index.html`. */
  entry: string
  packageSha256: string
  openedAt: number
}

export type MiniAppPreviewErrorCode = 'unknown-preview' | 'session-mismatch' | 'package-changed'

export class MiniAppPreviewError extends Error {
  constructor(
    readonly code: MiniAppPreviewErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'MiniAppPreviewError'
  }
}

function summaryOf(preview: MiniAppPreview): MiniAppPreviewSummary {
  return {
    previewId: preview.previewId,
    runtimeId: preview.runtimeId,
    sessionId: preview.sessionId,
    appId: preview.appId,
    version: preview.version,
    entry: preview.entry,
    packageSha256: preview.packageSha256,
    openedAt: preview.openedAt
  }
}

/**
 * Abandoned previews have no live registry entry BY DEFINITION — the registry is in
 * memory — so the sweep does not consult it: at startup, everything under the root
 * is a leftover. Mirrors `sweepAbandonedStaging` for the install flow.
 */
export async function sweepAbandonedPreviews(): Promise<number> {
  const root = miniAppPreviewsRoot()
  if (!fs.existsSync(root)) return 0
  const leftovers = await fs.promises.readdir(root)
  let removed = 0
  for (const name of leftovers) {
    // Per-directory: one undeletable leftover must not shield every other one.
    if (
      await bestEffortCleanup(`stale preview ${name}`, () =>
        fs.promises.rm(path.join(root, name), { recursive: true, force: true })
      )
    ) {
      removed += 1
    }
  }
  if (leftovers.length > 0) {
    logger.info('Swept abandoned mini app previews', { removed, failed: leftovers.length - removed })
  }
  return removed
}

@Injectable('MiniAppPreviewService')
@ServicePhase(Phase.WhenReady)
export class MiniAppPreviewService extends BaseService {
  private readonly previews = new Map<string, MiniAppPreview>()
  /** One mutation at a time per session: opens and session teardowns queue here. */
  private readonly sessionMutations = new Map<string, Promise<unknown>>()

  protected async onReady(): Promise<void> {
    // Before anything agent-driven can run: previews are opened only through this
    // service, so sweeping here means no live preview can ever meet the broom.
    await sweepAbandonedPreviews()
  }

  /**
   * Open a validated package as a preview. The artifact token proves the session
   * validated THESE bytes; the package is re-hashed here so a swap after `validate`
   * is a hard refusal, not a stale run.
   *
   * One preview per session: opening replaces. The old run is closed FIRST — its
   * guests evicted, its partition cleared, its tree removed — so two runs of a
   * session never coexist, and the replaced preview's control targets die before
   * the new ones exist.
   */
  async openPreview(input: { sessionId: string; artifactToken: string }): Promise<MiniAppPreviewSummary> {
    // Serialized with every other mutation of this session: two opens racing
    // would double-register, and a teardown racing an open must not return
    // before the pending open registers — it queues BEHIND it and closes the
    // result, so no preview outlives its session's teardown.
    return this.enqueueSessionMutation(input.sessionId, () => this.openPreviewSerialized(input))
  }

  private async openPreviewSerialized(input: {
    sessionId: string
    artifactToken: string
  }): Promise<MiniAppPreviewSummary> {
    const record = expectArtifactToken(input.artifactToken, input.sessionId)
    const previewId = randomUUID()

    // Digest re-check at the point of use (AC5), TOCTOU-safe: the package is
    // copied to a private snapshot FIRST and only the snapshot is hashed and
    // extracted. Re-hashing the live path and then reopening it for extraction
    // would let a rebuild between the two reads slide different bytes under a
    // validated digest; the snapshot is immutable from copyFile onward, so the
    // extracted bytes are exactly the hashed bytes, and only an exact match opens.
    await fs.promises.mkdir(miniAppPreviewsRoot(), { recursive: true })
    const snapshotPath = path.join(miniAppPreviewsRoot(), `staging-${previewId}`)
    let manifest: MiniAppManifest
    let replaced: MiniAppPreview[] = []
    try {
      await fs.promises.copyFile(record.packagePath, snapshotPath)
      const sha256 = await sha256File(snapshotPath)
      if (sha256 !== record.sha256) {
        throw new MiniAppPreviewError(
          'package-changed',
          'The package changed since it was validated; run validate again to preview it'
        )
      }

      replaced = [...this.previews.values()].filter((p) => p.sessionId === input.sessionId)
      for (const preview of replaced) {
        await this.closePreview(preview.previewId)
      }

      const dir = miniAppPreviewPath(previewId)
      try {
        manifest = await extractMiniAppArchive(snapshotPath, dir)
      } catch (error) {
        // extractMiniAppArchive resets the tree it half-wrote; what remains is the
        // empty directory it leaves behind, which must not wait for the next sweep.
        await bestEffortCleanup(`failed preview ${previewId}`, () =>
          fs.promises.rm(dir, { recursive: true, force: true })
        )
        throw error
      }

      const preview: MiniAppPreview = {
        previewId,
        runtimeId: previewRuntimeId(previewId),
        sessionId: input.sessionId,
        appId: manifest.id,
        version: manifest.version,
        entry: manifest.entry,
        grants: declaredGrantKeys(manifest),
        networkHosts: [...manifest.network],
        dir,
        packageSha256: record.sha256,
        packagePath: record.packagePath,
        openedAt: Date.now()
      }
      this.previews.set(previewId, preview)
      logger.info('Opened mini app preview', {
        previewId,
        sessionId: input.sessionId,
        appId: manifest.id,
        replaced: replaced.length
      })
      return summaryOf(preview)
    } finally {
      // The snapshot's only job was to pin the extracted bytes; once the open
      // settled (either way), it is a leftover the sweep should never meet.
      await bestEffortCleanup(`preview staging ${previewId}`, () => fs.promises.rm(snapshotPath, { force: true }))
    }
  }

  /**
   * Close one preview: cancel its in-flight world and release its resources.
   *
   * Order is the security property: the registry entry goes FIRST, so the protocol
   * handler stops resolving the tree immediately and no late request can re-enter;
   * guests are evicted and partition storage cleared SECOND; the tree is removed
   * LAST. Idempotent — closing an already-closed preview is a no-op, because the
   * renderer's unmount and the session's teardown can race each other legitimately.
   */
  async closePreview(previewId: string, sessionId?: string): Promise<void> {
    const preview = this.previews.get(previewId)
    if (!preview) return
    if (sessionId !== undefined && preview.sessionId !== sessionId) {
      throw new MiniAppPreviewError('session-mismatch', 'Preview belongs to a different session')
    }
    this.previews.delete(previewId)
    // The preview's storage and file state dies with it — in memory, so one delete
    // is the whole cleanup; a restarted process has no state to sweep at all.
    clearPreviewStores(preview.runtimeId)

    const runtime = application.get('MiniAppRuntimeService')
    if (runtime.isPartitionReady(preview.runtimeId)) {
      await runtime.withAppQuiesced(preview.runtimeId, async () => {
        // Guests are gone for the whole clear (the quiesce vetoes re-attach):
        // `clearMiniAppPartition`'s contract. The preview never runs again, and its
        // cookies and cache must not survive into the next preview of anything.
        await clearMiniAppPartition(preview.runtimeId)
      })
    }
    await bestEffortCleanup(`preview ${previewId}`, () => fs.promises.rm(preview.dir, { recursive: true, force: true }))
    logger.info('Closed mini app preview', { previewId })
  }

  /**
   * Session teardown (close, replace or exit): every preview the session owned goes
   * away, and every artifact token it validated is revoked. One call, both halves —
   * a token outliving its session's previews would preview into nothing.
   */
  async closeSessionPreviews(sessionId: string): Promise<{ closed: number; tokensRevoked: number }> {
    // Same queue as openPreview: a teardown that lands while an open is still
    // extracting waits for it, then closes what it registered — a pending open
    // can never slip a live preview past a completed teardown.
    return this.enqueueSessionMutation(sessionId, () => this.closeSessionPreviewsSerialized(sessionId))
  }

  private async closeSessionPreviewsSerialized(sessionId: string): Promise<{ closed: number; tokensRevoked: number }> {
    const owned = [...this.previews.values()].filter((p) => p.sessionId === sessionId)
    for (const preview of owned) {
      await this.closePreview(preview.previewId)
    }
    const tokensRevoked = revokeSessionArtifactTokens(sessionId)
    // Repair rounds are session state too (AC9): a closed session's capped
    // artifacts must not haunt a future session that reuses the same paths.
    resetSessionRepairRounds(sessionId)
    if (owned.length > 0 || tokensRevoked > 0) {
      logger.info('Closed session previews', { sessionId, closed: owned.length, tokensRevoked })
    }
    return { closed: owned.length, tokensRevoked }
  }

  /**
   * Promise-chain mutex keyed by session. The chain entry is removed only when
   * it is still the tail, so a later mutation is never orphaned from the map.
   */
  private enqueueSessionMutation<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const prior = this.sessionMutations.get(sessionId) ?? Promise.resolve()
    const run = prior.catch(() => {}).then(work)
    this.sessionMutations.set(sessionId, run)
    // `finally` RE-THROWS into its own promise — swallow that copy or a rejected
    // mutation is an unhandled rejection; the caller still gets the real one.
    void run
      .finally(() => {
        if (this.sessionMutations.get(sessionId) === run) {
          this.sessionMutations.delete(sessionId)
        }
      })
      .catch(() => {})
    return run
  }

  /**
   * Look up a live preview by the runtime id its guests present. The bridge's grant,
   * manifest and version lookups resolve through this (a preview has no installation
   * row BY DESIGN); `undefined` for a closed or never-preview id, which is the
   * invalidation — callers fall through to the installed-app backends.
   */
  getPreviewByRuntimeId(runtimeId: string): MiniAppPreview | undefined {
    return [...this.previews.values()].find((p) => p.runtimeId === runtimeId)
  }

  getPreview(previewId: string): MiniAppPreviewSummary | undefined {
    const preview = this.previews.get(previewId)
    return preview ? summaryOf(preview) : undefined
  }

  listSessionPreviews(sessionId: string): MiniAppPreviewSummary[] {
    return [...this.previews.values()].filter((p) => p.sessionId === sessionId).map(summaryOf)
  }

  /** True only while the preview is live — the browser tool's gate for in-flight calls. */
  isPreviewActive(previewId: string): boolean {
    return this.previews.has(previewId)
  }

  /**
   * The runtime service's install-path resolver calls this for `preview-` ids. A
   * closed preview resolves to NOTHING — the protocol handler turns that into the
   * 404 every response of this scheme carries CSP on.
   */
  resolvePreviewPath(runtimeId: string): string | undefined {
    for (const preview of this.previews.values()) {
      if (preview.runtimeId === runtimeId) return preview.dir
    }
    return undefined
  }
}
