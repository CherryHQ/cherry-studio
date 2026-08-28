/**
 * Declared (manifest) vs granted (DB) — kept apart on purpose.
 *
 * "Did this update widen permissions?" is the diff between the two, and a merged
 * representation cannot express it. Network HOSTS are deliberately absent: a host is the
 * scope of the network permission, not a permission of its own (design §7).
 */

import { application } from '@application'
import { miniAppGrantTable } from '@data/db/schemas/miniApp'
import type { DbOrTx } from '@data/db/types'
import {
  declaredGrantKeys,
  declaredGrants,
  MINI_APP_METHODS,
  type MiniAppManifest,
  type MiniAppMethod
} from '@shared/types/miniAppManifest'
import { and, eq } from 'drizzle-orm'

export class PermissionDeniedError extends Error {
  /** `reason` replaces the default text for refusals that are not about the grant — a URL outside the allowlist is the case. */
  constructor(
    readonly appId: string,
    readonly permission: string,
    reason?: string
  ) {
    super(reason ?? `Mini app "${appId}" is not granted "${permission}"`)
    this.name = 'PermissionDeniedError'
  }
}

export function listGrantsTx(tx: DbOrTx, appId: string): string[] {
  return tx
    .select()
    .from(miniAppGrantTable)
    .where(eq(miniAppGrantTable.appId, appId))
    .all()
    .map((r: { permission: string }) => r.permission)
    .sort()
}

export function listGrants(appId: string): string[] {
  return listGrantsTx(application.get('DbService').getDb(), appId)
}

/**
 * Transaction-taking core. The installer commits the mini app row, the installation
 * row and the initial grants in ONE transaction: a partial commit leaves an
 * installed app with no permissions and no way to notice, and rolling grants back
 * after the fact means writing compensation code for a case the database can just
 * prevent.
 */
export function grantMiniAppPermissionsTx(tx: DbOrTx, appId: string, keys: string[], version: string): void {
  const existing = new Set(listGrantsTx(tx, appId))
  const fresh = keys.filter((k) => !existing.has(k))
  if (fresh.length === 0) return

  tx.insert(miniAppGrantTable)
    .values(fresh.map((permission) => ({ appId, permission, grantedVersion: version })))
    .run()
}

export function grantMiniAppPermissions(appId: string, keys: string[], version: string): void {
  application.get('DbService').withWriteTx((tx) => grantMiniAppPermissionsTx(tx, appId, keys, version))
}

/**
 * Sets the grant set to EXACTLY `keys` — the rollback primitive.
 *
 * Rollback must restore the grants the user actually had, which is not derivable
 * from the previous manifest: a manifest records what was *declared*, and the user
 * may have revoked some of it. Re-granting a declared set would hand back
 * permissions they took away, which is the one thing a rollback must never do.
 */
export function replaceGrantsTx(tx: DbOrTx, appId: string, keys: string[], version: string): void {
  tx.delete(miniAppGrantTable).where(eq(miniAppGrantTable.appId, appId)).run()
  if (keys.length > 0) {
    tx.insert(miniAppGrantTable)
      .values(keys.map((permission) => ({ appId, permission, grantedVersion: version })))
      .run()
  }
}

export function replaceGrants(appId: string, keys: string[], version: string): void {
  application.get('DbService').withWriteTx((tx) => replaceGrantsTx(tx, appId, keys, version))
}

export function revokeGrantTx(tx: DbOrTx, appId: string, key: string): void {
  tx.delete(miniAppGrantTable)
    .where(and(eq(miniAppGrantTable.appId, appId), eq(miniAppGrantTable.permission, key)))
    .run()
}

export function revokeGrant(appId: string, key: string): void {
  application.get('DbService').withWriteTx((tx) => revokeGrantTx(tx, appId, key))
}

/**
 * Permission growth = OLD DECLARED vs NEW DECLARED, never "new declared vs current
 * grants". A user who revoked `storage` would otherwise see an unchanged update
 * reported as asking for a new permission — and re-granting the full declared set
 * afterwards would silently restore what they revoked.
 *
 * Current grants are for runtime authorization only (`assertGranted`).
 */
export function diffDeclaredSets(
  previous: MiniAppManifest,
  next: MiniAppManifest
): { added: string[]; addedOptional: string[]; removed: string[] } {
  const before = declaredGrants(previous)
  const after = declaredGrants(next)
  const wasRequired = new Set(before.required)
  const declaredBefore = new Set(declaredGrantKeys(previous))
  const declaredAfter = new Set(declaredGrantKeys(next))
  return {
    /*
     * Anything now REQUIRED that was not required before — which deliberately includes a
     * leaf promoted out of `optionalPermissions`. That promotion takes away the user's
     * ability to revoke it, so design §6.0.1 pins it as "treat as newly required";
     * flattening the two arrays before diffing makes it invisible and turns the promotion
     * into a way around the install gate.
     */
    added: after.required.filter((k) => !wasRequired.has(k)).sort(),
    /** Newly OFFERED. Shown on the card, never blocks: declining just means not granted. */
    addedOptional: after.optional.filter((k) => !declaredBefore.has(k)).sort(),
    removed: [...declaredBefore].filter((k) => !declaredAfter.has(k)).sort()
  }
}

/**
 * Hosts this update ADDS.
 *
 * Not part of the grant diff — a host is not a grant — but consent-worthy all the same:
 * each new host is a new place the app's data can go, and a compromised update server
 * walks the supply chain one host at a time. Without this, taking hosts out of the grant
 * table would be a security regression rather than a simplification.
 */
export function diffDeclaredHosts(previous: MiniAppManifest, next: MiniAppManifest): string[] {
  const before = new Set(previous.network)
  return next.network.filter((h) => !before.has(h)).sort()
}

export function assertGranted(appId: string, key: string): void {
  if (!listGrants(appId).includes(key)) throw new PermissionDeniedError(appId, key)
}

/**
 * Leaves the app declares NOW that did not exist when the user consented.
 *
 * The only cause is a Cherry release adding a method inside a namespace the app
 * declared with a wildcard. Deliberately diffed against `consentedDeclaredJson`
 * rather than against the current grants: the latter would also surface everything
 * the user deliberately revoked, and re-granting those is precisely what a revoke
 * must survive.
 */
export function pendingDeclaredAdditions(_appId: string, manifest: MiniAppManifest, consented: string[]): string[] {
  const consentedSet = new Set(consented)
  return declaredGrantKeys(manifest).filter((k) => !consentedSet.has(k))
}

/**
 * The runtime gate, driven by `MINI_APP_METHODS`.
 *
 * Exact matching only — there is deliberately no prefix/wildcard match here. A
 * wildcard is expanded once, at consent; matching one at call time would mean a
 * method Cherry adds tomorrow is already permitted by a grant given today.
 */
export function assertMethodAllowed(appId: string, method: MiniAppMethod): void {
  const { gate } = MINI_APP_METHODS[method]
  if (gate === 'none') return
  if (gate === 'grant') return assertGranted(appId, method)

  // `sibling`: introspection, allowed once the app holds anything in the namespace.
  // Refusing it narrows nothing — it only makes the app fail blind.
  const namespace = `${method.split('.')[0]}.`
  if (!listGrants(appId).some((g) => g.startsWith(namespace))) {
    throw new PermissionDeniedError(appId, method)
  }
}
