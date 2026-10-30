import { randomUUID } from 'node:crypto'
import { readdir, unlink } from 'node:fs/promises'

import * as z from 'zod'

import {
  assertMemoryPath,
  assertMemoryTarget,
  MemoryError,
  memoryHash,
  readMemoryBytes,
  writeMemoryBytes
} from './memoryFiles'

export const MEMORY_BACKUP_BATCHES = 5
export const MEMORY_BACKUP_BYTES = 20 * 1024 * 1024

const hashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .nullable()
const stepSchema = z.strictObject({
  path: z.string(),
  before: z.string().nullable(),
  beforeHash: hashSchema,
  afterHash: hashSchema,
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
  steps: z.array(stepSchema)
})

export type MemoryBatch = z.infer<typeof batchSchema>
export type MemoryMutationSource = MemoryBatch['source']
export interface MemoryLegacyOriginal {
  path: string
  content: Buffer
}
export interface MemoryFileChange {
  path: string
  before: Buffer | null
  after: Buffer | null
}

interface StoredBatch {
  filename: string
  reservedBytes: number
  batch: MemoryBatch
}

function encodeBatch(batch: MemoryBatch): Buffer {
  return Buffer.from(JSON.stringify(batch))
}

function reservedBatchBytes(batch: MemoryBatch): number {
  return encodeBatch({
    ...batch,
    status: 'completed',
    steps: batch.steps.map((step) => ({ ...step, outcome: 'unchanged' }))
  }).length
}

export function decodeOriginal(step: MemoryBatch['steps'][number]): Buffer | null {
  const bytes = step.before === null ? null : Buffer.from(step.before, 'base64')
  if ((bytes !== null && bytes.toString('base64') !== step.before) || memoryHash(bytes) !== step.beforeHash) {
    throw new MemoryError('invalid-backup', 'Memory backup content does not match its recorded hash')
  }
  return bytes
}

async function storedBatches(root: string): Promise<StoredBatch[]> {
  await assertMemoryPath(root, '')
  const batches: StoredBatch[] = []
  for (const filename of await readdir(root)) {
    if (!/^\d+-[0-9a-f-]{36}\.json$/.test(filename)) continue
    const bytes = await readMemoryBytes(root, filename)
    if (!bytes || bytes.length > MEMORY_BACKUP_BYTES) {
      throw new MemoryError('invalid-backup', 'Memory backup manifest is missing or oversized')
    }
    const parsed = batchSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    if (!parsed.success) throw new MemoryError('invalid-backup', 'Memory backup manifest is invalid')
    const batch = parsed.data
    if (filename !== batchFilename(batch)) throw new MemoryError('invalid-backup', 'Memory backup identity mismatch')
    for (const step of batch.steps) {
      assertMemoryTarget(step.path)
      decodeOriginal(step)
    }
    if (batch.legacy) {
      const original = Buffer.from(batch.legacy.content, 'base64')
      if (
        batch.source !== 'migration' ||
        original.toString('base64') !== batch.legacy.content ||
        memoryHash(original) !== batch.legacy.hash
      )
        throw new MemoryError('invalid-backup', 'Legacy memory backup content does not match its hash')
    }
    batches.push({ filename, reservedBytes: Math.max(bytes.length, reservedBatchBytes(batch)), batch })
  }
  return batches.sort(
    (left, right) => left.batch.createdAt - right.batch.createdAt || left.filename.localeCompare(right.filename)
  )
}

function batchFilename(batch: MemoryBatch): string {
  return `${batch.createdAt}-${batch.id}.json`
}

/** The scope owner holds its write lock throughout admission, mutation, and manifest updates. */
export async function createMemoryBackup(
  root: string,
  changes: readonly MemoryFileChange[],
  source: MemoryMutationSource,
  legacy?: MemoryLegacyOriginal
): Promise<MemoryBatch> {
  if (legacy && (source !== 'migration' || !/^memory\/fact\.md$/i.test(legacy.path)))
    throw new MemoryError('invalid-backup', 'Legacy originals belong only to FACT migration backups')
  const existing = await storedBatches(root)
  const batch: MemoryBatch = {
    version: 1,
    id: randomUUID(),
    createdAt: Math.max(Date.now(), (existing.at(-1)?.batch.createdAt ?? 0) + 1),
    source,
    status: 'pending',
    ...(legacy
      ? { legacy: { path: legacy.path, content: legacy.content.toString('base64'), hash: memoryHash(legacy.content)! } }
      : {}),
    steps: changes.map((change) => ({
      path: change.path,
      before: change.before?.toString('base64') ?? null,
      beforeHash: memoryHash(change.before),
      afterHash: memoryHash(change.after),
      outcome: 'pending'
    }))
  }
  // Retain metadata growth reservations for existing partial/pending batches too.
  let bytes = existing.reduce((total, item) => total + item.reservedBytes, 0) + reservedBatchBytes(batch)
  let count = existing.length + 1
  const latest = existing.findLast((item) => item.batch.steps.some((step) => step.outcome !== 'unchanged'))
  const removable = existing.filter((item) => item.batch.status === 'completed' && item !== latest)
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
  for (const item of prune) await unlink(await assertMemoryPath(root, item.filename))
  await saveMemoryBackup(root, batch)
  return batch
}

export async function saveMemoryBackup(root: string, batch: MemoryBatch): Promise<void> {
  await writeMemoryBytes(root, batchFilename(batch), encodeBatch(batch))
}

export async function latestMemoryBackup(root: string): Promise<MemoryBatch | undefined> {
  const stored = await storedBatches(root)
  return stored.findLast((item) => item.batch.steps.some((step) => step.outcome !== 'unchanged'))?.batch
}

export async function findLegacyMemoryBackup(root: string, hash: string): Promise<string | undefined> {
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
  root: string,
  activeRoot: string,
  batch: MemoryBatch
): Promise<MemoryBatch> {
  if (!batch.steps.some((step) => step.outcome === 'pending')) return batch
  for (const step of batch.steps) {
    if (step.outcome !== 'pending') continue
    const actualHash = memoryHash(await readMemoryBytes(activeRoot, step.path))
    step.outcome = actualHash === step.afterHash ? 'applied' : actualHash === step.beforeHash ? 'unchanged' : 'conflict'
  }
  batch.status = memoryBatchStatus(batch)
  await saveMemoryBackup(root, batch)
  return batch
}
