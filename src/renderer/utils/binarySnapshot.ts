import type { BinaryToolSnapshot } from '@shared/types/binary'
import { gt as semverGt, valid as semverValid } from 'semver'

/**
 * Normalized, display-ready reading of a raw {@link BinaryToolSnapshot}.
 *
 * Centralizes the rules every management surface needs — which availability
 * source carries a version, when a tool counts as owned, which path to show,
 * and whether a managed update exists — so the Dependencies page and the Code
 * CLI page cannot drift in how they interpret a snapshot.
 */
export interface InterpretedBinarySnapshot {
  source: BinaryToolSnapshot['availability']['source']
  /** True when the tool resolves to any concrete source (mise/bundled/system). */
  installed: boolean
  /** Cherry manages this tool (has a durable manifest intent). */
  owned: boolean
  /** Version string only when the source actually reports one (mise/bundled). */
  installedVersion?: string
  /** Executable path when resolved through the system PATH. */
  systemPath?: string
  /** Executable path for any resolved (non-`none`) source. */
  resolvedPath?: string
  /** An owned tool has a newer managed version available. */
  hasUpdate: boolean
}

export interface InterpretBinarySnapshotOptions {
  /** Latest managed version for this tool, from the latest-versions cache. */
  latest?: string
  /**
   * Collapse a `system` availability to `none`. The Code CLI page uses this for
   * OpenClaw: a system `openclaw` on PATH must not read as an installed managed
   * tool. Left off, a system source is interpreted normally.
   */
  ignoreSystemSource?: boolean
}

const isNewerVersion = (latest?: string, installed?: string): boolean => {
  const validLatest = latest ? semverValid(latest) : null
  const validInstalled = installed ? semverValid(installed) : null
  if (!validLatest || !validInstalled) return false
  try {
    return semverGt(validLatest, validInstalled)
  } catch {
    return false
  }
}

/** Interpret a raw snapshot into the primitives a management card renders. */
export function interpretBinarySnapshot(
  snapshot: BinaryToolSnapshot | undefined,
  options: InterpretBinarySnapshotOptions = {}
): InterpretedBinarySnapshot {
  const raw = snapshot?.availability ?? { source: 'none' as const }
  const availability = raw.source === 'system' && options.ignoreSystemSource ? { source: 'none' as const } : raw
  const owned = !!snapshot?.intent
  const installedVersion =
    availability.source === 'mise' || availability.source === 'bundled' ? availability.version : undefined
  return {
    source: availability.source,
    installed: availability.source !== 'none',
    owned,
    installedVersion,
    systemPath: availability.source === 'system' ? availability.path : undefined,
    resolvedPath: availability.source === 'none' ? undefined : availability.path,
    hasUpdate: owned && isNewerVersion(options.latest, installedVersion)
  }
}
