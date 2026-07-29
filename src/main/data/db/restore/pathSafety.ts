import fs from 'node:fs'
import path from 'node:path'

/**
 * The filesystem facts every restore operation must re-prove about a
 * userData-relative path before it renames it, or deletes it
 * (docs/references/backup/README.md §4, §6.3, §6.5).
 *
 * Both facts are about ANCESTORS rather than the node itself, because both
 * dangers live there: a symlinked ancestor makes a contained-looking relative
 * path resolve outside every registered root, and an ancestor on another
 * filesystem makes a rename fail with `EXDEV` at the worst possible moment —
 * after the previous unit has already moved.
 *
 * Nothing here is persisted. The journal carries relative paths only, and every
 * caller re-proves these facts against the CURRENT userData at the moment it
 * acts: a proof recorded at preparation time says nothing about the disk a
 * preboot pass, or an acknowledgement days later, actually finds (§6.6).
 */

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * The first EXISTING ancestor between `userData` and `relativePath` that is not
 * a plain directory, or `null` when every one of them is.
 *
 * The walk stops at the first absent ancestor: nothing below it exists either,
 * so nothing below it can redirect anything.
 */
export function findUnsafeAncestor(userData: string, relativePath: string): string | null {
  const segments = relativePath.split('/')
  segments.pop()
  let current = userData
  for (const segment of segments) {
    current = path.join(current, segment)
    const stats = lstatOrNull(current)
    if (stats === null) return null
    if (!stats.isDirectory() || stats.isSymbolicLink()) return segment
  }
  return null
}

/**
 * The closest existing directory on the way to `relativePath` — the directory a
 * rename into, or a delete of, that path actually acts in.
 */
export function nearestExistingAncestor(userData: string, relativePath: string): string {
  const segments = relativePath.split('/')
  segments.pop()
  let current = userData
  for (const segment of segments) {
    const next = path.join(current, segment)
    if (!fs.existsSync(next)) return current
    current = next
  }
  return current
}

/**
 * The first endpoint whose nearest existing ancestor is NOT on userData's
 * filesystem, or `null` when they all are.
 *
 * Rename eligibility is a property of the whole unit, not of one leg: a staging
 * tree on a bind mount lets `live → aside` succeed and `staged → live` fail, so
 * every endpoint the operation may touch is proven together, before any of them
 * moves.
 */
export function findCrossDeviceEndpoint(userData: string, relativePaths: readonly string[]): string | null {
  const userDataDevice = fs.statSync(userData).dev
  for (const relativePath of relativePaths) {
    if (fs.statSync(nearestExistingAncestor(userData, relativePath)).dev !== userDataDevice) return relativePath
  }
  return null
}
