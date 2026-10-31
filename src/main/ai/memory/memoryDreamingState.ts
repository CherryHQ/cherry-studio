import { eq, like } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { MemoryDreamingStatusSchema, MemoryScopeSchema, type MemoryScope } from '@shared/types/memory'

import {
  assertMemoryTarget,
  MEMORY_ENTRY,
  MEMORY_WARNING_BYTES,
  MEMORY_WARNING_LINES,
  memoryLineCount
} from './memoryFiles'
import type { MemoryRead } from './MemoryStore'

const fingerprint = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .nullable()
const fileSchema = z.strictObject({
  observedHash: fingerprint,
  processedHash: fingerprint.optional(),
  processedAt: z.number().optional(),
  pendingSince: z.number().optional(),
  changes: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  retryAt: z.number(),
  reason: MemoryDreamingStatusSchema.shape.reason,
  warning: z.boolean()
})
const stateSchema = z.strictObject({
  version: z.literal(1),
  scope: MemoryScopeSchema,
  generation: z.number().int().nonnegative(),
  files: z.record(z.string(), fileSchema),
  cursor: z.string(),
  manual: z.boolean(),
  manualAttempts: z.number().int().nonnegative(),
  cancelled: z.boolean(),
  lastScanAt: z.number(),
  lastRunAt: z.number().optional(),
  lastResult: MemoryDreamingStatusSchema.shape.lastResult,
  status: MemoryDreamingStatusSchema.shape.status,
  reason: MemoryDreamingStatusSchema.shape.reason
})
export type DreamingState = z.infer<typeof stateSchema>
export type DreamingFileState = z.infer<typeof fileSchema>

export function memoryScopeKey(scope: MemoryScope): string {
  return scope.kind === 'shared' ? 'shared' : `agent/${scope.agentId}`
}

function parseState(value: unknown): DreamingState {
  const state = stateSchema.parse(value)
  for (const target of Object.keys(state.files)) assertMemoryTarget(target)
  return state
}

/** This module owns the entire prefix; no body or model output is persisted here. */
export function readDreamingStates(): DreamingState[] {
  return application
    .get('DbService')
    .getDb()
    .select()
    .from(appStateTable)
    .where(like(appStateTable.key, 'memory:dreaming:%'))
    .all()
    .map((row) => parseState(row.value))
}

export function readDreamingState(scope: MemoryScope): DreamingState {
  const row = application
    .get('DbService')
    .getDb()
    .select()
    .from(appStateTable)
    .where(eq(appStateTable.key, `memory:dreaming:${memoryScopeKey(scope)}`))
    .get()
  if (row) {
    const state = parseState(row.value)
    if (memoryScopeKey(state.scope) !== memoryScopeKey(scope)) throw new Error('Memory progress scope mismatch')
    return state
  }
  return {
    version: 1,
    scope,
    generation: 0,
    files: {},
    cursor: '',
    manual: false,
    manualAttempts: 0,
    cancelled: false,
    lastScanAt: 0,
    status: 'idle'
  }
}

export function writeDreamingState(state: DreamingState): void {
  application
    .get('DbService')
    .getDb()
    .insert(appStateTable)
    .values({
      key: `memory:dreaming:${memoryScopeKey(state.scope)}`,
      value: state,
      description: 'Memory organization progress; hashes and counters only'
    })
    .onConflictDoUpdate({ target: appStateTable.key, set: { value: state, updatedAt: Date.now() } })
    .run()
}

export function observeMemory(
  state: DreamingState,
  read: Pick<MemoryRead, 'path' | 'hash' | 'content'>,
  now: number
): DreamingFileState {
  const previous = state.files[read.path]
  const changed = !previous || previous.observedHash !== read.hash
  const file: DreamingFileState = previous ?? {
    observedHash: read.hash,
    changes: 0,
    revision: 0,
    attempts: 0,
    retryAt: 0,
    warning: false
  }
  if (changed) {
    file.observedHash = read.hash
    file.revision++
    file.attempts = 0
    file.retryAt = 0
    file.reason = undefined
    state.cancelled = false
  }
  file.warning =
    read.content !== null &&
    (Buffer.byteLength(read.content, 'utf8') >= MEMORY_WARNING_BYTES ||
      (read.path === MEMORY_ENTRY && memoryLineCount(read.content) >= MEMORY_WARNING_LINES))
  if (file.processedHash !== read.hash || file.changes > 0) file.pendingSince ??= now
  else file.pendingSince = undefined
  state.files[read.path] = file
  return file
}

export function needsDreaming(file: DreamingFileState | undefined, now: number): boolean {
  return (
    !!file &&
    file.pendingSince !== undefined &&
    file.attempts < 2 &&
    file.retryAt <= now &&
    (file.changes >= 10 || now - file.pendingSince >= 7 * 24 * 60 * 60_000 || file.warning)
  )
}
