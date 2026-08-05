import { DB_COMMIT_STEP, PROMOTION_STEP_ORDER_V2, type PromotionStepV2 } from './restoreJournalV2'

/**
 * Pure crash-recovery decision for a single unit — the DB promotion or one
 * `resource-install` unit — of the Backup v2 promotion (§6.3, §6.4). It maps
 * the durable recovery *direction* (derived from the last-completed global step
 * vs the commit boundary) plus the `(staged, live, aside)` filesystem-existence
 * triple onto exactly one {@link RecoveryAction}.
 *
 * It performs NO filesystem access: `staged`/`live`/`aside` are trusted
 * existence facts the caller probes, and `phase` is derived from the persisted
 * step (and, at the commit boundary, the DB commit-point probe) by the caller.
 * The function only chooses the action; Phase 2/3 executes the renames.
 *
 * Totality: the mapping is exhaustive over all 2 × 2³ = 16 states. Eight are
 * the reachable rows named in §6.4; the rest are defensive completions. Two
 * families fail closed rather than mutate:
 * - a committed-yet-live-absent state (the DB says done but the target is gone);
 * - a "both source and live present" state where the backup is still staged AND
 *   `live` holds an unproven node. Under rename-only install the backup lives in
 *   exactly one of {staged, live}, so staged+live is impossible — except the one
 *   provable pre-commit case where `aside` is ALSO absent, which proves no
 *   parking happened and `live` is therefore the untouched original target (kept
 *   as it is). Every other staged+live state (pre-commit `SLA`, committed `SL-`,
 *   committed `SLA`) could be `live`=installed-backup or `live`=target-only file;
 *   we cannot prove ownership, so restoring/overwriting/discarding it might
 *   destroy a target-only file (violating preservation) → `abort-inconsistent`.
 * `(present, absent, present)` is the ambiguous case §6.4 calls out: rollback
 * under `pre-commit`, forward under `committed`.
 */
export type RecoveryPhase = 'pre-commit' | 'committed'

export interface RecoveryFacts {
  readonly phase: RecoveryPhase
  /** Staged source still present. */
  readonly staged: boolean
  /** Registered live destination present. */
  readonly live: boolean
  /** Reserved aside (parked pre-restore target) present. */
  readonly aside: boolean
}

export type RecoveryAction =
  /** Nothing to do — the unit is already in its terminal rolled-back/absent state. */
  | 'noop'
  /** Remove the staged source; leave `live` exactly as it is (no aside to restore). */
  | 'discard-staged'
  /** Make `live` the aside snapshot: restore aside→live, discarding staged and any current live content. */
  | 'restore-aside'
  /** Remove the installed backup from `live` (target was originally absent, no aside); discard any staged. */
  | 'uninstall'
  /** Move staged→live (target already parked in aside or was absent). */
  | 'install-forward'
  /** Installation committed: keep `live`, retain `aside` for GC, discard any leftover staged. */
  | 'complete'
  /** Unreachable from the promotion algorithm; the caller must fail closed without mutating. */
  | 'abort-inconsistent'

/**
 * Derive the recovery phase from the durable last-completed step. Comparison
 * goes through `indexOf` on the step-order table (never lexicographic).
 */
export function phaseForStep(step: PromotionStepV2): RecoveryPhase {
  return PROMOTION_STEP_ORDER_V2.indexOf(step) >= PROMOTION_STEP_ORDER_V2.indexOf(DB_COMMIT_STEP)
    ? 'committed'
    : 'pre-commit'
}

function key(facts: RecoveryFacts): string {
  return `${facts.phase}:${facts.staged ? 'S' : '-'}${facts.live ? 'L' : '-'}${facts.aside ? 'A' : '-'}`
}

/**
 * Exhaustive `(phase, staged, live, aside)` → action table. `[R]` marks the
 * eight reachable rows named in §6.4; `[D]` marks defensive completions of the
 * 16-state total.
 */
const RECOVERY_TABLE: Readonly<Record<string, RecoveryAction>> = Object.freeze({
  // pre-commit: always undo.
  'pre-commit:---': 'noop', //            [D] all gone; already rolled back / target originally absent
  'pre-commit:--A': 'restore-aside', //   [D] only aside survives; restore it
  'pre-commit:-L-': 'uninstall', //       [R] installed backup, no aside → target was absent → remove it
  'pre-commit:-LA': 'restore-aside', //   [R] backup in live, aside parked → restore aside
  'pre-commit:S--': 'discard-staged', //  [R] target absent, not installed → drop staged
  'pre-commit:S-A': 'restore-aside', //   [R] AMBIGUOUS: pre-commit rolls back → restore aside, drop staged
  'pre-commit:SL-': 'discard-staged', //  [R] no aside ⇒ live is the untouched original → drop staged, keep target
  'pre-commit:SLA': 'abort-inconsistent', // [D] staged+live+aside: live unprovable (backup vs target-only) → fail closed
  // committed: always finish forward.
  'committed:---': 'abort-inconsistent', //  [D] committed yet live absent → fail closed
  'committed:--A': 'abort-inconsistent', //  [D] committed yet live absent (only aside) → fail closed
  'committed:-L-': 'complete', //            [R] fully installed, no aside (target was absent) → done
  'committed:-LA': 'complete', //            [R] installed, aside retained for GC → done
  'committed:S--': 'install-forward', //     [D] live absent → move staged into live
  'committed:S-A': 'install-forward', //     [R] AMBIGUOUS: committed → install pending, move staged in
  'committed:SL-': 'abort-inconsistent', //  [D] staged+live post-commit: live unprovable → fail closed
  'committed:SLA': 'abort-inconsistent' //   [D] staged+live+aside post-commit: live unprovable → fail closed
})

export function decideRecoveryAction(facts: RecoveryFacts): RecoveryAction {
  const action = RECOVERY_TABLE[key(facts)]
  // The table is exhaustive over the closed (phase × staged × live × aside)
  // domain; a miss can only mean a malformed facts object.
  if (action === undefined) {
    throw new Error(`decideRecoveryAction: unmapped recovery state ${key(facts)}`)
  }
  return action
}
