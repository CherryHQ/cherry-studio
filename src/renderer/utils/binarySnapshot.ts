import type { BinaryApplication, BinaryToolSnapshot } from '@shared/types/binary'
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
  /**
   * @deprecated Durable manifest intent, not an application fact. Prefer
   * {@link applicationStatus}/{@link exactApplied}; kept so existing call sites
   * that read `owned` still compile during the Phase 1 transition.
   */
  owned: boolean
  /** Version string only when the source actually reports one (mise/bundled). */
  installedVersion?: string
  /** Executable path when resolved through the system PATH. */
  systemPath?: string
  /** Executable path for any resolved (non-`none`) source. */
  resolvedPath?: string
  /** The exact-backend-application status main computed, when present. */
  applicationStatus?: BinaryApplication['status']
  /** True only when the exact managed recipe is applied through mise. */
  exactApplied: boolean
  /** Version carried by the application fact (`applied`/`broken`); absent otherwise. */
  applicationVersion?: string
  /** An exactly-applied tool has a newer managed version available. */
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
  // ignoreSystemSource collapses only availability; the application fact below is
  // an independent live truth and is never masked by it.
  const availability = raw.source === 'system' && options.ignoreSystemSource ? { source: 'none' as const } : raw
  const owned = !!snapshot?.intent
  const application = snapshot?.application
  const applicationStatus = application?.status
  const exactApplied = applicationStatus === 'applied'
  const applicationVersion =
    application && (application.status === 'applied' || application.status === 'broken')
      ? application.version
      : undefined
  const installedVersion =
    availability.source === 'mise' || availability.source === 'bundled' ? availability.version : undefined
  return {
    source: availability.source,
    installed: availability.source !== 'none',
    owned,
    installedVersion,
    systemPath: availability.source === 'system' ? availability.path : undefined,
    resolvedPath: availability.source === 'none' ? undefined : availability.path,
    applicationStatus,
    exactApplied,
    applicationVersion,
    // An update requires the exact recipe to be applied — never mere ownership or
    // a runnable-but-not-applied conflict/external source.
    hasUpdate: exactApplied && isNewerVersion(options.latest, applicationVersion)
  }
}
