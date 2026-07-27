/**
 * Full-preset resource staging (docs/references/backup/README.md §1.7, §5.4).
 *
 * Turns the requirement inventory — what the exported database SAYS it needs —
 * into the payload inventory the archive actually carries. Each unit is copied
 * into the operation-owned staging tree through the shared drift-checked stagers,
 * so the archive can name the exact bytes it captured.
 *
 * The two failure modes are deliberately different (§1.7):
 *
 * - **Already not there at snapshot time** — absent, or a node that is not the
 *   declared kind (a symlink or a file where a managed directory belongs) — is a
 *   DEGRADATION. The profile is what it is; refusing to back up the other 5,000
 *   attachments because one is gone would leave the user with no backup at all.
 *   The "not the declared kind" reading matches `coverage.ts` on the restoring
 *   side, so both ends of a restore classify the same node identically.
 * - **Changing WHILE being staged** fails the export closed, because the archive
 *   could no longer prove which version it holds. That judgement lives in
 *   `sourceDrift.ts`; this module only propagates it.
 *
 * A payload's `archivePath` is its `livePath` under `resources/`, so the archive
 * mirrors the layout it will be installed into and payload distinctness follows
 * from destination distinctness — which is checked here, with the same collision
 * rules admission will re-apply.
 */

import fs from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

import { RESOURCES_PREFIX } from '../archiveLayout'
import { BACKUP_CEILINGS } from '../ceilings'
import { BackupCancelledError, CeilingExceededError } from '../errors'
import { hashDirectoryUnit } from '../hashing'
import type { BackupManifestDegradation, ResourcePayload, ResourceRequirement } from '../manifest'
import { validateResourcePathSet } from '../resourcePaths'
import { stageDirectoryWithDriftCheck, stageFileWithDriftCheck } from '../sourceDrift'

const logger = loggerService.withContext('backupStageResources')

/** Kinds whose unit root carries a rebuildable index that export excludes (§6.7). */
const KNOWLEDGE_KIND = 'knowledge-base'

export interface StageResourcesInput {
  /** The inventory the exported database produced; every entry is a candidate payload. */
  readonly requirements: readonly ResourceRequirement[]
  /** Producer userData root that each `livePath` is relative to. */
  readonly userDataPath: string
  /** Operation-owned directory the payloads are staged under (`resources/` in the archive). */
  readonly resourcesDir: string
  readonly signal?: AbortSignal
}

export interface StagedResources {
  readonly payloads: readonly ResourcePayload[]
  /** One entry per requirement this profile could not supply, for the manifest (§1.7). */
  readonly degradations: readonly BackupManifestDegradation[]
  /** True when at least one payload was staged, i.e. `resourcesDir` now has content. */
  readonly staged: boolean
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new BackupCancelledError('backup export cancelled')
}

function absoluteOf(userDataPath: string, livePath: string): string {
  return path.resolve(userDataPath, ...livePath.split('/'))
}

/**
 * Snapshot-time classification of one declared source. Anything other than a
 * real node of the declared type is "not here", with the reason kept for the
 * manifest so a degraded archive can never look complete.
 */
function classifySource(sourcePath: string, requirement: ResourceRequirement): { missing: string } | null {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(sourcePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { missing: 'absent at snapshot time' }
    }
    throw error
  }
  if (requirement.resourceType === 'file' ? stats.isFile() : stats.isDirectory()) {
    return null
  }
  return { missing: `not a ${requirement.resourceType} at snapshot time` }
}

export async function stageResources(input: StageResourcesInput): Promise<StagedResources> {
  const { requirements, userDataPath, resourcesDir, signal } = input
  throwIfAborted(signal)

  if (requirements.length > BACKUP_CEILINGS.maxResourceInstallEntries) {
    // Producing it would produce an archive no device could restore: the journal
    // schema and admission both cap install entries at the same number.
    throw new CeilingExceededError(
      'resource-entries',
      `${requirements.length} > ${BACKUP_CEILINGS.maxResourceInstallEntries}`
    )
  }

  const pathSet = validateResourcePathSet(requirements.map((requirement) => requirement.livePath))
  if (!pathSet.ok) {
    throw new Error(`resource payloads are not a legal install set: ${pathSet.violation.code}`)
  }

  const payloads: ResourcePayload[] = []
  const degradations: BackupManifestDegradation[] = []

  for (const requirement of requirements) {
    throwIfAborted(signal)
    const sourcePath = absoluteOf(userDataPath, requirement.livePath)
    const missing = classifySource(sourcePath, requirement)
    if (missing) {
      degradations.push({
        kind: `resource:${requirement.kind}`,
        livePath: requirement.livePath,
        reason: missing.missing
      })
      continue
    }

    const stagingPath = path.join(resourcesDir, ...requirement.livePath.split('/'))
    const staged =
      requirement.resourceType === 'file'
        ? await stageFileUnit(sourcePath, stagingPath, signal)
        : await stageDirectoryUnit(sourcePath, stagingPath, requirement.kind === KNOWLEDGE_KIND, signal)

    payloads.push({
      kind: requirement.kind,
      resourceType: requirement.resourceType,
      archivePath: `${RESOURCES_PREFIX}${requirement.livePath}`,
      livePath: requirement.livePath,
      hash: staged.hash,
      sizeBytes: staged.sizeBytes
    })
  }

  logger.info('Staged Full resource payloads', {
    payloads: payloads.length,
    degraded: degradations.length,
    bytes: payloads.reduce((sum, payload) => sum + payload.sizeBytes, 0)
  })
  return { payloads, degradations, staged: payloads.length > 0 }
}

async function stageFileUnit(
  sourcePath: string,
  stagingPath: string,
  signal: AbortSignal | undefined
): Promise<{ hash: string; sizeBytes: number }> {
  const staged = await stageFileWithDriftCheck({ sourcePath, stagingPath, signal })
  return { hash: staged.hash, sizeBytes: staged.size }
}

/**
 * A directory unit is content-addressed by the canonical unit hash over the
 * STAGED tree (§5.1.2) — the same digest admission recomputes over the extracted
 * tree, from the same scanner. Hashing the staged copy rather than the source
 * also means the hash describes exactly what the archive carries, including the
 * Knowledge index exclusion that staging already applied.
 */
async function stageDirectoryUnit(
  sourceDir: string,
  stagingDir: string,
  excludeKnowledgeDerivedIndex: boolean,
  signal: AbortSignal | undefined
): Promise<{ hash: string; sizeBytes: number }> {
  // The stager creates the unit root EXCLUSIVELY (ownership proof), so its
  // parent — and only its parent — is created here.
  await mkdir(path.dirname(stagingDir), { recursive: true })
  const staged = await stageDirectoryWithDriftCheck({ sourceDir, stagingDir, signal, excludeKnowledgeDerivedIndex })
  const { hash } = await hashDirectoryUnit(stagingDir, { signal })
  return { hash, sizeBytes: staged.files.reduce((sum, file) => sum + file.size, 0) }
}
