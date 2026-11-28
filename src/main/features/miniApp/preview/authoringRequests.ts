/**
 * The artifact card's consent actions (issue #21646, stage 3): shared main-side
 * core for `mini_app.authoring.request_preview` / `request_install`.
 *
 * The renderer names a FILE (the attachment's handle). It never sees a token:
 * the session's own token is looked up here, the package is re-hashed against
 * the digest it pins (AC5), and a repair-capped artifact is refused (AC9). A
 * file the session never validated gets "no-artifact" — the card's answer is
 * "let the agent validate it first", because the token is the proof the session
 * produced these bytes.
 */

import fs from 'node:fs'
import path from 'node:path'

import { fileEntryService } from '@data/services/FileEntryService'
import { resolvePhysicalPath } from '@main/services/file'
import type { FileHandle } from '@shared/data/types/file'

import { sha256File } from '../install/archive'
import { type ArtifactTokenRecord, findLatestArtifactToken } from './artifactTokens'
import { isRepairBlocked } from './repairRounds'

export type AuthoringRequestErrorCode = 'not-a-package' | 'no-artifact' | 'package-changed' | 'repair-blocked'

export class AuthoringRequestError extends Error {
  constructor(
    readonly code: AuthoringRequestErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AuthoringRequestError'
  }
}

/**
 * The handle's real path, limited to `.miniapp` packages. Both arms realpath:
 * token records key on it, so a symlinked attachment must find the token its
 * own validation issued.
 */
export async function resolveArtifactHandle(handle: FileHandle): Promise<string> {
  const raw = handle.kind === 'entry' ? resolvePhysicalPath(fileEntryService.getById(handle.entryId)) : handle.path
  if (!raw.toLowerCase().endsWith('.miniapp')) {
    throw new AuthoringRequestError('not-a-package', 'Authoring actions apply to .miniapp packages only')
  }
  return fs.promises.realpath(raw)
}

/**
 * The session's token for THIS package, with every stage-3 refusal applied.
 * Order matters: repair-blocked wins over a changed digest — the cap already
 * told the session to stop touching this package.
 */
export async function expectSessionArtifact(sessionId: string, realPath: string): Promise<ArtifactTokenRecord> {
  if (isRepairBlocked(sessionId, realPath)) {
    throw new AuthoringRequestError(
      'repair-blocked',
      'This package failed three consecutive repair rounds; rebuild it from the template before installing'
    )
  }
  const record = findLatestArtifactToken(sessionId, realPath)
  if (!record) {
    throw new AuthoringRequestError(
      'no-artifact',
      'This package was not validated in this session; run the mini_app tool validate action first'
    )
  }
  const sha256 = await sha256File(realPath)
  if (sha256 !== record.sha256) {
    throw new AuthoringRequestError(
      'package-changed',
      'The package changed since it was validated; run validate again before installing'
    )
  }
  return record
}

/** The dismissed list with `appId` added (deduped) — pure, for the handler and its test. */
export function withLaunchpadDismissal(dismissed: readonly string[], appId: string): string[] {
  return dismissed.includes(appId) ? [...dismissed] : [...dismissed, appId]
}

/** Launchpad read-back for the card: pinned or explicitly dismissed means answered. */
export function isLaunchpadAnswered(status: string, dismissed: readonly string[], appId: string): boolean {
  return status === 'pinned' || dismissed.includes(appId)
}

/** The card shows its actions only for packages — mirrors resolveArtifactHandle's check. */
export function isMiniAppPackageName(fileName: string): boolean {
  return path.extname(fileName).toLowerCase() === '.miniapp'
}
