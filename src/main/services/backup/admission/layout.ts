import { portableCollisionKey, toRelativeSegments } from '@main/utils/relativePath'

import { RESOURCES_PREFIX } from '../archiveLayout'
import { ArchiveAdmissionError, renderUntrustedName } from '../errors'
import type { BackupManifest, ResourcePayload } from '../manifest'
import type { ArchiveShape, NormalizedEntry } from './catalog'

/**
 * Payload-layout classification for archive admission (Phase 1b-ii,
 * docs/references/backup/README.md §5.1). Runs AFTER the manifest is parsed —
 * it decides whether the archive's actual `resources/` entries agree with the
 * manifest's declared payload inventory. Pure over paths + the manifest; no I/O.
 *
 * It proves the "nothing undeclared / nothing overlapping" direction:
 * - Lite carries no resource bytes at all;
 * - every Full `resourcePayload` sits under `resources/`, is unique and
 *   non-overlapping, so at most one unit ever covers a given file;
 * - every regular resource FILE entry is covered by EXACTLY one declared unit
 *   (an undeclared file is rejected);
 * - every resource DIRECTORY entry is structural — it must be an ancestor of a
 *   declared payload or lie within a declared directory unit.
 *
 * The complementary "everything declared is actually present, with the declared
 * type and hash" direction is proved post-extraction by recomputing each unit's
 * hash/size from the staged tree ({@link ./verify}); a file unit whose staged
 * node is a directory (or vice-versa) fails there, so type agreement need not be
 * re-derived from ZIP metadata here.
 */

/** A declared Full payload as a coverage unit: its collision-key segments + type. */
export interface CoverageUnit {
  readonly payload: ResourcePayload
  readonly segments: readonly string[]
  readonly isDirectory: boolean
}

function segEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function isStrictPrefix(prefix: readonly string[], of: readonly string[]): boolean {
  if (prefix.length >= of.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== of[i]) return false
  }
  return true
}

function keySegments(path: string): string[] {
  return toRelativeSegments(portableCollisionKey(path))
}

/**
 * Validate the resource layout against the manifest. Throws
 * {@link ArchiveAdmissionError} `layout` on any disagreement; returns the
 * coverage units (Full) or an empty list (Lite) for later verification.
 */
export function classifyPayloadLayout(shape: ArchiveShape, manifest: BackupManifest): readonly CoverageUnit[] {
  if (manifest.preset === 'lite') {
    // Lite ships manifest.json + backup.sqlite only. Any resource entry — file
    // OR directory — contradicts the preset.
    if (shape.resourceFiles.length > 0 || shape.resourceDirs.length > 0) {
      throw new ArchiveAdmissionError('layout', 'lite archive carries resource entries')
    }
    return []
  }

  const units = buildUnits(manifest.resourcePayloads)
  assertFilesCovered(shape.resourceFiles, units)
  assertDirsStructural(shape.resourceDirs, units)
  return units
}

/** Build coverage units, rejecting any payload that is misplaced, duplicated, or overlapping. */
function buildUnits(payloads: readonly ResourcePayload[]): CoverageUnit[] {
  const units: CoverageUnit[] = payloads.map((payload) => {
    if (!payload.archivePath.startsWith(RESOURCES_PREFIX)) {
      throw new ArchiveAdmissionError(
        'layout',
        `payload archivePath not under resources/: ${renderUntrustedName(payload.archivePath)}`
      )
    }
    return { payload, segments: keySegments(payload.archivePath), isDirectory: payload.resourceType === 'directory' }
  })

  // Duplicate keys (case/NFC-aware) — two payloads pinned to one archive path.
  const seen = new Set<string>()
  for (const unit of units) {
    const key = unit.segments.join('/')
    if (seen.has(key)) {
      throw new ArchiveAdmissionError(
        'layout',
        `duplicate payload archivePath: ${renderUntrustedName(unit.payload.archivePath)}`
      )
    }
    seen.add(key)
  }

  // Ancestor overlap — sort by segments so an ancestor precedes its descendants,
  // then reject any unit that is a strict prefix of the following one. Two units
  // where one contains the other would make coverage ambiguous.
  const sorted = [...units].sort((a, b) => compareSegments(a.segments, b.segments))
  for (let i = 1; i < sorted.length; i++) {
    if (isStrictPrefix(sorted[i - 1].segments, sorted[i].segments)) {
      throw new ArchiveAdmissionError(
        'layout',
        `overlapping payloads: ${renderUntrustedName(sorted[i - 1].payload.archivePath)} contains ${renderUntrustedName(sorted[i].payload.archivePath)}`
      )
    }
  }
  return units
}

function compareSegments(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  return a.length - b.length
}

/**
 * The declared units that cover a resource file path (case/NFC-aware). Reused by
 * post-extraction verification to re-prove exact inventory agreement over the
 * staged tree. Non-overlapping units guarantee this returns at most one.
 */
export function coveringUnits(units: readonly CoverageUnit[], filePath: string): readonly CoverageUnit[] {
  const fileSegments = keySegments(filePath)
  return units.filter((unit) => coveredBy(fileSegments, unit))
}

/** A resource file entry is covered by a unit: exact match for a file unit, or descendant of a directory unit. */
function coveredBy(fileSegments: readonly string[], unit: CoverageUnit): boolean {
  if (unit.isDirectory) {
    return segEqual(unit.segments, fileSegments) || isStrictPrefix(unit.segments, fileSegments)
  }
  return segEqual(unit.segments, fileSegments)
}

function assertFilesCovered(files: readonly NormalizedEntry[], units: readonly CoverageUnit[]): void {
  for (const file of files) {
    const fileSegments = keySegments(file.path)
    // Payloads are non-overlapping, so at most one unit can cover the file; we
    // require at least one, and assert exactly-one defensively.
    const covering = units.filter((unit) => coveredBy(fileSegments, unit))
    if (covering.length === 0) {
      throw new ArchiveAdmissionError('layout', `undeclared resource file: ${renderUntrustedName(file.path)}`)
    }
    if (covering.length > 1) {
      throw new ArchiveAdmissionError('layout', `ambiguously-covered resource file: ${renderUntrustedName(file.path)}`)
    }
  }
}

/** A directory entry must be structural: an ancestor of some unit, or inside a directory unit. */
function assertDirsStructural(dirs: readonly NormalizedEntry[], units: readonly CoverageUnit[]): void {
  for (const dir of dirs) {
    const dirSegments = keySegments(dir.path)
    const structural = units.some((unit) => {
      const ancestorOfUnit = isStrictPrefix(dirSegments, unit.segments) || segEqual(dirSegments, unit.segments)
      const withinDirUnit = unit.isDirectory && isStrictPrefix(unit.segments, dirSegments)
      return ancestorOfUnit || withinDirUnit
    })
    if (!structural) {
      throw new ArchiveAdmissionError('layout', `undeclared resource directory: ${renderUntrustedName(dir.path)}`)
    }
  }
}
