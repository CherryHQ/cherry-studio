import { lstatSync } from 'node:fs'

import {
  type BackupPlatform,
  describeAbsolutePath,
  isPathContainedIn,
  type ManagedRootRebaseTable,
  type RebasableManagedRootKey,
  sameVolume,
  targetLocalPath,
  targetRootPaths
} from './managedPathRebase'

/**
 * Whether a restore may keep an EXTERNAL `agent_workspace.path` — the Layer 2
 * half of the three-layer workspace policy (docs/references/backup/README.md
 * §3.1).
 *
 * Layer 1 (the archive was attested as this install's own) and Layer 3 (the
 * placeholder) live with their owners; this module owns the middle question,
 * which is the only one that needs judgement: an unattested archive names an
 * absolute path this device never wrote, and the Agents page will `stat` whatever
 * survives here the moment it mounts. So the value has to earn that stat.
 *
 * WHAT THE GATES ARE ACTUALLY FOR. The danger was never "an absolute path from an
 * archive" — it was the two things such a path can do before any user acts:
 * reach the NETWORK (a `\\server\share` path makes Windows authenticate to an
 * attacker's host, leaking the machine account) and address a volume this app
 * has no business touching. Both are decidable from the string plus one trusted
 * local anchor, with no I/O — so they are decided FIRST, and the existence probe
 * only ever runs on a path already proven local. What is left after the gates is
 * an ordinary directory on this machine's own disk, which the user themselves
 * could have picked.
 *
 * The pure gate and the single filesystem call are deliberately separate
 * functions: the interesting policy is all in the former, and it is testable
 * without a filesystem.
 */

/** Why a workspace binding will not be honoured. Structural reasons only — never a stored value. */
export type WorkspaceDisconnectReason =
  /** The producer's platform is not this one, so its path syntax means nothing here. */
  | 'platform-mismatch'
  /** Not an absolute path for the producer platform. */
  | 'not-absolute'
  /** Contains a `.`/`..` component: not a normalized path, so containment cannot be reasoned about. */
  | 'unnormalized'
  /** win32 UNC (`\\server\share`): a network location, and the one path shape that must never be touched. */
  | 'network-path'
  /** win32: the drive is not the one this install runs from, so it is not provably local. */
  | 'foreign-volume'
  /** Inside one of THIS device's managed roots — an overlay target, not an external user directory. */
  | 'target-managed'
  /** No trusted local anchor to compare against (the archive never declared the workspaces root). */
  | 'no-local-anchor'
  /** Nothing is there, or it is not a real directory (a symlink is not followed). */
  | 'absent'

export type WorkspacePathDecision =
  /** Keep the stored path verbatim: it is a real, local, external directory. */
  { readonly kind: 'keep' } | { readonly kind: 'disconnect'; readonly reason: WorkspaceDisconnectReason }

/** Anchor of the local-volume proof: the target managed root the placeholders also use. */
const LOCAL_ANCHOR_KEY: RebasableManagedRootKey = 'feature.agents.system_workspaces'

/** The single filesystem question Layer 2 asks, isolated so the policy stays pure. */
export interface WorkspaceProbe {
  /** True only for an existing REAL directory. `lstat`, so a symlink is never followed. */
  isRealDirectory(candidatePath: string): boolean
}

export const workspaceProbe: WorkspaceProbe = {
  isRealDirectory(candidatePath: string): boolean {
    try {
      return lstatSync(candidatePath).isDirectory()
    } catch {
      // ENOENT, EACCES, ELOOP, ENAMETOOLONG — every one of them means this
      // device cannot prove a directory is there, which is a disconnect.
      return false
    }
  }
}

export interface ExternalWorkspaceGateInput {
  /** UNTRUSTED stored value. */
  readonly value: string
  readonly producerPlatform: BackupPlatform
  readonly targetPlatform: BackupPlatform
  /**
   * A TRUSTED absolute path on the volume this install runs from. Used only for
   * its volume, and only on win32.
   */
  readonly localAnchorPath: string | null
  /** TRUSTED target managed roots; a candidate inside any of them is refused. */
  readonly targetManagedRoots: readonly string[]
}

/**
 * Everything decidable without touching the filesystem. `probe` means "no string
 * reason to refuse this — ask the disk"; anything else is final.
 */
export function gateExternalWorkspacePath(
  input: ExternalWorkspaceGateInput
): { readonly kind: 'probe' } | { readonly kind: 'disconnect'; readonly reason: WorkspaceDisconnectReason } {
  const { value, producerPlatform, targetPlatform, localAnchorPath, targetManagedRoots } = input

  // A producer path is written in the producer's syntax, and only its own
  // platform can interpret it. `/Users/me/code` is not a path on Windows and
  // `C:\code` is not one on POSIX; a mismatch is not a portability problem to
  // solve, it is a value with no meaning here.
  if (producerPlatform !== targetPlatform) return { kind: 'disconnect', reason: 'platform-mismatch' }

  const shape = describeAbsolutePath(value, targetPlatform)
  if (!shape) return { kind: 'disconnect', reason: 'not-absolute' }
  if (shape.hasDotSegment) return { kind: 'disconnect', reason: 'unnormalized' }

  if (targetPlatform === 'win32') {
    // The credential-leaking shape. Refused before any comparison so no later
    // rule can accidentally admit it.
    if (shape.isUnc) return { kind: 'disconnect', reason: 'network-path' }
    if (localAnchorPath === null) return { kind: 'disconnect', reason: 'no-local-anchor' }
    const anchor = describeAbsolutePath(localAnchorPath, targetPlatform)
    if (!anchor) return { kind: 'disconnect', reason: 'no-local-anchor' }
    // drive letter ≠ system drive → disconnect; upgrade to a GetDriveType probe if
    // users need secondary local drives.
    if (!sameVolume(shape.volume, anchor.volume, targetPlatform)) {
      return { kind: 'disconnect', reason: 'foreign-volume' }
    }
  }
  // POSIX needs no volume gate: an absolute POSIX path addresses this machine's
  // own namespace, and a mount point is not a remote-authentication trigger the
  // way a UNC path is.

  for (const root of targetManagedRoots) {
    if (isPathContainedIn(root, value, targetPlatform)) return { kind: 'disconnect', reason: 'target-managed' }
  }

  return { kind: 'probe' }
}

/**
 * Decide one external workspace path against a prepared rebase table: the pure
 * gate, then — only if it passed — one existence probe.
 */
export function classifyExternalWorkspacePath(
  table: ManagedRootRebaseTable,
  value: string,
  probe: WorkspaceProbe = workspaceProbe
): WorkspacePathDecision {
  const gate = gateExternalWorkspacePath({
    value,
    producerPlatform: table.producerPlatform,
    targetPlatform: table.targetPlatform,
    // Built from the trusted target root, so it is on the volume this install
    // runs from by construction.
    localAnchorPath: targetLocalPath(table, LOCAL_ANCHOR_KEY, []),
    targetManagedRoots: targetRootPaths(table)
  })
  if (gate.kind === 'disconnect') return gate
  return probe.isRealDirectory(value) ? { kind: 'keep' } : { kind: 'disconnect', reason: 'absent' }
}
