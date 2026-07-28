/**
 * Turning admitted resource payloads into journal `resource-install` entries
 * (docs/references/backup/README.md §4, §6.3).
 *
 * This is the second of the two places the resource-path rules are enforced —
 * archive admission is the first — and it is the one that decides what preboot
 * will be allowed to rename. It computes the trusted filesystem facts
 * ({@link validateResourcePaths} deliberately performs no I/O) and refuses the
 * whole restore if ANY unit is not installable, because a partial install plan
 * would leave a restored database pointing at resources nobody promised to
 * deliver.
 *
 * Every path it emits is userData-relative so a userData relocation between
 * preparation and boot cannot strand the plan (§6.6).
 */

import fs from 'node:fs'
import path from 'node:path'

import type { ResourceInstallEntry } from '@data/db/restore/restoreJournalV2'

import type { AdmittedResource } from '../admission/verify'
import { type BackupPlatform, isPathContainedIn } from '../portability/managedPathRebase'
import { type ResourcePathCandidate, type TargetState, validateResourcePaths } from '../resourcePaths'
import { BACKUP_RESOURCE_KINDS, type BackupResourceKind, RESOURCE_ROOT_BY_KIND, type ResourceRoots } from './adapters'

export interface PlanInstallsInput {
  /** Verified units from admission, still sitting in the admission staging tree. */
  readonly resources: readonly AdmittedResource[]
  readonly userDataPath: string
  /** Target-side managed roots; a unit outside all of them is never installed (§4). */
  readonly roots: ResourceRoots
  readonly restoreId: string
  /** userData-relative directory the staged payloads will occupy once preparation moves them. */
  readonly stagingRelDir: string
  readonly platform: BackupPlatform
}

export interface ResourceInstallPlan {
  readonly entries: readonly ResourceInstallEntry[]
  /** Units whose target does not exist yet — a plain install. */
  readonly install: number
  /** Units whose target exists and will be parked aside first (§6.3). */
  readonly replace: number
}

/** Thrown when a unit cannot be installed. Preparation turns this into a refused restore. */
export class ResourceInstallPlanError extends Error {
  readonly code: string
  constructor(code: string, detail: string) {
    super(`resource cannot be installed (${code}): ${detail}`)
    this.name = 'ResourceInstallPlanError'
    this.code = code
  }
}

function lstatTargetState(absolute: string): TargetState {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
    throw error
  }
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  return 'special'
}

/**
 * Every EXISTING ancestor between userData and the target must be a real
 * directory. A symlinked ancestor would make the install land wherever it points
 * — outside every registered root and possibly outside the app entirely — while
 * still looking contained to a string check.
 */
function ancestorsSafe(userDataPath: string, livePath: string): boolean {
  const segments = livePath.split('/')
  segments.pop()
  let current = userDataPath
  for (const segment of segments) {
    current = path.join(current, segment)
    const state = lstatTargetState(current)
    if (state === 'absent') return true // nothing below it exists either
    if (state !== 'directory') return false
  }
  return true
}

/** The closest existing directory on the way to the target; where a rename would actually land. */
function nearestExistingAncestor(userDataPath: string, livePath: string): string {
  const segments = livePath.split('/')
  segments.pop()
  let current = userDataPath
  for (const segment of segments) {
    const next = path.join(current, segment)
    if (!fs.existsSync(next)) return current
    current = next
  }
  return current
}

/**
 * Containment in a registered `feature.*` root — the trust boundary for anything
 * this code may replace (§4). The root ITSELF is allowed because one unit (the
 * managed Notes tree) is the root, but nothing above a root ever is.
 */
function containedInKindRoot(roots: ResourceRoots, kind: string, absolute: string, platform: BackupPlatform): boolean {
  if (!(BACKUP_RESOURCE_KINDS as readonly string[]).includes(kind)) return false
  const root = roots[RESOURCE_ROOT_BY_KIND[kind as BackupResourceKind]]
  return root === absolute || isPathContainedIn(root, absolute, platform)
}

/**
 * Park slot for a replaced target, reserved per restore AND per unit. The index
 * prefix is what makes the slots pairwise distinct no matter how many units
 * share a basename; the basename is kept so a user looking inside can tell what
 * a parked node was.
 */
function asideRelPath(restoreId: string, index: number, livePath: string): string {
  return `restore-aside/${restoreId}/${index}-${livePath.split('/').pop()}`
}

export function planResourceInstalls(input: PlanInstallsInput): ResourceInstallPlan {
  const { resources, userDataPath, roots, restoreId, stagingRelDir, platform } = input

  // The rename destination for the parked target and for the payload are both
  // under userData, so one device comparison covers install AND park.
  const userDataDevice = fs.statSync(userDataPath).dev

  const candidates: ResourcePathCandidate[] = resources.map((resource) => {
    const absolute = path.resolve(userDataPath, ...resource.livePath.split('/'))
    return {
      livePath: resource.livePath,
      resourceType: resource.resourceType,
      targetState: lstatTargetState(absolute),
      ancestorsSafe: ancestorsSafe(userDataPath, resource.livePath),
      containedInRegisteredRoot: containedInKindRoot(roots, resource.kind, absolute, platform),
      sameFilesystemAsRoot: fs.statSync(nearestExistingAncestor(userDataPath, resource.livePath)).dev === userDataDevice
    }
  })

  const validation = validateResourcePaths(candidates)
  if (!validation.ok) {
    const violation = validation.violation
    throw new ResourceInstallPlanError(
      violation.code,
      'livePath' in violation ? violation.livePath : `${violation.count} entries`
    )
  }

  const entries = resources.map((resource, index) => ({
    resourceType: resource.resourceType,
    staging: `${stagingRelDir}/${resource.livePath}`,
    live: resource.livePath,
    aside: asideRelPath(restoreId, index, resource.livePath)
  }))
  const replace = candidates.filter((candidate) => candidate.targetState !== 'absent').length
  return { entries, install: entries.length - replace, replace }
}
