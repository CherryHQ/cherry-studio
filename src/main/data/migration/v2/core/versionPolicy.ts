/**
 * Version upgrade policy for the v1→v2 migration gate.
 *
 * Enforces a linear upgrade path: v1.old → v1.last → v2.0.0 → v2.x.
 * Called by `v2MigrationGate.ts` after `needsMigration()` returns true
 * and before the migration window is created. If the check fails, the
 * gate shows an error dialog and quits — the user never sees the
 * migration UI.
 *
 * Pre-release handling:
 *   - `currentVersion` is coerced via `semver.coerce()` so that
 *     `2.0.0-alpha` is treated as `2.0.0` for the gateway check.
 *     This prevents false-blocking v1 users who install a pre-release.
 *   - `previousVersion` is NOT coerced. A previous version of
 *     `2.0.0-beta` is considered "before 2.0.0" — the user has not
 *     passed the gateway. Pre-release-to-pre-release upgrades
 *     (alpha→beta→rc→2.0.0) are fine because `needsMigration()`
 *     returns false once migration has completed on any pre-release.
 */

import fs from 'node:fs'

import { loggerService } from '@logger'
import semver from 'semver'

const logger = loggerService.withContext('VersionPolicy')

// ── Version constants ───────────────────────────────────────────────

/**
 * Minimum v1 version required for v2 data migration.
 * VersionService has been embedded since v1.7, but data migration only
 * supports upgrading from the final v1 release.
 * TODO: Update this value once the final v1 version is determined (expected ~1.9.x).
 */
export const V1_REQUIRED_VERSION = '1.9.0'

/** v2 migration gateway version — must not be skipped. */
export const V2_GATEWAY_VERSION = '2.0.0'

// ── Types ───────────────────────────────────────────────────────────

export type VersionBlockReason = 'no_version_log' | 'v1_too_old' | 'v2_gateway_skipped'

export type VersionCheckResult =
  | { outcome: 'pass' }
  | { outcome: 'block'; reason: VersionBlockReason; details: Record<string, string> }

export interface VersionCheckInput {
  /** `app.getVersion()` — may include pre-release tags (e.g. `2.0.0-alpha`). */
  currentAppVersion: string
  /** Version string parsed from version.log, or null if unavailable. */
  previousVersion: string | null
  /** Whether the version.log file exists on disk. */
  versionLogExists: boolean
}

// ── Core check (pure function) ──────────────────────────────────────

/**
 * Determine whether the upgrade path from `previousVersion` to
 * `currentAppVersion` is compatible with the v2 migration requirements.
 *
 * `currentAppVersion` is internally coerced to strip pre-release tags.
 * `previousVersion` is used as-is.
 */
export function checkUpgradePathCompatibility(input: VersionCheckInput): VersionCheckResult {
  const { currentAppVersion, previousVersion, versionLogExists } = input

  // Coerce current version: 2.0.0-alpha → 2.0.0.
  // Do NOT pass { includePrerelease: true } — the default strips the
  // pre-release tag, which is exactly what we need so that Rule 3 does
  // not false-block v1 users installing a v2.0.0 pre-release.
  const coercedCurrent = semver.coerce(currentAppVersion)?.version ?? currentAppVersion

  // ❶ No version.log and no previous version → user never ran a v1
  //    version with VersionService embedded.
  if (!previousVersion && !versionLogExists) {
    return {
      outcome: 'block',
      reason: 'no_version_log',
      details: { requiredVersion: V1_REQUIRED_VERSION }
    }
  }

  // ❷ Previous version exists but is below V1_REQUIRED_VERSION.
  if (previousVersion && semver.lt(previousVersion, V1_REQUIRED_VERSION)) {
    return {
      outcome: 'block',
      reason: 'v1_too_old',
      details: { previousVersion, requiredVersion: V1_REQUIRED_VERSION }
    }
  }

  // ❸ Previous version is v1.x and current version jumped past the
  //    v2.0.0 gateway (e.g. v1.9.0 → v2.1.0, or v2.0.0-beta → v2.1.0).
  if (
    previousVersion &&
    semver.lt(previousVersion, V2_GATEWAY_VERSION) &&
    semver.gt(coercedCurrent, V2_GATEWAY_VERSION)
  ) {
    return {
      outcome: 'block',
      reason: 'v2_gateway_skipped',
      details: { previousVersion, currentVersion: currentAppVersion, gatewayVersion: V2_GATEWAY_VERSION }
    }
  }

  // ❹ version.log exists but no different version found — retry
  //    scenario or single-entry edge case. Pass through.
  if (!previousVersion && versionLogExists) {
    logger.info('version.log exists but no previous version found — allowing migration')
  }

  // ❺ All other cases pass.
  return { outcome: 'pass' }
}

// ── version.log reader ──────────────────────────────────────────────

/**
 * Read version.log and return the last version that differs from
 * `currentVersion`. Uses the same pipe-separated format as
 * `VersionService` (version|os|env|packaged|mode|timestamp).
 *
 * Accepts an explicit file path so the caller can pass
 * `MigrationPaths.versionLogFile` — the resolved path that accounts
 * for v1 custom userData directories.
 *
 * Reads the entire file (typically < 1KB). Corrupted lines are
 * silently skipped with a warning log.
 *
 * @returns The previous version string, or null.
 */
export function readPreviousVersion(versionLogPath: string, currentVersion: string): string | null {
  let content: string
  try {
    content = fs.readFileSync(versionLogPath, 'utf-8')
  } catch {
    return null
  }

  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim())

  if (lines.length === 0) {
    return null
  }

  let hasValidLines = false

  // Scan backwards to find the most recent different version.
  for (let i = lines.length - 1; i >= 0; i--) {
    const version = parseVersionFromLine(lines[i])
    if (!version) continue
    hasValidLines = true
    if (version !== currentVersion) {
      return version
    }
  }

  // Non-empty file but zero parseable records — log for diagnostics.
  if (!hasValidLines && lines.length > 0) {
    logger.warn('version.log contains lines but none could be parsed', { lineCount: lines.length })
  }

  return null
}

/**
 * Extract the version field from a version.log line.
 * Format: `version|os|environment|packaged|mode|timestamp`
 * Returns the version string or null if the line is invalid.
 */
function parseVersionFromLine(line: string): string | null {
  const parts = line.trim().split('|')
  if (parts.length !== 6) return null

  const version = parts[0]
  if (!version || !semver.valid(version)) return null

  return version
}

// ── Block message helper ────────────────────────────────────────────

/**
 * Build a user-facing error message for the given block reason.
 * Hardcoded English — matches existing `dialog.showErrorBox` patterns
 * in the migration gate.
 */
export function getBlockMessage(reason: VersionBlockReason, details: Record<string, string>): string {
  switch (reason) {
    case 'no_version_log':
      return (
        `Cannot determine your previous Cherry Studio version.\n\n` +
        `Please install version ${details.requiredVersion} first and run it at least once, ` +
        `then install this version to complete the data migration.`
      )
    case 'v1_too_old':
      return (
        `Your previous version (${details.previousVersion}) is too old to migrate directly.\n\n` +
        `Please install version ${details.requiredVersion} first and run it at least once, ` +
        `then install this version.`
      )
    case 'v2_gateway_skipped':
      return (
        `Cannot upgrade directly from ${details.previousVersion} to ${details.currentVersion}.\n\n` +
        `Please install version ${details.gatewayVersion} first to complete the data migration, ` +
        `then upgrade to this version.`
      )
  }
}
