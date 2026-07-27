import { stat, statfs } from 'node:fs/promises'
import path from 'node:path'

import { BACKUP_CEILINGS } from './ceilings'
import { InsufficientDiskSpaceError } from './errors'

/**
 * Disk-space preflight for the export producer (Phase 1b-i). Checks that a
 * target volume has room for the declared work PLUS the shared staging headroom
 * (`BACKUP_CEILINGS.minStagingDiskHeadroomBytes`) BEFORE any copy/archive, so a
 * disk-full surfaces as a clear {@link InsufficientDiskSpaceError} instead of a
 * mid-stream `ENOSPC` (which the publisher maps to `DiskFullError` as a backstop).
 *
 * `diskProbe.statfs` is a test seam so a full-disk condition can be simulated
 * without a real filesystem.
 */
export const diskProbe = {
  statfs(target: string): ReturnType<typeof statfs> {
    return statfs(target)
  }
}

/** Walk up to the nearest existing ancestor (the target file may not exist yet). */
async function nearestExisting(target: string): Promise<string> {
  let current = path.resolve(target)
  for (;;) {
    try {
      await stat(current)
      return current
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      const parent = path.dirname(current)
      if (parent === current) throw err
      current = parent
    }
  }
}

/**
 * Assert the volume backing `target` has at least `neededBytes + headroomBytes`
 * available. `neededBytes` is the caller's declared work for that volume (e.g.
 * total staged bytes, or archive size); `headroomBytes` defaults to the frozen
 * staging headroom ceiling.
 */
/**
 * A caller-supplied byte count must be a safe, non-negative integer — a bad
 * value (NaN/Infinity/negative/non-integer/too-large) is a CONTRACT violation,
 * not a disk condition, so it throws `RangeError` rather than fabricating an
 * `InsufficientDiskSpaceError` with NaN fields and a fake path.
 */
function requireSafeByteCount(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`assertDiskHeadroom: ${label} must be a non-negative safe integer, got ${value}`)
  }
}

export async function assertDiskHeadroom(args: {
  target: string
  neededBytes: number
  headroomBytes?: number
}): Promise<void> {
  const { target, neededBytes } = args
  const headroomBytes = args.headroomBytes ?? BACKUP_CEILINGS.minStagingDiskHeadroomBytes
  requireSafeByteCount('neededBytes', neededBytes)
  requireSafeByteCount('headroomBytes', headroomBytes)

  // Guard overflow: needed + headroom must remain an exact (safe-integer) sum,
  // else the `<` comparison would be unreliable.
  const required = neededBytes + headroomBytes
  if (!Number.isSafeInteger(required)) {
    throw new RangeError(`assertDiskHeadroom: neededBytes + headroomBytes overflows safe-integer range (${required})`)
  }

  const probe = await nearestExisting(target)
  const fsStat = await diskProbe.statfs(probe)
  // bavail = blocks available to an unprivileged process; bsize = block size.
  const available = Number(fsStat.bavail) * Number(fsStat.bsize)
  // A non-finite/negative statfs result is a filesystem/probe fault → unusable volume.
  if (!Number.isFinite(available) || available < 0) {
    throw new InsufficientDiskSpaceError({ needed: required, available: 0, path: target })
  }
  if (available < required) {
    throw new InsufficientDiskSpaceError({ needed: required, available, path: target })
  }
}
