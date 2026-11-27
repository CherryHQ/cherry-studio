import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import type { RunPaths } from './paths'
import type { Platform, RunMode } from './types'

/**
 * Artifact identity record: which binary the platform actually exercised.
 *
 * The record always lives at `<run dir>/release/installation.json`, and the aggregate job nests
 * every platform artifact under `evidence/<platform>/`, so the published contract path is
 * `evidence/<platform>/release/installation.json`. The QA ledger reads the installer identity
 * from that path; a run whose archive lacks it cannot be attributed to an artifact.
 */
export const INSTALLATION_RECORD_FILE_NAME = 'installation.json'
export const INSTALLATION_RECORD_DIRECTORY = 'release'

export interface ReleaseInstallerRecord {
  schemaVersion: 1
  source: 'release-installer'
  mode: RunMode
  platform: Platform
  recordedAt: string
  artifactName: string
  artifactPath: string
  artifactSha256: string
  executablePath: string
  installedPath: string
}

export interface SourceCheckoutRecord {
  schemaVersion: 1
  source: 'source-checkout'
  mode: 'branch'
  platform: Platform
  recordedAt: string
  appVersion: string
  ref: string
  commitSha: string
  targetRoot: string
  command: string
}

/** Backwards-compatible name used by the release installation and lifecycle code. */
export type InstallationRecord = ReleaseInstallerRecord
export type ArtifactIdentityRecord = ReleaseInstallerRecord | SourceCheckoutRecord

/** Contract path of the record inside a published platform evidence directory (always posix). */
export function installationEvidencePath(platform: Platform): string {
  return ['evidence', platform, INSTALLATION_RECORD_DIRECTORY, INSTALLATION_RECORD_FILE_NAME].join('/')
}

export function writeInstallationRecord(paths: RunPaths, record: ArtifactIdentityRecord): void {
  writeFileSync(paths.installation, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Branch runs execute a `target-app` checkout instead of an installer, so there is no download to
 * hash. Identity is the commit plus the checkout the launched process came from; without it a
 * development verdict cannot be tied to the source that produced it.
 */
export function writeSourceCheckoutInstallation(
  paths: RunPaths,
  metadata: { platform: Platform; appVersion: string; ref: string; commitSha: string },
  launch: { targetRoot: string; command: string }
): SourceCheckoutRecord {
  const record: SourceCheckoutRecord = {
    schemaVersion: 1,
    source: 'source-checkout',
    mode: 'branch',
    platform: metadata.platform,
    recordedAt: new Date().toISOString(),
    appVersion: metadata.appVersion,
    ref: metadata.ref,
    commitSha: metadata.commitSha,
    targetRoot: launch.targetRoot,
    command: launch.command
  }
  writeInstallationRecord(paths, record)
  return record
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Returns every reason the record cannot identify an artifact. An empty list means the archive is
 * acceptable; callers must treat a non-empty list as a hard failure instead of trusting file
 * existence, because a truncated or placeholder record looks present but carries no identity.
 */
export function inspectArtifactIdentity(filePath: string, platform: Platform): string[] {
  if (!existsSync(filePath)) return ['the artifact identity record is missing']
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    return [`the record is not valid JSON (${error instanceof Error ? error.message : String(error)})`]
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ['the record is not a JSON object']

  const record = parsed as Record<string, unknown>
  const problems: string[] = []
  if (record.schemaVersion !== 1) problems.push('schemaVersion must be 1')
  if (record.platform !== platform) problems.push(`platform is ${String(record.platform)}, expected ${platform}`)
  if (Number.isNaN(Date.parse(text(record.recordedAt)))) problems.push('recordedAt is not an ISO timestamp')
  if (!['branch', 'tag'].includes(text(record.mode)))
    problems.push(`mode is ${String(record.mode)}, expected branch or tag`)

  const source = text(record.source)
  if (source === 'release-installer') {
    if (text(record.mode) !== 'tag') problems.push('a release-installer record must describe a tag run')
    for (const field of ['artifactName', 'artifactPath', 'executablePath', 'installedPath']) {
      if (!text(record[field])) problems.push(`${field} is empty`)
    }
    if (!/^[0-9a-f]{64}$/.test(text(record.artifactSha256))) problems.push('artifactSha256 is not a SHA-256 digest')
  } else if (source === 'source-checkout') {
    if (text(record.mode) !== 'branch') problems.push('a source-checkout record must describe a branch run')
    if (!text(record.appVersion)) problems.push('appVersion is empty')
    if (!text(record.ref)) problems.push('ref is empty')
    if (!/^[0-9a-f]{7,40}$/.test(text(record.commitSha))) problems.push('commitSha is not a git commit id')
    if (!text(record.targetRoot)) problems.push('targetRoot is empty')
  } else {
    problems.push(`source is ${source || '(missing)'}, expected release-installer or source-checkout`)
  }
  return problems
}

export class InstallationEvidenceError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'))
    this.name = 'InstallationEvidenceError'
  }
}

/**
 * Throws unless the record at `filePath` identifies the artifact for `platform`. The message names
 * both the file that was read and the contract path the archive is expected to publish, so a
 * failure in CI points at the archive layout instead of a bare ENOENT.
 */
export function assertArtifactIdentity(filePath: string, platform: Platform): void {
  const problems = inspectArtifactIdentity(filePath, platform)
  if (problems.length === 0) return
  throw new InstallationEvidenceError([
    `Artifact identity evidence is incomplete for ${platform}: ${installationEvidencePath(platform)}`,
    `  read: ${filePath}`,
    ...problems.map((problem) => `  - ${problem}`)
  ])
}
