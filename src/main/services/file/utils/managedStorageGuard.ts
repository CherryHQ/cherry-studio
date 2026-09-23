import path from 'node:path'

import { application } from '@application'
import { canonicalizePathForContainment, isSameOrInside } from '@main/utils/file'

function overlaps(a: string, b: string): boolean {
  return isSameOrInside(a, b) || isSameOrInside(b, a)
}

async function resolveManagedStorageRoots(): Promise<{ managedRoot: string; managedRealRoot: string }> {
  const managedRoot = path.resolve(application.getPath('feature.files.data'))
  const managedRealRoot = await canonicalizePathForContainment(managedRoot, { allowMissing: true })
  if (!managedRealRoot) throw new Error('Unable to resolve FileManager-owned storage safely')
  return { managedRoot, managedRealRoot }
}

async function resolveCandidateOutsideManagedStorage(
  candidate: string,
  { managedRoot, managedRealRoot }: { managedRoot: string; managedRealRoot: string }
): Promise<string> {
  const lexical = path.resolve(candidate)
  if (overlaps(lexical, managedRoot)) {
    throw new Error(`Raw path mutation overlaps FileManager-owned storage: ${candidate}`)
  }

  const physical = await canonicalizePathForContainment(lexical, { allowMissing: true })
  if (!physical) throw new Error(`Unable to resolve path safely for mutation: ${candidate}`)
  if (overlaps(physical, managedRealRoot)) {
    throw new Error(`Raw path mutation overlaps FileManager-owned storage: ${candidate}`)
  }
  return physical
}

/** Resolve a mutation target to the same physical path that passed the storage guard. */
export async function resolveOutsideManagedStorageMutation(candidate: string): Promise<string> {
  return resolveCandidateOutsideManagedStorage(candidate, await resolveManagedStorageRoots())
}

/**
 * Renderer-provided raw paths must never overlap FileManager-owned storage.
 *
 * Checks both lexical paths and real paths resolved through the nearest
 * existing parent so symlinks, not-yet-created destinations, and destructive
 * operations against an ancestor directory are all rejected. Ambiguous paths
 * fail closed instead of being treated as safe.
 */
export async function assertOutsideManagedStorageMutation(...candidates: string[]): Promise<void> {
  const roots = await resolveManagedStorageRoots()
  for (const candidate of candidates) await resolveCandidateOutsideManagedStorage(candidate, roots)
}
