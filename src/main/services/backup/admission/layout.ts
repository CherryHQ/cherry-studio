import { RESOURCES_PREFIX } from '../archiveLayout'
import { ArchiveAdmissionError, renderUntrustedName } from '../errors'
import type { BackupManifest, ResourcePayload } from '../manifest'
import { ResourceCoverageIndex } from '../resourceCoverageIndex'
import type { ArchiveShape, NormalizedEntry } from './catalog'

/**
 * Payload-layout classification for archive admission (Phase 1b-ii,
 * docs/references/backup/README.md §5.1). Runs AFTER the manifest is parsed —
 * it decides whether the archive's actual `resources/` entries agree with the
 * manifest's declared payload inventory. Pure over paths + the manifest; no I/O.
 *
 * It proves the "nothing undeclared / nothing overlapping" direction:
 * - every `resourcePayload` sits under `resources/`, is unique and
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

/** A declared payload as a coverage unit. */
export interface CoverageUnit {
  readonly payload: ResourcePayload
  readonly isDirectory: boolean
}

export function buildCoverageIndex(units: readonly CoverageUnit[]): ResourceCoverageIndex<CoverageUnit> {
  const built = ResourceCoverageIndex.build(units, (unit) => ({
    path: unit.payload.archivePath,
    isDirectory: unit.isDirectory
  }))
  if (!built.ok) {
    throw new ArchiveAdmissionError(
      'layout',
      `${built.conflict.kind} payloads: ${renderUntrustedName(built.conflict.existing.payload.archivePath)} and ${renderUntrustedName(built.conflict.incoming.payload.archivePath)}`
    )
  }
  return built.index
}

/**
 * Validate the resource layout against the manifest. Throws
 * {@link ArchiveAdmissionError} `layout` on any disagreement; returns the
 * coverage units for later verification.
 */
export function classifyPayloadLayout(shape: ArchiveShape, manifest: BackupManifest): readonly CoverageUnit[] {
  const units = buildUnits(manifest.resourcePayloads)
  const index = buildCoverageIndex(units)
  assertFilesCovered(shape.resourceFiles, index)
  assertDirsStructural(shape.resourceDirs, index)
  return units
}

/** Build coverage units, rejecting payloads outside the resource namespace. */
function buildUnits(payloads: readonly ResourcePayload[]): CoverageUnit[] {
  return payloads.map((payload) => {
    if (!payload.archivePath.startsWith(RESOURCES_PREFIX)) {
      throw new ArchiveAdmissionError(
        'layout',
        `payload archivePath not under resources/: ${renderUntrustedName(payload.archivePath)}`
      )
    }
    return { payload, isDirectory: payload.resourceType === 'directory' }
  })
}

function assertFilesCovered(files: readonly NormalizedEntry[], index: ResourceCoverageIndex<CoverageUnit>): void {
  for (const file of files) {
    if (index.covering(file.path) === null) {
      throw new ArchiveAdmissionError('layout', `undeclared resource file: ${renderUntrustedName(file.path)}`)
    }
  }
}

/** A directory entry must be structural: an ancestor of some unit, or inside a directory unit. */
function assertDirsStructural(dirs: readonly NormalizedEntry[], index: ResourceCoverageIndex<CoverageUnit>): void {
  for (const dir of dirs) {
    if (!index.isStructuralDirectory(dir.path)) {
      throw new ArchiveAdmissionError('layout', `undeclared resource directory: ${renderUntrustedName(dir.path)}`)
    }
  }
}
