import type { PathKey } from '@main/core/paths/pathRegistry'
import { isSafeRelativeSubpath } from '@main/utils/relativePath'

import { BACKUP_CEILINGS } from '../ceilings'
import type { ManagedRootIdentity } from '../manifest'

/**
 * Deterministic managed-path rebasing (docs/references/backup/README.md §3.1,
 * §4). Absolute paths stored in an archive's database were written by the
 * PRODUCER profile; on the target they must either land inside the equivalent
 * target-registered root or be treated as inert external metadata. This module
 * decides which, as pure string work.
 *
 * It performs NO filesystem and NO database access, and never calls
 * `application.getPath()`: the caller resolves target roots once and passes them
 * in ({@link prepareManagedRootRebase}). That keeps the trust asymmetry explicit
 * — target roots are TRUSTED (registry-resolved), producer roots and candidate
 * paths are UNTRUSTED archive input.
 *
 * The only `@main/core/paths` dependency is the compile-time {@link PathKey}
 * type, so a registry key rename breaks this file at typecheck instead of
 * silently disabling a rebase rule at runtime.
 */

/** Producer/target platform, matching the manifest's `producer.platform` enum. */
export type BackupPlatform = 'darwin' | 'win32' | 'linux'

/**
 * The closed set of registered roots whose absolute paths may be rebased.
 *
 * An entry earns its place only when (a) Cherry owns the root as an overlay
 * target (§4) and (b) a database column actually stores ABSOLUTE paths under it.
 * Adding a root "just in case" would widen what an archive can redirect, so the
 * list is exactly the two columns §3.1 names:
 *
 * - `feature.notes.data` ← `note.root_path`. Empty `feature.notes.path` makes the
 *   renderer fall back to this managed root (src/main/ipc/handlers/app.ts:20 →
 *   src/renderer/services/NotesService.ts:122).
 * - `feature.agents.system_workspaces` ← `agent_workspace.path` for SYSTEM
 *   workspaces, built below that registered root by AgentWorkspaceService.
 *
 * Deliberately ABSENT: `feature.files.data` and `feature.knowledgebase.data`
 * (their content is addressed by id, with no absolute path column — the only
 * path-bearing columns are `file_entry.external_path` and
 * `knowledge_item.data.source`, both external by definition) and
 * `feature.agents.skills` (`agent_global_skill.folder_name` is already relative).
 * `external.*` and `sys.*` roots can never appear here: they are third-party or
 * OS-owned and must never become rebase destinations (§4).
 *
 * A producer-declared root outside this list is IGNORED rather than rejected — a
 * newer or older producer may legitimately declare roots this build knows nothing
 * about, and paths under it then classify as `external` and stay inert, which is
 * the safe direction.
 */
export const REBASABLE_MANAGED_ROOT_KEYS = [
  'feature.notes.data',
  'feature.agents.system_workspaces'
] as const satisfies readonly PathKey[]

export type RebasableManagedRootKey = (typeof REBASABLE_MANAGED_ROOT_KEYS)[number]

const REBASABLE_KEY_SET: ReadonlySet<string> = new Set(REBASABLE_MANAGED_ROOT_KEYS)

/**
 * An absolute path decomposed into its volume and its segments. `volume` is the
 * part no rebase may ever cross (`/` on POSIX, `C:` or `\\server\share` on
 * win32); `segments` are the path components below it, with EMPTY components
 * dropped (`//` collapses) but `.`/`..` deliberately PRESERVED so a
 * non-normalized path cannot pass the portable-suffix gate.
 */
interface SplitAbsolutePath {
  readonly volume: string
  readonly segments: readonly string[]
}

const WIN32_DRIVE_ROOT = /^[a-zA-Z]:[\\/]/
const WIN32_SEPARATOR = /[\\/]/

function splitWin32(value: string): SplitAbsolutePath | null {
  if (value.startsWith('\\\\') || value.startsWith('//')) {
    // UNC: \\server\share\rest — both server and share are part of the volume.
    const parts = value.slice(2).split(WIN32_SEPARATOR)
    const [server, share, ...rest] = parts
    if (!server || !share) return null
    return { volume: `\\\\${server}\\${share}`, segments: rest.filter((segment) => segment !== '') }
  }
  if (!WIN32_DRIVE_ROOT.test(value)) return null // relative, rooted-relative (`\x`), or drive-relative (`C:x`)
  return {
    volume: value.slice(0, 2),
    segments: value
      .slice(3)
      .split(WIN32_SEPARATOR)
      .filter((segment) => segment !== '')
  }
}

function splitPosix(value: string): SplitAbsolutePath | null {
  if (!value.startsWith('/')) return null
  if (value.includes('\\')) return null // a backslash is a legal POSIX filename char but never a separator; treat as hostile
  return { volume: '/', segments: value.split('/').filter((segment) => segment !== '') }
}

/** Decompose an absolute path, or `null` when it is not absolute for `platform`. */
function splitAbsolutePath(value: string, platform: BackupPlatform): SplitAbsolutePath | null {
  if (value === '') return null
  return platform === 'win32' ? splitWin32(value) : splitPosix(value)
}

/**
 * Comparison key for one path component.
 *
 * win32 folds case (NTFS/`\\?\`-less Win32 paths are case-insensitive), so
 * `C:\Users` and `c:\users` are the same root. POSIX compares EXACTLY, even
 * though APFS is case-insensitive by default: assuming otherwise would let a
 * producer root over-capture a differently-cased path and rebase it, whereas an
 * exact-match miss only downgrades that path to inert `external` — the safe
 * direction under §3.1. Unicode normalization is likewise not applied; no
 * supported filesystem guarantees it, and folding NFD onto NFC here would
 * over-capture in the same way.
 */
function comparisonKey(component: string, platform: BackupPlatform): string {
  return platform === 'win32' ? component.toLowerCase() : component
}

function isNormalizedRoot(split: SplitAbsolutePath): boolean {
  // A root is the trusted boundary of every containment proof, so it must be a
  // plain normalized directory path: no dot segments, and never the bare volume
  // (a producer declaring `/` or `C:\` would capture EVERY absolute path in its
  // database and funnel it into a target root — exactly the archive-controlled
  // arbitrary prefix §3.1 forbids).
  if (split.segments.length === 0) return false
  return !split.segments.some((segment) => segment === '.' || segment === '..')
}

/**
 * One validated producer-root → target-root pairing. Both sides are already
 * decomposed, so classification is prefix comparison with no re-parsing.
 */
interface RootPairing {
  readonly key: RebasableManagedRootKey
  readonly producer: SplitAbsolutePath
  readonly producerKeys: readonly string[]
  readonly target: SplitAbsolutePath
  readonly targetPath: string
}

/**
 * A prepared, validated rebase table. Built once per restore
 * ({@link prepareManagedRootRebase}) and then consulted per candidate path
 * ({@link classifyManagedPath}).
 */
export interface ManagedRootRebaseTable {
  readonly producerPlatform: BackupPlatform
  readonly targetPlatform: BackupPlatform
  readonly pairings: readonly RootPairing[]
}

export interface PrepareRebaseInput {
  /** `producer.platform` from the archive manifest (UNTRUSTED). */
  readonly producerPlatform: BackupPlatform
  /** `producer.managedRoots` from the archive manifest (UNTRUSTED). */
  readonly producerRoots: readonly ManagedRootIdentity[]
  /** This device's platform. */
  readonly targetPlatform: BackupPlatform
  /**
   * TRUSTED target roots, resolved by the caller through
   * `application.getPath()`. A key absent here disables rebasing for that root.
   */
  readonly targetRoots: Readonly<Partial<Record<RebasableManagedRootKey, string>>>
}

export type PrepareRebaseError =
  /** A required rebasable root was omitted, so managed paths could be misclassified as external. */
  | { readonly code: 'producer-root-missing'; readonly key: RebasableManagedRootKey }
  /** A rebasable producer root's path is not an absolute, normalized, non-volume-root path. */
  | { readonly code: 'producer-root-unusable'; readonly key: string; readonly path: string }
  /** Two rebasable producer roots declare the same path — longest-match resolution would be ambiguous. */
  | { readonly code: 'producer-root-ambiguous'; readonly key: string; readonly path: string }
  /** A trusted target root is missing for a rebasable producer root the archive declares. */
  | { readonly code: 'target-root-missing'; readonly key: string }
  /** A trusted target root is not an absolute, normalized, non-volume-root path (registry/caller bug). */
  | { readonly code: 'target-root-unusable'; readonly key: string; readonly path: string }

export type PrepareRebaseResult =
  | { readonly ok: true; readonly table: ManagedRootRebaseTable }
  | { readonly ok: false; readonly error: PrepareRebaseError }

/**
 * Validate and pair the archive's managed-root identities with this device's
 * resolved roots.
 *
 * Fails CLOSED on every problem with a root the archive declares as rebasable.
 * Degrading to "no pairing" instead would silently leave managed paths pointing
 * at producer directories — on a different device those either do not exist or,
 * worse, belong to someone else — so an uninterpretable rebasable root must stop
 * materialization rather than quietly change the meaning of stored rows.
 */
export function prepareManagedRootRebase(input: PrepareRebaseInput): PrepareRebaseResult {
  const pairings: RootPairing[] = []
  const seenProducerPaths = new Map<string, string>()

  for (const identity of input.producerRoots) {
    if (!REBASABLE_KEY_SET.has(identity.key)) continue
    const key = identity.key as RebasableManagedRootKey

    const producer = splitAbsolutePath(identity.path, input.producerPlatform)
    if (!producer || !isNormalizedRoot(producer)) {
      return { ok: false, error: { code: 'producer-root-unusable', key, path: identity.path } }
    }

    const producerKeys = producer.segments.map((segment) => comparisonKey(segment, input.producerPlatform))
    const identityKey = [comparisonKey(producer.volume, input.producerPlatform), ...producerKeys].join('\u0000')
    const clashingKey = seenProducerPaths.get(identityKey)
    if (clashingKey !== undefined) {
      return { ok: false, error: { code: 'producer-root-ambiguous', key: clashingKey, path: identity.path } }
    }
    seenProducerPaths.set(identityKey, key)

    const targetPath = input.targetRoots[key]
    if (targetPath === undefined) {
      return { ok: false, error: { code: 'target-root-missing', key } }
    }
    const target = splitAbsolutePath(targetPath, input.targetPlatform)
    if (!target || !isNormalizedRoot(target)) {
      return { ok: false, error: { code: 'target-root-unusable', key, path: targetPath } }
    }

    pairings.push({ key, producer, producerKeys, target, targetPath })
  }

  // Every root this build uses to classify managed database paths is mandatory.
  // Omitting one cannot degrade safely: rows under it would become `external`
  // and retain a source-device absolute path while appearing portable.
  for (const key of REBASABLE_MANAGED_ROOT_KEYS) {
    if (input.targetRoots[key] !== undefined && !pairings.some((pairing) => pairing.key === key)) {
      return { ok: false, error: { code: 'producer-root-missing', key } }
    }
  }

  // Longest producer root first: nested roots then resolve to the most specific
  // match deterministically, independent of manifest order.
  pairings.sort((a, b) => b.producer.segments.length - a.producer.segments.length)

  return {
    ok: true,
    table: { producerPlatform: input.producerPlatform, targetPlatform: input.targetPlatform, pairings }
  }
}

export type ManagedPathRejectReason =
  /** The stored value is not an absolute path for the producer platform (empty, relative, drive-relative, UNC-less `\x`). */
  | 'not-absolute'
  /** The path is inside a managed root but its relative suffix is not portable (dot segment, reserved name, over-limit). */
  | 'unportable-suffix'
  /** The rebased path failed the containment proof against its trusted target root (defensive; never expected). */
  | 'containment-failed'

export type ManagedPathClassification =
  /**
   * Inside a registered managed root: `rebasedPath` is the target-platform
   * absolute path, proven contained in the target root.
   */
  | {
      readonly kind: 'managed'
      readonly rootKey: RebasableManagedRootKey
      readonly suffix: string
      readonly rebasedPath: string
    }
  /**
   * A well-formed absolute path outside every registered managed root — an
   * external/user-owned location. INERT: never rebased, stat'd, followed,
   * copied, or auto-activated (§3.1, §4). Its owner decides whether to keep it
   * as metadata or degrade the row.
   */
  | { readonly kind: 'external' }
  /** Fail closed: the owner must degrade or drop the path-bearing value. */
  | { readonly kind: 'rejected'; readonly reason: ManagedPathRejectReason }

function isPrefix(prefix: readonly string[], of: readonly string[]): boolean {
  if (prefix.length > of.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== of[i]) return false
  }
  return true
}

/**
 * Whether `candidate` is `root` itself or a descendant of it, matching on whole
 * path COMPONENTS.
 *
 * Component matching — not string prefixing — is what makes the boundary exact:
 * `/data/root` does not contain `/data/rootExtra`, even though the latter starts
 * with the former's characters. Exported because it is the containment proof
 * every rebase result must satisfy, and it is asserted directly by tests.
 */
export function isPathContainedIn(root: string, candidate: string, platform: BackupPlatform): boolean {
  const rootSplit = splitAbsolutePath(root, platform)
  const candidateSplit = splitAbsolutePath(candidate, platform)
  if (!rootSplit || !candidateSplit || !isNormalizedRoot(rootSplit)) return false
  if (candidateSplit.segments.some((segment) => segment === '.' || segment === '..')) return false
  if (comparisonKey(rootSplit.volume, platform) !== comparisonKey(candidateSplit.volume, platform)) return false
  return isPrefix(
    rootSplit.segments.map((segment) => comparisonKey(segment, platform)),
    candidateSplit.segments.map((segment) => comparisonKey(segment, platform))
  )
}

/**
 * Rebuild an absolute path from the TRUSTED target root's own decomposition plus
 * the validated suffix. Containment therefore holds by construction: the output
 * literally begins with the root's volume and segments, and no part of the
 * archive's string reaches the prefix. Also canonicalizes separators and collapsed
 * duplicates, so the stored value is normalized for the target platform.
 */
function joinAbsolute(root: SplitAbsolutePath, suffixSegments: readonly string[]): string {
  const segments = [...root.segments, ...suffixSegments]
  if (root.volume === '/') return `/${segments.join('/')}`
  return `${root.volume}\\${segments.join('\\')}`
}

/**
 * Build an absolute path under a paired TARGET managed root from segments the
 * CALLER owns — no archive string reaches it.
 *
 * This is how an owner replaces a stored value it refuses to honour with one that
 * is provably local to this device. `null` means the root is not paired (the
 * archive never declared it) or the segments would escape it, and the caller must
 * fail closed rather than fall back to the value it was replacing.
 */
export function targetLocalPath(
  table: ManagedRootRebaseTable,
  key: RebasableManagedRootKey,
  segments: readonly string[]
): string | null {
  const pairing = table.pairings.find((candidate) => candidate.key === key)
  if (!pairing) return null
  const path = joinAbsolute(pairing.target, segments)
  return isPathContainedIn(pairing.targetPath, path, table.targetPlatform) ? path : null
}

/**
 * Classify one absolute path stored in the archive's database.
 *
 * The rebased path is built by CONSTRUCTION from the trusted target root plus a
 * suffix that has already passed the portable-subpath rules, so it cannot escape
 * the root; {@link isPathContainedIn} then re-proves that independently before
 * the value is returned.
 */
export function classifyManagedPath(table: ManagedRootRebaseTable, value: string): ManagedPathClassification {
  const candidate = splitAbsolutePath(value, table.producerPlatform)
  if (!candidate) return { kind: 'rejected', reason: 'not-absolute' }

  const candidateVolume = comparisonKey(candidate.volume, table.producerPlatform)
  const candidateKeys = candidate.segments.map((segment) => comparisonKey(segment, table.producerPlatform))

  for (const pairing of table.pairings) {
    if (comparisonKey(pairing.producer.volume, table.producerPlatform) !== candidateVolume) continue
    if (!isPrefix(pairing.producerKeys, candidateKeys)) continue

    const suffixSegments = candidate.segments.slice(pairing.producer.segments.length)
    const suffix = suffixSegments.join('/')
    // The root itself (empty suffix) rebases to the target root; anything below
    // it must survive the same portable-subpath rules the archive applies to
    // resource entries, so a `..`, a Windows-reserved name, or an over-long
    // path fails closed instead of being silently normalized.
    if (
      suffixSegments.length > 0 &&
      !isSafeRelativeSubpath(suffix, {
        maxLength: BACKUP_CEILINGS.maxPathLength,
        maxDepth: BACKUP_CEILINGS.maxPathDepth
      })
    ) {
      return { kind: 'rejected', reason: 'unportable-suffix' }
    }

    const rebasedPath = joinAbsolute(pairing.target, suffixSegments)
    if (!isPathContainedIn(pairing.targetPath, rebasedPath, table.targetPlatform)) {
      return { kind: 'rejected', reason: 'containment-failed' }
    }
    return { kind: 'managed', rootKey: pairing.key, suffix, rebasedPath }
  }

  return { kind: 'external' }
}
