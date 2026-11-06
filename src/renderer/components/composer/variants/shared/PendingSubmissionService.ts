/**
 * Cross-instance pending-submission guard for the composer Send action.
 *
 * The per-component in-flight ref resets when the composer unmounts, so a
 * composer reopened while its first submission is still in flight could
 * re-Send the restored draft and mint a second queue row with a fresh UUID
 * that backend idempotency cannot combine (cherry-pr-review
 * inv_785c705f28b6e100). This composer-owned singleton survives remounts:
 * acquisition is keyed by the draft's scope and released when the submission
 * settles or fails, so failure recovery keeps the draft and allows a retry.
 * It never clears or rewrites the editor — newer edits stay untouched and
 * the settlement reconciliation keeps owning them.
 */
class PendingSubmissionService {
  private readonly pendingScopes = new Set<string>()

  /** Whether a submission for this draft scope is still in flight. */
  isPending(scope: string): boolean {
    return this.pendingScopes.has(scope)
  }

  /** Mark a submission for this draft scope as in flight. */
  acquire(scope: string): void {
    this.pendingScopes.add(scope)
  }

  /** Release the in-flight mark once the submission settles or fails. */
  release(scope: string): void {
    this.pendingScopes.delete(scope)
  }
}

export const pendingSubmissionService = new PendingSubmissionService()
