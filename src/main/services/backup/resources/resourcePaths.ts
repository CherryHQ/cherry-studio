import { isSafeRelativeSubpath, portableCollisionKey, toRelativeSegments } from '@main/utils/relativePath'

import { BACKUP_CEILINGS } from '../ceilings'

/**
 * The subset of {@link BACKUP_CEILINGS} this validator reads. Declared
 * structurally (plain `number`s, not the frozen literal type) so callers and
 * tests can supply narrowed limits without fighting the `as const` literals.
 */
export interface ResourcePathLimits {
  readonly maxResourceInstallEntries: number
  readonly maxPathDepth: number
  readonly maxPathLength: number
}

/**
 * Pure resource-path invariant validator, called at BOTH archive admission
 * (Phase 1b) and journal sealing (Phase 2/3) so resource order is irrelevant
 * (docs/references/backup/README.md §4, §6.3). It decides whether a set of
 * `resource-install` live paths is a legal install plan.
 *
 * It performs NO filesystem access. The existing-target classification, unsafe
 * ancestor detection, registered-root containment, and same-device eligibility
 * are trusted facts the I/O caller computes (via `lstat`/`realpath`/`dev`
 * compare) and passes in; this module never fakes them. Its own work is the
 * string- and set-level invariants (safe portable paths, collision-aware
 * distinctness, no ancestor overlap) plus rejecting the trusted facts that make
 * a rename install unsafe:
 * - an unsafe existing ancestor (symlink/special in the path to the target);
 * - a target that is itself a symlink/special file (never a rename target);
 * - a target whose EXISTING type differs from the declared `resourceType`
 *   (installing a file where a directory exists — or vice versa — would require
 *   destroying the existing node, deleting target-only descendants and
 *   violating preservation, §2/§6.3);
 * - a target outside a registered root, or a cross-filesystem (EXDEV) install.
 */

/**
 * Trusted `lstat` classification of the EXISTING live target itself:
 * `absent` (fresh install), a regular `file`/`directory`, or an
 * unsafe `symlink`/`special` node. `symlink`/`special` are never install
 * targets; a present `file`/`directory` must match the declared `resourceType`.
 */
export type TargetState = 'absent' | 'file' | 'directory' | 'symlink' | 'special'

export interface ResourcePathCandidate {
  /** userData-relative destination of the install unit. */
  readonly livePath: string
  readonly resourceType: 'file' | 'directory'
  /** Trusted `lstat` of the existing live path (the node to be replaced/created). */
  readonly targetState: TargetState
  /** Trusted: every EXISTING ancestor directory of every rename slot (staging, live, aside) is a real directory (no symlink/special). */
  readonly ancestorsSafe: boolean
  /** Trusted: the resolved live path is contained in an allowed registered root. */
  readonly containedInRegisteredRoot: boolean
  /** Trusted: every rename slot (staging, live, aside) is on userData's filesystem (rename-eligible). */
  readonly sameFilesystemAsRoot: boolean
}

export type ResourcePathViolation =
  | { readonly code: 'too-many'; readonly count: number; readonly limit: number }
  | { readonly code: 'invalid-path'; readonly index: number; readonly livePath: string }
  | { readonly code: 'unsafe-ancestor'; readonly index: number; readonly livePath: string }
  | {
      readonly code: 'target-not-installable'
      readonly index: number
      readonly livePath: string
      readonly targetState: TargetState
    }
  | {
      readonly code: 'target-type-mismatch'
      readonly index: number
      readonly livePath: string
      readonly resourceType: 'file' | 'directory'
      readonly targetState: TargetState
    }
  | { readonly code: 'outside-root'; readonly index: number; readonly livePath: string }
  | { readonly code: 'cross-filesystem'; readonly index: number; readonly livePath: string }
  | { readonly code: 'duplicate'; readonly index: number; readonly livePath: string }
  | {
      readonly code: 'ancestor-overlap'
      readonly index: number
      readonly livePath: string
      readonly ancestorPath: string
    }

export type ResourcePathValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly violation: ResourcePathViolation }

function isPrefixSegments(prefix: readonly string[], of: readonly string[]): boolean {
  if (prefix.length >= of.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== of[i]) return false
  }
  return true
}

/**
 * Segment-wise lexicographic order (shorter prefix first). This — NOT raw
 * string order — is what makes an ancestor sort immediately before all its
 * descendants: a sibling whose bytes fall below `/` (e.g. `kb-old` vs `kb/x`)
 * string-sorts *between* `kb` and `kb/x` and would break the prefix-stack scan.
 */
function compareSegments(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  return a.length - b.length
}

/**
 * Returns the first violation (in a deterministic phase order) or `{ ok: true }`.
 * Phase order: count ceiling → per-entry facts (input order) → collision-key
 * duplicates (input order) → ancestor overlap.
 *
 * Distinctness and ancestor overlap use the {@link portableCollisionKey} of each
 * path, so `Foo/a` + `foo/a` (and NFC/NFD pairs) — which alias to one file on a
 * case-insensitive / normalizing filesystem — are rejected as a collision, not
 * silently installed twice onto the same target.
 */
export function validateResourcePaths(
  candidates: readonly ResourcePathCandidate[],
  limits: ResourcePathLimits = BACKUP_CEILINGS
): ResourcePathValidation {
  if (candidates.length > limits.maxResourceInstallEntries) {
    return {
      ok: false,
      violation: { code: 'too-many', count: candidates.length, limit: limits.maxResourceInstallEntries }
    }
  }

  const relativeLimits = { maxLength: limits.maxPathLength, maxDepth: limits.maxPathDepth }

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    const { livePath, resourceType, targetState } = candidate
    if (!isSafeRelativeSubpath(livePath, relativeLimits)) {
      return { ok: false, violation: { code: 'invalid-path', index, livePath } }
    }
    if (!candidate.ancestorsSafe) {
      return { ok: false, violation: { code: 'unsafe-ancestor', index, livePath } }
    }
    if (targetState === 'symlink' || targetState === 'special') {
      return { ok: false, violation: { code: 'target-not-installable', index, livePath, targetState } }
    }
    if (targetState !== 'absent' && targetState !== resourceType) {
      return { ok: false, violation: { code: 'target-type-mismatch', index, livePath, resourceType, targetState } }
    }
    if (!candidate.containedInRegisteredRoot) {
      return { ok: false, violation: { code: 'outside-root', index, livePath } }
    }
    if (!candidate.sameFilesystemAsRoot) {
      return { ok: false, violation: { code: 'cross-filesystem', index, livePath } }
    }
  }

  return validateResourcePathSet(candidates.map((candidate) => candidate.livePath))
}

/**
 * The set-level half of the contract: collision-aware distinctness and no
 * ancestor overlap, over destination paths alone.
 *
 * Split out because the EXPORT producer needs exactly this and nothing else — it
 * is choosing archive payload paths, so there is no target to `lstat` and no
 * trusted fact to supply. Sharing the algorithm is the point: an archive whose
 * payloads overlap would be rejected by admission on the restoring device, which
 * is far too late to learn the producer had a different idea of distinctness.
 */
export function validateResourcePathSet(livePaths: readonly string[]): ResourcePathValidation {
  const seen = new Set<string>()
  for (let index = 0; index < livePaths.length; index++) {
    const livePath = livePaths[index]
    const collisionKey = portableCollisionKey(livePath)
    if (seen.has(collisionKey)) {
      return { ok: false, violation: { code: 'duplicate', index, livePath } }
    }
    seen.add(collisionKey)
  }

  // Ancestor overlap over collision-key segments: sort by segments so any
  // ancestor precedes its descendants and remains a prefix on the stack.
  // Exact (collision-key) duplicates are already rejected above.
  const indexed = livePaths.map((livePath, index) => ({
    index,
    livePath,
    segments: toRelativeSegments(portableCollisionKey(livePath))
  }))
  indexed.sort((a, b) => compareSegments(a.segments, b.segments))

  const stack: Array<{ livePath: string; segments: string[] }> = []
  for (const entry of indexed) {
    while (stack.length > 0 && !isPrefixSegments(stack[stack.length - 1].segments, entry.segments)) {
      stack.pop()
    }
    if (stack.length > 0) {
      return {
        ok: false,
        violation: {
          code: 'ancestor-overlap',
          index: entry.index,
          livePath: entry.livePath,
          ancestorPath: stack[stack.length - 1].livePath
        }
      }
    }
    stack.push({ livePath: entry.livePath, segments: entry.segments })
  }

  return { ok: true }
}
