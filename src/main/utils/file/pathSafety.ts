import fs from 'node:fs'
import { lstat, rm } from 'node:fs/promises'
import path from 'node:path'

export type PathNodeType = 'file' | 'directory' | 'symlink' | 'special'

/** Stable node identity for ownership checks; deliberately excludes drift metadata. */
export interface PathIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly nodeType: PathNodeType
}

export type PathProbe = { readonly kind: 'missing' } | { readonly kind: 'present'; readonly identity: PathIdentity }

function nodeTypeOf(stats: fs.Stats | fs.BigIntStats): PathNodeType {
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  return 'special'
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Link-aware path probe that never follows the final node. */
export async function probePath(target: string): Promise<PathProbe> {
  try {
    const stats = await lstat(target, { bigint: true })
    return {
      kind: 'present',
      identity: { dev: stats.dev, ino: stats.ino, nodeType: nodeTypeOf(stats) }
    }
  } catch (error) {
    if (isMissing(error)) return { kind: 'missing' }
    throw error
  }
}

/** Synchronous counterpart of {@link probePath}. */
export function probePathSync(target: string): PathProbe {
  try {
    const stats = fs.lstatSync(target, { bigint: true })
    return {
      kind: 'present',
      identity: { dev: stats.dev, ino: stats.ino, nodeType: nodeTypeOf(stats) }
    }
  } catch (error) {
    if (isMissing(error)) return { kind: 'missing' }
    throw error
  }
}

function identitiesEqual(left: PathIdentity, right: PathIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.nodeType === right.nodeType
}

/**
 * Remove an operation-owned directory only while its current type and identity
 * still match the identity captured when ownership began.
 */
export async function removeOwnedDirectory(target: string, expectedIdentity: PathIdentity): Promise<boolean> {
  if (expectedIdentity.nodeType !== 'directory') {
    throw new Error('owned path identity is not a directory')
  }
  const current = await probePath(target)
  if (current.kind === 'missing') return false
  if (!identitiesEqual(current.identity, expectedIdentity)) {
    throw new Error('owned directory identity changed')
  }
  await rm(target, { recursive: true, force: true })
  return true
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

/**
 * The first existing ancestor below `root` that is not a plain directory.
 * Stops at the first absent ancestor because no lower path can exist.
 */
export function findUnsafeAncestor(root: string, relativePath: string): string | null {
  const segments = relativePath.split('/')
  segments.pop()
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stats = lstatOrNull(current)
    if (stats === null) return null
    if (!stats.isDirectory() || stats.isSymbolicLink()) return segment
  }
  return null
}

function nearestExistingAncestor(root: string, relativePath: string): string {
  const segments = relativePath.split('/')
  segments.pop()
  let current = root
  for (const segment of segments) {
    const next = path.join(current, segment)
    if (!fs.existsSync(next)) return current
    current = next
  }
  return current
}

/**
 * Return the first endpoint whose closest existing parent is on another
 * device, or `null` when all rename endpoints share `root`'s device.
 */
export function findCrossDeviceEndpoint(root: string, relativePaths: readonly string[]): string | null {
  const rootDevice = fs.statSync(root).dev
  for (const relativePath of relativePaths) {
    if (fs.statSync(nearestExistingAncestor(root, relativePath)).dev !== rootDevice) return relativePath
  }
  return null
}
