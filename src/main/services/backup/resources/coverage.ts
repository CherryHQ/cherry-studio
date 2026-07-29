/**
 * Existence coverage of a database's resource references on THIS device
 * (docs/references/backup/README.md §2).
 *
 * Coverage answers exactly one question — "will this device have the files the
 * database points at" — and it is the ONE place existence checking is both
 * correct and required. Everything else in Backup v2 derives requirements from
 * rows alone. It makes no content-equality claim and never hashes a target.
 *
 * Two callers share it deliberately: restore preparation, which reports what a
 * restore would find, and the post-promotion disclosure, which reports what it
 * actually found. A second existence rule would let those two disagree about
 * the same device.
 */

import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'

import type { ResourceRequirement } from '../manifest'
import { REBUILDABLE_RESOURCE_KINDS } from './adapters'
import type { ResourceInventory } from './collectRequirements'

/**
 * Every requirement lands in EXACTLY ONE of `available`, `rebuildable`, and
 * `missing` — the three partition the inventory, so `available + rebuildable +
 * missing === requirements.length` always holds. `unverifiable` is not part of
 * that partition: it counts database references that are not requirements at all
 * (§4), which is why it can be non-zero with an empty inventory.
 */
export interface ResourceCoverage {
  /** The declared path exists with the declared type, ready to use as-is. */
  readonly available: number
  /**
   * Present, but its usable state is derived and excluded from the archive, so
   * its owner rebuilds it after restore (§2, §6.7) — today the Knowledge bases,
   * which ship raw material without their index.
   */
  readonly rebuildable: number
  /** Absent, or present with the wrong type (a file where a directory belongs). */
  readonly missing: number
  /** External user paths the archive can never own, so no claim is possible (§4). */
  readonly unverifiable: number
}

export interface CoverageReport {
  readonly coverage: ResourceCoverage
  /** The requirements this device satisfies, in inventory order. */
  readonly present: readonly ResourceRequirement[]
}

export interface MeasureCoverageInput {
  /** What the database declares it needs — see `collectRequirements.ts`. */
  readonly inventory: ResourceInventory
  readonly userDataPath?: string
}

/**
 * `lstat` rather than `stat`: a symlink standing where a managed resource
 * belongs is not that resource, and following it would report content Cherry
 * does not own as available. A wrong-typed entry counts as missing for the same
 * reason — the database cannot use it.
 */
export function measureResourceCoverage(input: MeasureCoverageInput): CoverageReport {
  const userDataPath = input.userDataPath ?? application.getPath('app.userdata')
  const { inventory } = input
  const present: ResourceRequirement[] = []
  let missing = 0
  let rebuildable = 0

  for (const requirement of inventory.requirements) {
    let stats: fs.Stats
    try {
      stats = fs.lstatSync(path.resolve(userDataPath, requirement.livePath))
    } catch {
      missing++
      continue
    }
    if (requirement.resourceType === 'file' ? stats.isFile() : stats.isDirectory()) {
      present.push(requirement)
      // `present` stays the whole satisfied set — the install plan needs every
      // one of them; only the REPORTED bucket splits.
      if (REBUILDABLE_RESOURCE_KINDS.has(requirement.kind)) rebuildable++
    } else {
      missing++
    }
  }

  const unverifiable = Object.values(inventory.unverifiableByKind).reduce((sum, count) => sum + count, 0)
  return {
    coverage: { available: present.length - rebuildable, rebuildable, missing, unverifiable },
    present
  }
}
