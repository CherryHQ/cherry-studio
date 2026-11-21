/**
 * Repair-round bookkeeping (issue #21646, stage 3, AC9).
 *
 * The authoring loop is: validate fails -> the agent repairs -> repackage ->
 * validate again. Without a cap a broken package can burn rounds forever, so the
 * THIRD consecutive failure on the same (session, package) blocks the artifact:
 * validate stops re-reading it, and install and publishing refuse it, until a
 * successful validation (a genuinely fixed package) resets the count.
 *
 * "Consecutive" is per artifact key, not per session: repairing app A does not
 * spend app B's rounds, and alternating between two broken packages caps each.
 *
 * Module scope, like artifactTokens: process-local, nothing persists, and a
 * restart resets the count — the safe direction, since a blocked artifact is
 * recoverable by one clean validation while an unblocked loop is not.
 */

export const MAX_CONSECUTIVE_REPAIR_ROUNDS = 3

interface RepairRecord {
  /** Consecutive failed validations; reset to 0 by any success. */
  failures: number
  /** Newest-first failure reasons, kept for the blocked response's evidence. */
  evidence: string[]
  blockedAt: number | null
}

const records = new Map<string, RepairRecord>()

function keyOf(sessionId: string, artifactKey: string): string {
  return `${sessionId} ${artifactKey}`
}

export interface RepairBlocked {
  readonly blocked: true
  readonly rounds: number
  readonly evidence: readonly string[]
  /** Human- and model-readable next steps, newest evidence first. */
  readonly recovery: readonly string[]
}

export function isRepairBlocked(sessionId: string, artifactKey: string): boolean {
  return records.get(keyOf(sessionId, artifactKey))?.blockedAt != null
}

/** A clean validation clears the artifact's rounds: it was repaired successfully. */
export function noteValidationSuccess(sessionId: string, artifactKey: string): void {
  records.delete(keyOf(sessionId, artifactKey))
}

/**
 * One failed validation. Returns the blocked view when this failure was the
 * third consecutive one; the caller turns it into the tool's blocked output.
 */
export function noteValidationFailure(sessionId: string, artifactKey: string, reason: string): RepairBlocked | null {
  const key = keyOf(sessionId, artifactKey)
  const record = records.get(key) ?? { failures: 0, evidence: [], blockedAt: null }
  record.failures += 1
  record.evidence.unshift(reason)
  // Keep the three newest: they are exactly the rounds the cap counts.
  record.evidence = record.evidence.slice(0, MAX_CONSECUTIVE_REPAIR_ROUNDS)
  if (record.failures < MAX_CONSECUTIVE_REPAIR_ROUNDS) {
    records.set(key, record)
    return null
  }
  record.blockedAt = Date.now()
  records.set(key, record)
  return {
    blocked: true,
    rounds: record.failures,
    evidence: [...record.evidence],
    recovery: [
      'Stop automated repair: three consecutive repair rounds failed for this package.',
      'Rebuild the package from the skill template and run the skill validate script locally before retrying.',
      'Compare the package bytes against the last passing artifact (the digest is in the validation report).',
      'If the failure is in the host checks, capture the failing check output and hand it back to the user.'
    ]
  }
}

/** The blocked view for an already-capped artifact, or null when it is not blocked. */
export function getRepairBlocked(sessionId: string, artifactKey: string): RepairBlocked | null {
  const record = records.get(keyOf(sessionId, artifactKey))
  if (!record || record.blockedAt == null) return null
  return {
    blocked: true,
    rounds: record.failures,
    evidence: [...record.evidence],
    recovery: [
      'Stop automated repair: three consecutive repair rounds failed for this package.',
      'Rebuild the package from the skill template and run the skill validate script locally before retrying.',
      'Compare the package bytes against the last passing artifact (the digest is in the validation report).',
      'If the failure is in the host checks, capture the failing check output and hand it back to the user.'
    ]
  }
}

/** Session teardown drops its repair state along with its tokens and previews. */
export function resetSessionRepairRounds(sessionId: string): number {
  let cleared = 0
  for (const key of records.keys()) {
    if (key.startsWith(`${sessionId} `)) {
      records.delete(key)
      cleared += 1
    }
  }
  return cleared
}

/** Test hook: wipe everything (module state is process-global). */
export function resetAllRepairRounds(): void {
  records.clear()
}
