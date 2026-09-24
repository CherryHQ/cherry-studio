/**
 * Read-only byte estimate of what staging the requirement inventory will copy,
 * so the export can preflight the staging volume BEFORE the copy rather than
 * discover a full disk halfway through it.
 *
 * Deliberately lenient: a source that is missing, unreadable, non-portable, or
 * over a ceiling contributes 0 here. Staging is the stage that decides what
 * each of those means (a degradation or a refusal); this only sizes the bytes
 * it can see, through the same scanner and capture policy staging will use.
 */

import { lstat } from 'node:fs/promises'
import path from 'node:path'

import { scanDirectoryUnit } from '../dirScan'
import { BackupCancelledError } from '../errors'
import type { ResourceRequirement } from '../manifest'
import { capturePolicyForKind, type ResourceRoots } from './adapters'

export interface MeasureRequirementBytesInput {
  readonly requirements: readonly ResourceRequirement[]
  readonly userDataPath: string
  readonly roots?: ResourceRoots
  readonly signal?: AbortSignal
}

export async function measureRequirementBytes(input: MeasureRequirementBytesInput): Promise<number> {
  const { requirements, userDataPath, roots, signal } = input
  let total = 0n
  for (const requirement of requirements) {
    if (signal?.aborted) throw new BackupCancelledError('backup export cancelled')
    const sourcePath = path.resolve(userDataPath, ...requirement.livePath.split('/'))
    try {
      const stats = await lstat(sourcePath, { bigint: true })
      if (requirement.resourceType === 'file') {
        if (stats.isFile()) total += stats.size
        continue
      }
      if (!stats.isDirectory()) continue
      const scan = await scanDirectoryUnit(sourcePath, {
        signal,
        capturePolicy: capturePolicyForKind(requirement.kind, roots),
        mode: 'capture'
      })
      total += scan.totalBytes
    } catch (error) {
      if (error instanceof BackupCancelledError) throw error
    }
  }
  return Number(total)
}
