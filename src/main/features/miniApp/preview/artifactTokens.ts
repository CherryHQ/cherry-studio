/**
 * Artifact tokens: the unforgeable link between a validated `.miniapp` package and
 * the preview (stage 2) or install (stage 3) it authorizes.
 *
 * A token binds FOUR facts at validate time: the owning chat session, the package's
 * absolute path, its `sha256:` digest, and its size. Preview and install re-hash the
 * file at use time and refuse a mismatch, so a package swapped after validation —
 * by the user, by another session, or by the agent itself — can never ride the old
 * token through.
 *
 * Module scope, like the protocol's read slots: tokens are process-local by design.
 * Nothing persists them, and a restart leaves every old artifact requiring a fresh
 * `validate` — which is the safe direction to fail in.
 */

import { randomBytes } from 'node:crypto'

export interface ArtifactTokenRecord {
  readonly token: string
  /** Owning chat session. Only it may preview or install from this token. */
  readonly sessionId: string
  /** Absolute path of the validated package, re-hashed at use time. */
  readonly packagePath: string
  /** `sha256:<hex>` of the package bytes at validate time (`archive.sha256File`). */
  readonly sha256: string
  readonly size: number
  readonly createdAt: number
}

export type ArtifactTokenErrorCode = 'unknown-token' | 'session-mismatch'

export class ArtifactTokenError extends Error {
  constructor(
    readonly code: ArtifactTokenErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ArtifactTokenError'
  }
}

const records = new Map<string, ArtifactTokenRecord>()

export function issueArtifactToken(input: {
  sessionId: string
  packagePath: string
  sha256: string
  size: number
}): ArtifactTokenRecord {
  // 128 bits, unguessable: the token is the ONLY thing a guest or another session
  // would need to spend this validation.
  const record: ArtifactTokenRecord = {
    token: `art_${randomBytes(16).toString('hex')}`,
    sessionId: input.sessionId,
    packagePath: input.packagePath,
    sha256: input.sha256,
    size: input.size,
    createdAt: Date.now()
  }
  records.set(record.token, record)
  return record
}

export function getArtifactTokenRecord(token: string): ArtifactTokenRecord | undefined {
  return records.get(token)
}

/**
 * The record, or a thrown reason. The session check is HERE and not at every call
 * site: a token borrowed across sessions is indistinguishable from a stolen one.
 */
export function expectArtifactToken(token: string, sessionId: string): ArtifactTokenRecord {
  const record = records.get(token)
  if (!record) throw new ArtifactTokenError('unknown-token', 'Unknown or expired artifact token')
  if (record.sessionId !== sessionId) {
    throw new ArtifactTokenError('session-mismatch', 'Artifact token belongs to a different session')
  }
  return record
}

export function revokeArtifactToken(token: string): boolean {
  return records.delete(token)
}

/**
 * The session's NEWEST token for one package path, for the consent surfaces that
 * never see tokens (the artifact card's actions): they name the file, main finds
 * the token. Undefined when the session never validated that path — the caller's
 * "validate first" answer.
 */
export function findLatestArtifactToken(sessionId: string, packagePath: string): ArtifactTokenRecord | undefined {
  let latest: ArtifactTokenRecord | undefined
  for (const record of records.values()) {
    if (record.sessionId === sessionId && record.packagePath === packagePath) {
      if (!latest || record.createdAt >= latest.createdAt) latest = record
    }
  }
  return latest
}

/**
 * Session teardown: closing, replacing or exiting a session invalidates everything
 * it validated. Returns how many tokens went away, for the caller's log line.
 */
export function revokeSessionArtifactTokens(sessionId: string): number {
  let revoked = 0
  for (const [token, record] of records) {
    if (record.sessionId === sessionId) {
      records.delete(token)
      revoked += 1
    }
  }
  return revoked
}
