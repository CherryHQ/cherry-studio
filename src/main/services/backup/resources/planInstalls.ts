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

import { findCrossDeviceEndpoint, findUnsafeAncestor } from '@data/db/restore/pathSafety'
import type { SealedResourceInstallEntry } from '@data/db/restore/restoreJournalV2'

import type { AdmittedResource } from '../admission/verify'
import { ResourceInstallPlanError } from '../errors'
import { type BackupPlatform, isPathContainedIn } from '../portability/managedPathRebase'
import { type ResourcePathCandidate, type TargetState, validateResourcePaths } from '../resourcePaths'
import { BACKUP_RESOURCE_KINDS, type BackupResourceKind, RESOURCE_ROOT_BY_KIND, type ResourceRoots } from './adapters'

export interface PlanInstallsInput {
  /** Verified units from admission, still sitting in the admission staging tree. */
  readonly resources: readonly AdmittedResource[]
  readonly userDataPath: string
  /** Target-side managed roots; a unit outside all of them is never installed (§4). */
  readonly roots: ResourceRoots
  /** userData-relative directory the staged payloads will occupy once preparation moves them. */
  readonly stagingRelDir: string
  /** userData-relative tree this restore parks the targets it replaces in. */
  readonly asideRelDir: string
  readonly platform: BackupPlatform
}

export interface ResourceInstallPlan {
  readonly entries: readonly SealedResourceInstallEntry[]
  /** Units whose target does not exist yet — a plain install. */
  readonly install: number
  /** Units whose target exists and will be parked aside first (§6.3). */
  readonly replace: number
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
function asideRelPath(asideRelDir: string, index: number, livePath: string): string {
  return `${asideRelDir}/${index}-${livePath.split('/').pop()}`
}

export function planResourceInstalls(input: PlanInstallsInput): ResourceInstallPlan {
  const { resources, userDataPath, roots, stagingRelDir, asideRelDir, platform } = input

  // Every slot preboot will rename between, planned once and then proven — and
  // written into the journal — as one unit. Proving only the live target would
  // leave the two ends the pass moves FROM and TO unexamined: a staging tree or
  // an aside root on another filesystem fails with `EXDEV` mid-pass, after the
  // previous unit has already moved.
  const slots = resources.map((resource, index) => ({
    staging: `${stagingRelDir}/${resource.livePath}`,
    live: resource.livePath,
    aside: asideRelPath(asideRelDir, index, resource.livePath)
  }))

  const candidates: ResourcePathCandidate[] = resources.map((resource, index) => {
    const absolute = path.resolve(userDataPath, ...resource.livePath.split('/'))
    const unit = [slots[index].staging, slots[index].live, slots[index].aside]
    return {
      livePath: resource.livePath,
      resourceType: resource.resourceType,
      targetState: lstatTargetState(absolute),
      ancestorsSafe: unit.every((relative) => findUnsafeAncestor(userDataPath, relative) === null),
      containedInRegisteredRoot: containedInKindRoot(roots, resource.kind, absolute, platform),
      sameFilesystemAsRoot: findCrossDeviceEndpoint(userDataPath, unit) === null
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

  const entries: SealedResourceInstallEntry[] = resources.map((resource, index) => ({
    resourceType: resource.resourceType,
    ...slots[index],
    // Same index as its candidate by construction (one map over `resources`),
    // and the validator above already refused every state but these two — so
    // this is the target's proven state, not an inference from it.
    hadLive: candidates[index].targetState !== 'absent'
  }))
  const replace = entries.filter((entry) => entry.hadLive).length
  return { entries, install: entries.length - replace, replace }
}
