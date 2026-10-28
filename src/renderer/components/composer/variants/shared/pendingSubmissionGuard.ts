/**
 * Cross-instance pending-submission guard for the composer Send action.
 *
 * The per-component in-flight ref resets when the composer unmounts, so a
 * composer reopened while its first submission is still in flight could
 * re-Send the restored draft and mint a second queue row with a fresh UUID
 * that backend idempotency cannot combine (cherry-pr-review
 * inv_785c705f28b6e100). This module-level registry survives remounts:
 * acquisition is keyed by the draft's scope and released when the submission
 * settles or fails, so failure recovery keeps the draft and allows a retry.
 * It never clears or rewrites the editor — newer edits stay untouched and
 * the settlement reconciliation keeps owning them.
 */
const pendingSubmissionScopes = new Set<string>()

/** Whether a submission for this draft scope is still in flight. */
export function isSubmissionPending(scope: string): boolean {
  return pendingSubmissionScopes.has(scope)
}

/** Mark a submission for this draft scope as in flight. */
export function acquirePendingSubmission(scope: string): void {
  pendingSubmissionScopes.add(scope)
}

/** Release the in-flight mark once the submission settles or fails. */
export function releasePendingSubmission(scope: string): void {
  pendingSubmissionScopes.delete(scope)
}
