import { Base64 } from 'js-base64'
import * as z from 'zod'

import { assertMemoryTarget, MemoryError } from './files'
import { memoryId, digest, type MemoryBackupStorage, type MemoryStorage } from './storage'
export const MEMORY_BACKUP_BATCHES = 5
export const MEMORY_BACKUP_BYTES = 20 * 1024 * 1024

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const hashSchema = digestSchema.nullable()
const stepSchema = z.strictObject({
  path: z.string(),
  before: z.string().nullable(),
  beforeHash: hashSchema,
  afterHash: hashSchema,
  controlledSaveAt: z.number().int().nonnegative().optional(),
  outcome: z.enum(['pending', 'applied', 'unchanged', 'conflict'])
})
const batchSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  createdAt: z.number().int().nonnegative(),
  source: z.enum(['controlled', 'dreaming', 'recovery', 'clear', 'migration', 'extraction']),
  status: z.enum(['pending', 'completed', 'partial']),
  legacy: z
    .strictObject({
      path: z.string().regex(/^memory\/fact\.md$/i),
      content: z.string(),
      hash: z.string().regex(/^[0-9a-f]{64}$/)
    })
    .optional(),
  recoveryOf: z.uuid().optional(),
  orderedRecovery: z.boolean().optional(),
  transferTargets: z.array(z.object({ path: z.string(), hash: hashSchema })).optional(),
  dependencies: z.array(z.object({ path: z.string(), hash: hashSchema })).optional(),
  undoClearScopeHash: digestSchema.optional(),
  clearScopeHash: digestSchema.optional(),
  steps: z.array(stepSchema)
})

export type MemoryBatch = z.infer<typeof batchSchema>
export type MemoryMutationSource = MemoryBatch['source']
export interface MemoryLegacyOriginal {
  path: string
  content: Uint8Array
}
export interface MemoryFileChange {
  controlledSaveAt?: number
  transferTarget?: boolean
  path: string
  before: Uint8Array | null
  after: Uint8Array | null
}

interface StoredBatch {
  filename: string
  reservedBytes: number
  batch: MemoryBatch
}

function encodeBatch(batch: MemoryBatch): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(batch))
}

function reservedBatchBytes(batch: MemoryBatch): number {
  return encodeBatch({
    ...batch,
    status: 'completed',
    steps: batch.steps.map((step) => ({ ...step, outcome: 'unchanged' }))
  }).length
}

export function decodeOriginal(root: MemoryBackupStorage, step: MemoryBatch['steps'][number]): Uint8Array | null {
  const bytes = step.before === null ? null : Base64.toUint8Array(step.before)
  if ((bytes !== null && Base64.fromUint8Array(bytes) !== step.before) || digest(root, bytes) !== step.beforeHash) {
    throw new MemoryError('invalid-backup', 'Memory backup content does not match its recorded hash')
  }
  return bytes
}

async function storedBatches(root: MemoryBackupStorage): Promise<StoredBatch[]> {
  const batches: StoredBatch[] = []
  for (const filename of await root.list()) {
    if (!/^\d+-[0-9a-f-]{36}\.json$/.test(filename)) continue
    const bytes = await root.read(filename)
    if (!bytes || bytes.length > MEMORY_BACKUP_BYTES) {
      throw new MemoryError('invalid-backup', 'Memory backup manifest is missing or oversized')
    }
    const parsed = batchSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (!parsed.success) throw new MemoryError('invalid-backup', 'Memory backup manifest is invalid')
    const batch = parsed.data
    if (filename !== batchFilename(batch)) throw new MemoryError('invalid-backup', 'Memory backup identity mismatch')
    for (const step of batch.steps) {
      assertMemoryTarget(step.path)
      decodeOriginal(root, step)
    }
    if (batch.legacy) {
      const original = Base64.toUint8Array(batch.legacy.content)
      if (
        batch.source !== 'migration' ||
        Base64.fromUint8Array(original) !== batch.legacy.content ||
        digest(root, original) !== batch.legacy.hash
      )
        throw new MemoryError('invalid-backup', 'Legacy memory backup content does not match its hash')
    }
    batches.push({ filename, reservedBytes: Math.max(bytes.length, reservedBatchBytes(batch)), batch })
  }
  batches.sort(
    (left, right) => left.batch.createdAt - right.batch.createdAt || left.filename.localeCompare(right.filename)
  )
  // Older reverse manifests can inherit provenance while the matching parent is still on disk.
  for (const { batch } of batches) {
    if (batch.source !== 'recovery' || !batch.recoveryOf) continue
    const parent = batches.find((item) => item.batch.id === batch.recoveryOf)?.batch
    if (!parent) continue
    inheritControlledSaveTimes(parent, batch)
    if (!batch.clearScopeHash && !batch.undoClearScopeHash && batch.steps.every((step) => step.outcome === 'applied'))
      inheritClearDirection(parent, batch)
  }
  for (const item of batches) item.reservedBytes = Math.max(item.reservedBytes, reservedBatchBytes(item.batch))
  return batches
}

export function controlledSaveTime(batch: MemoryBatch, step: MemoryBatch['steps'][number]): number | undefined {
  if (batch.source === 'controlled') return batch.createdAt
  return batch.source === 'recovery' && batch.recoveryOf ? step.controlledSaveAt : undefined
}

function inheritControlledSaveTimes(parent: MemoryBatch, reverse: MemoryBatch): void {
  const originals = new Map(parent.steps.map((step) => [step.path, step]))
  for (const step of reverse.steps) {
    if (step.controlledSaveAt !== undefined) continue
    const original = originals.get(step.path)
    if (
      original?.outcome === 'applied' &&
      step.beforeHash === original.afterHash &&
      step.afterHash === original.beforeHash
    )
      step.controlledSaveAt = controlledSaveTime(parent, original)
  }
}

function inheritClearDirection(parent: MemoryBatch, reverse: MemoryBatch): void {
  if ((!parent.clearScopeHash && !parent.undoClearScopeHash) || parent.steps.length !== reverse.steps.length) return
  const exactInverse = parent.steps.every(
    (step) =>
      step.outcome === 'applied' &&
      reverse.steps.some(
        (other) =>
          other.path === step.path && other.beforeHash === step.afterHash && other.afterHash === step.beforeHash
      )
  )
  if (exactInverse) {
    reverse.undoClearScopeHash = parent.clearScopeHash
    reverse.clearScopeHash = parent.undoClearScopeHash
  }
}

export function hasOrderedRecovery(batch: MemoryBatch): boolean {
  if (batch.orderedRecovery !== undefined) return batch.orderedRecovery
  if (batch.source === 'dreaming') return batch.steps.some((step) => step.afterHash === null)
  // Older reverse manifests contain the transfer steps but do not name their dependency.
  return batch.source === 'recovery' && batch.steps.some((step) => step.beforeHash === null || step.afterHash === null)
}

function batchFilename(batch: MemoryBatch): string {
  return `${batch.createdAt}-${batch.id}.json`
}

function needsRecoveryPredecessor(parent: MemoryBatch, reverse: MemoryBatch): boolean {
  return parent.steps.some(
    (step) =>
      step.outcome !== 'unchanged' &&
      !reverse.steps.some((saved) => saved.path === step.path && saved.beforeHash === step.afterHash)
  )
}

export function hasCompletedRecovery(parent: MemoryBatch, child: MemoryBatch): boolean {
  return (
    child.recoveryOf === parent.id &&
    parent.steps.every(
      (step) =>
        step.outcome === 'unchanged' ||
        child.steps.some(
          (reverse) =>
            reverse.path === step.path && reverse.outcome === 'applied' && reverse.beforeHash === step.afterHash
        )
    )
  )
}

/** The scope owner holds its write lock throughout admission, mutation, and manifest updates. */
export async function createMemoryBackup(
  root: MemoryBackupStorage,
  changes: readonly MemoryFileChange[],
  source: MemoryMutationSource,
  options: {
    legacy?: MemoryLegacyOriginal
    clearScopeHash?: string
    reverseProof?: { clearScopeHash?: string; undoClearScopeHash?: string }
    recoveryOf?: string
    activeRoot?: MemoryStorage
    transferTargets?: MemoryBatch['transferTargets']
    preview?: boolean
    confirmed?: readonly MemoryFileChange[]
  } = {}
): Promise<MemoryBatch> {
  const { legacy, clearScopeHash, recoveryOf, activeRoot, transferTargets, confirmed = [] } = options
  if (legacy && (source !== 'migration' || !/^memory\/fact\.md$/i.test(legacy.path)))
    throw new MemoryError('invalid-backup', 'Legacy originals belong only to FACT migration backups')
  const existing = await storedBatches(root)
  if (activeRoot) {
    for (const item of existing) await reconcileMemoryBackup(root, activeRoot, item.batch, { keepUnreadable: true })
    for (const { batch: child } of existing) {
      if (!child.recoveryOf) continue
      const parent = existing.find((item) => item.batch.id === child.recoveryOf)?.batch
      if (parent?.status !== 'partial') continue
      if (hasCompletedRecovery(parent, child)) {
        parent.status = 'completed'
        await saveMemoryBackup(root, parent)
      }
    }
  }
  const reverse = recoveryOf ? existing.findLast((item) => item.batch.recoveryOf === recoveryOf) : undefined
  const parent = recoveryOf ? existing.find((item) => item.batch.id === recoveryOf)?.batch : undefined
  const protectedIds = new Set([recoveryOf, reverse?.batch.id])
  // Only the newest usable operation can be selected. If its result is uncertain,
  // also retain earlier candidates until one has a confirmed write.
  for (const { batch: candidate } of existing.toReversed()) {
    if (candidate.steps.every((step) => step.outcome === 'unchanged')) continue
    protectedIds.add(candidate.id)
    if (candidate.recoveryOf) {
      const original = existing.find((item) => item.batch.id === candidate.recoveryOf)?.batch
      if (original?.status === 'partial') {
        protectedIds.add(original.id)
        if (original.id !== recoveryOf && needsRecoveryPredecessor(original, candidate))
          protectedIds.add(original.recoveryOf)
      }
    }
    if (candidate.steps.some((step) => step.outcome === 'applied')) break
  }
  const batch: MemoryBatch = reverse?.batch ?? {
    version: 1,
    id: memoryId(root),
    createdAt: Math.max(root.now(), (existing.at(-1)?.batch.createdAt ?? 0) + 1),
    source,
    status: 'pending',
    clearScopeHash,
    recoveryOf,
    transferTargets: transferTargets?.length ? transferTargets : undefined,
    orderedRecovery: parent && hasOrderedRecovery(parent),
    dependencies:
      parent && hasOrderedRecovery(parent)
        ? [
            ...(parent.transferTargets ?? []),
            ...(parent.dependencies ?? []).filter((dep) => !parent.steps.some((step) => step.path === dep.path)),
            ...parent.steps.map((step) => ({
              path: step.path,
              hash: step.outcome === 'unchanged' ? step.beforeHash : step.afterHash
            }))
          ]
        : undefined,
    ...(legacy
      ? {
          legacy: {
            path: legacy.path,
            content: Base64.fromUint8Array(legacy.content),
            hash: digest(root, legacy.content)
          }
        }
      : {}),
    steps: []
  }
  batch.status = 'pending'
  const steps = new Map(batch.steps.map((step) => [step.path, step]))
  for (const change of [...changes, ...confirmed]) {
    const beforeHash = digest(root, change.before)
    const afterHash = digest(root, change.after)
    const previous = steps.get(change.path)
    if (previous) {
      if (previous.beforeHash !== beforeHash || previous.afterHash !== afterHash)
        throw new MemoryError('conflict', 'Recovery target differs from its reverse backup')
      previous.outcome = confirmed.includes(change) ? 'applied' : 'pending'
    } else {
      batch.steps.push({
        path: change.path,
        before: change.before === null ? null : Base64.fromUint8Array(change.before),
        beforeHash,
        afterHash,
        outcome: confirmed.includes(change) ? 'applied' : 'pending'
      })
    }
  }
  if (parent?.recoveryOf && needsRecoveryPredecessor(parent, batch)) protectedIds.add(parent.recoveryOf)
  if (parent) {
    inheritControlledSaveTimes(parent, batch)
    inheritClearDirection(parent, batch)
  }
  if (options.reverseProof) Object.assign(batch, options.reverseProof)
  if (parent && hasOrderedRecovery(parent)) {
    const order = new Map(parent.steps.toReversed().map((step, index) => [step.path, index]))
    batch.steps.sort((left, right) => order.get(left.path)! - order.get(right.path)!)
  }
  if (confirmed.length && !changes.length) batch.status = memoryBatchStatus(batch)
  let bytes =
    existing.reduce((total, item) => total + item.reservedBytes, 0) +
    reservedBatchBytes(batch) -
    (reverse?.reservedBytes ?? 0)
  let count = existing.length + (reverse ? 0 : 1)
  const removable = existing.filter(
    (item) => item.batch.steps.every((step) => step.outcome !== 'pending') && !protectedIds.has(item.batch.id)
  )
  const prune: StoredBatch[] = []
  for (const item of removable) {
    if (count <= MEMORY_BACKUP_BATCHES && bytes <= MEMORY_BACKUP_BYTES) break
    prune.push(item)
    count--
    bytes -= item.reservedBytes
  }
  if (count > MEMORY_BACKUP_BATCHES || bytes > MEMORY_BACKUP_BYTES) {
    throw new MemoryError(
      'backup-capacity',
      'Protected recovery data and the required backup exceed the memory backup limit'
    )
  }
  if (
    parent?.recoveryOf &&
    prune.some((item) => item.batch.id === parent.recoveryOf) &&
    bytes + prune.reduce((total, item) => total + item.reservedBytes, 0) > MEMORY_BACKUP_BYTES
  )
    throw new MemoryError('backup-capacity', 'Insufficient space for safe recovery handoff')
  if (options.preview) return batch
  const handoff = prune.filter((item) => item.batch.id === parent?.recoveryOf)
  for (const item of prune) if (!handoff.includes(item)) await root.remove(item.filename)
  await saveMemoryBackup(root, batch)
  if (handoff.length) {
    const saved = await root.read(batchFilename(batch))
    if (!saved || digest(root, saved) !== digest(root, encodeBatch(batch)))
      throw new MemoryError('invalid-backup', 'Replacement backup was not persisted')
    for (const item of handoff) await root.remove(item.filename)
  }
  return batch
}

export async function saveMemoryBackup(root: MemoryBackupStorage, batch: MemoryBatch): Promise<void> {
  await root.write(batchFilename(batch), encodeBatch(batch))
}

export async function latestMemoryBackup(root: MemoryBackupStorage, id?: string): Promise<MemoryBatch | undefined> {
  const stored = await storedBatches(root)
  if (id) return stored.find((item) => item.batch.id === id)?.batch
  return stored.findLast((item) => item.batch.steps.some((step) => step.outcome !== 'unchanged'))?.batch
}

export async function findLegacyMemoryBackup(root: MemoryBackupStorage, hash: string): Promise<string | undefined> {
  const stored = await storedBatches(root)
  return stored.findLast((item) => item.batch.source === 'migration' && item.batch.legacy?.hash === hash)?.batch.id
}

export function memoryBatchStatus(batch: MemoryBatch): MemoryBatch['status'] {
  if (batch.steps.some((step) => step.outcome === 'pending')) return 'pending'
  if (
    batch.steps.some((step) => step.outcome === 'conflict') ||
    (batch.steps.some((step) => step.outcome === 'applied') && batch.steps.some((step) => step.outcome === 'unchanged'))
  )
    return 'partial'
  return 'completed'
}

export async function reconcileMemoryBackup(
  root: MemoryBackupStorage,
  activeRoot: MemoryStorage,
  batch: MemoryBatch,
  options: { keepUnreadable?: boolean } = {}
): Promise<MemoryBatch> {
  let changed = false
  for (const step of batch.steps) {
    if (step.outcome !== 'pending') continue
    let actualHash: string | null
    try {
      actualHash = digest(root, await activeRoot.read(step.path, 20 * 1024 * 1024))
    } catch (error) {
      if (options.keepUnreadable) continue
      throw error
    }
    changed = true
    step.outcome =
      actualHash === step.afterHash && (await activeRoot.applied(batch.id, step.path))
        ? 'applied'
        : actualHash === step.beforeHash
          ? 'unchanged'
          : 'conflict'
  }
  if (!changed) return batch
  batch.status = memoryBatchStatus(batch)
  await saveMemoryBackup(root, batch)
  return batch
}
