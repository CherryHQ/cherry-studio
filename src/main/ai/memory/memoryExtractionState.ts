import { Mutex } from 'async-mutex'
import { eq, like } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'

import type { MemoryFileChange } from './memoryBackups'
import type { ExtractionTicket } from './memoryExtraction'
import { assertMemoryTarget, memoryHash, readMemoryBytes } from './memoryFiles'

const PREFIX = 'memory:extraction:'
const INVALIDATION = 'memory:extraction-invalidation:'
const BOUNDARY = 'memory:extraction-boundary'
const PREVIEW_RECEIPTS = 64
export const EXTRACTION_TURNS = 8

const ticketSchema = z.object({
  input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('assistant'), topicId: z.string(), responseId: z.string() }),
    z.object({ kind: z.literal('agent'), sessionId: z.string(), userMessageId: z.string(), responseId: z.string() })
  ]),
  entityKey: z.string(),
  key: z.string(),
  messageId: z.string(),
  createdAt: z.number(),
  hash: z.string(),
  inputHash: z.string().optional(),
  receivedAt: z.number()
})
const positionSchema = z.object({ createdAt: z.number(), messageIds: z.array(z.string()) })
const stateSchema = z.object({
  version: z.literal(2),
  entityKey: z.string(),
  boundary: z.number(),
  pending: z.array(ticketSchema),
  submitted: z.record(z.string(), z.string()).default({}),
  submittedAt: z.record(z.string(), z.number()).default({}),
  settled: z.array(z.string()),
  settledAt: z.number().default(0),
  batchEnd: z.string().optional(),
  completed: z.string().optional(),
  retryAt: z.number(),
  attempts: z.number().int().nonnegative().default(0),
  skippedBudget: z.number().int().nonnegative().default(0),
  skippedSource: z.number().int().nonnegative().default(0),
  skippedConflict: z.number().int().nonnegative().default(0),
  excludedThrough: positionSchema.optional(),
  recent: z.array(ticketSchema).default([]),
  generation: z.number().int().nonnegative().default(0),
  outcome: z.enum(['pending', 'completed', 'failed', 'cancelled', 'skipped']),
  reason: z.string().optional(),
  prepared: z
    .object({
      end: z.string(),
      sourceHash: z.string(),
      before: z.string().nullable(),
      after: z.string(),
      files: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string() })).optional(),
      through: positionSchema.optional()
    })
    .optional()
})
export type ExtractionState = z.infer<typeof stateSchema>

function read(key: string) {
  return application.get('DbService').getDb().select().from(appStateTable).where(eq(appStateTable.key, key)).get()
    ?.value
}

function write(key: string, value: unknown) {
  application
    .get('DbService')
    .getDb()
    .insert(appStateTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appStateTable.key,
      set: { value, updatedAt: Date.now() }
    })
    .run()
}

// Serialize recovery acknowledgement with reconciliation so an in-flight write cannot appear unchanged.
const historyLock = new Mutex()
export function withReconciledExtractionHistory<T>(operation: () => Promise<T>): Promise<T> {
  return historyLock.runExclusive(async () => {
    await reconcileExtractionInvalidations()
    return operation()
  })
}

// Persist the file versions before the first write. A process exit may prevent the normal completion notification.
export function stageExtractionInvalidation(batchId: string, changes: readonly MemoryFileChange[]): void {
  const db = application.get('DbService').getDb()
  db.insert(appStateTable)
    .values({
      key: INVALIDATION + batchId,
      value: {
        boundary: Date.now(),
        files: changes.map(({ path, before }) => ({ path, beforeHash: memoryHash(before) }))
      }
    })
    .run()
}

export function finishExtractionInvalidation(batchId: string | null, changed: boolean): void {
  const db = application.get('DbService').getDb()
  db.transaction((tx) => {
    const intent = batchId ? read(INVALIDATION + batchId) : undefined
    if (changed)
      invalidateExtractions(
        undefined,
        intent && !Array.isArray(intent) ? z.object({ boundary: z.number() }).parse(intent).boundary : undefined
      )
    if (batchId)
      tx.delete(appStateTable)
        .where(eq(appStateTable.key, INVALIDATION + batchId))
        .run()
  })
}

export function hasPendingExtractionInvalidation(): boolean {
  return !!application
    .get('DbService')
    .getDb()
    .select({ key: appStateTable.key })
    .from(appStateTable)
    .where(like(appStateTable.key, INVALIDATION + '%'))
    .limit(1)
    .get()
}

export async function reconcileExtractionInvalidations(): Promise<void> {
  const intents = application
    .get('DbService')
    .getDb()
    .select()
    .from(appStateTable)
    .where(like(appStateTable.key, INVALIDATION + '%'))
    .all()
  for (const intent of intents) {
    const files = z
      .array(z.object({ path: z.string(), beforeHash: z.string().nullable() }))
      .parse(Array.isArray(intent.value) ? intent.value : z.object({ files: z.unknown() }).parse(intent.value).files)
    let changed = false
    for (const file of files) {
      assertMemoryTarget(file.path)
      const bytes = await readMemoryBytes(application.getPath('feature.memory.data'), file.path)
      if (memoryHash(bytes) !== file.beforeHash) {
        changed = true
        break
      }
    }
    finishExtractionInvalidation(intent.key.slice(INVALIDATION.length), changed)
  }
}

export function extractionBoundary(sourceKey?: string): number {
  const value = read(sourceKey ? `${BOUNDARY}:${sourceKey}` : BOUNDARY)
  if (value !== undefined) return z.number().parse(value)
  if (sourceKey) return 0
  // Restored databases start a new admission period before their backed-up queue can run.
  return application
    .get('DbService')
    .getDb()
    .transaction(() => invalidateExtractions())
}

export function extractionStates(): Array<{ key: string; state: ExtractionState }> {
  return application
    .get('DbService')
    .getDb()
    .select()
    .from(appStateTable)
    .where(like(appStateTable.key, `${PREFIX}%`))
    .all()
    .flatMap((row) => {
      // Legacy admission cursors are not evidence of a completed extraction.
      if ((row.value as { version?: number })?.version !== 2) return []
      return [{ key: row.key, state: stateSchema.parse(row.value) }]
    })
}

export function readExtractionState(key: string): ExtractionState | undefined {
  const value = read(key)
  if ((value as { version?: number } | undefined)?.version !== 2) return undefined
  return stateSchema.parse(value)
}

export function writeExtractionState(key: string, state: ExtractionState): void {
  write(key, stateSchema.parse(state))
}

export function nextExtractionDaily(at: number): number {
  const date = new Date(at)
  date.setHours(21, 0, 0, 0)
  if (date.getTime() <= at) date.setDate(date.getDate() + 1)
  return date.getTime()
}

export function recordExtractionSubmission(
  key: string,
  entityKey: string,
  messageId: string,
  inputHash: string,
  boundary: number,
  submittedAt = Date.now()
): void {
  const state =
    readExtractionState(key) ??
    stateSchema.parse({
      version: 2,
      entityKey,
      boundary,
      pending: [],
      settled: [],
      retryAt: 0,
      outcome: 'pending'
    })
  state.entityKey = entityKey
  state.submittedAt[messageId] ??= submittedAt
  state.submitted[messageId] ??= inputHash
  writeExtractionState(key, state)
}

export function enqueueExtraction(ticket: ExtractionTicket, boundary: number, ancestors: Set<string>): boolean {
  let state = readExtractionState(ticket.key)
  if (
    !state ||
    !ticket.inputHash ||
    state.entityKey !== ticket.entityKey ||
    (state.submitted[ticket.messageId] !== ticket.inputHash &&
      !state.pending.some((item) => item.messageId === ticket.messageId && item.inputHash === ticket.inputHash))
  )
    return false
  if (
    ticket.createdAt <=
      Math.max(boundary, state.boundary, extractionBoundary(ticket.key), extractionBoundary(ticket.entityKey)) ||
    (ticket.createdAt < state.settledAt && !state.pending.some((item) => item.messageId === ticket.messageId)) ||
    state.settled.includes(ticket.messageId)
  )
    return false
  // A selected-branch change must not combine siblings into one extraction batch.
  const branchChanged = state.pending.some((item) => !ancestors.has(item.messageId))
  if (branchChanged) {
    skipExtractionTurns(
      ticket.key,
      state.pending.filter((item) => !ancestors.has(item.messageId)).map((item) => item.messageId),
      'source'
    )
    state = readExtractionState(ticket.key)!
  }
  const existing = state.pending.findIndex((item) => item.messageId === ticket.messageId)
  if (existing >= 0) {
    if (state.pending[existing].input.responseId === ticket.input.responseId) {
      if (branchChanged) writeExtractionState(ticket.key, state)
      return branchChanged
    }
    state.pending[existing] = { ...ticket, receivedAt: state.pending[existing].receivedAt }
    if (existing <= state.pending.findIndex((item) => item.messageId === state.batchEnd)) {
      state.generation++
      state.attempts = 0
      state.retryAt = 0
    }
  } else {
    if (!state.pending.length) {
      state.attempts = 0
      state.retryAt = 0
    }
    state.pending.push({ ...ticket, receivedAt: Date.now() })
  }
  delete state.submittedAt[ticket.messageId]
  delete state.submitted[ticket.messageId]
  state.entityKey = ticket.entityKey
  state.outcome = 'pending'
  writeExtractionState(ticket.key, state)
  return true
}

export function readyExtraction(): { key: string; state: ExtractionState } | undefined {
  for (const entry of extractionStates()) {
    const { state } = entry
    if (!state.pending.length || state.retryAt > Date.now()) continue
    if (!state.batchEnd) {
      const cutoff = nextExtractionDaily(state.pending[0].receivedAt)
      const daily = Date.now() >= cutoff
      if (state.pending.length < EXTRACTION_TURNS && !daily) continue
      const count = daily
        ? Math.min(EXTRACTION_TURNS, state.pending.filter((ticket) => ticket.receivedAt <= cutoff).length)
        : EXTRACTION_TURNS
      state.batchEnd = state.pending[count - 1].messageId
    }
    if (state.attempts >= 3) state.attempts = 0
    writeExtractionState(entry.key, state)
    return entry
  }
  return undefined
}

export function completeExtraction(
  key: string,
  end: string,
  reason = 'completed',
  skippedBudget = 0,
  generation?: number
): void {
  const state = readExtractionState(key)
  if (!state || (generation !== undefined && generation !== state.generation)) return
  const index = state.pending.findIndex((item) => item.messageId === end)
  if (index < 0) return
  const completed = state.pending.splice(0, index + 1)
  settle(state, completed)
  state.recent = [...state.recent, ...completed].slice(-PREVIEW_RECEIPTS)
  state.generation++
  state.completed = end
  if (end === state.batchEnd) state.batchEnd = undefined
  state.prepared = undefined
  state.retryAt = 0
  state.attempts = 0
  state.skippedBudget += skippedBudget
  state.outcome = 'completed'
  state.reason = reason
  writeExtractionState(key, state)
}

function settle(state: ExtractionState, tickets: ExtractionTicket[]): void {
  for (const ticket of tickets) {
    if (ticket.createdAt < state.settledAt) continue
    if (ticket.createdAt > state.settledAt) {
      state.settledAt = ticket.createdAt
      state.settled = []
    }
    if (!state.settled.includes(ticket.messageId)) state.settled.push(ticket.messageId)
  }
}

export function deferExtraction(key: string, generation: number, interrupted: boolean, reason = 'unavailable'): void {
  const state = readExtractionState(key)
  if (!state?.pending.length || state.generation !== generation) return
  if (!interrupted) state.attempts++
  state.retryAt = interrupted
    ? Date.now() + 60_000
    : state.attempts < 3
      ? Date.now() + 10 * 60_000
      : nextExtractionDaily(Date.now())
  state.outcome = 'failed'
  state.reason = reason
  writeExtractionState(key, state)
}

export function skipExtractionTurn(key: string, messageId: string): void {
  skipExtractionTurns(key, [messageId], 'budget')
}

function sourcePosition(
  tickets: readonly Pick<ExtractionTicket, 'messageId' | 'createdAt'>[],
  previous?: z.infer<typeof positionSchema>
) {
  const createdAt = Math.max(previous?.createdAt ?? 0, ...tickets.map((ticket) => ticket.createdAt))
  return {
    createdAt,
    messageIds: [
      ...new Set([
        ...(previous?.createdAt === createdAt ? previous.messageIds : []),
        ...tickets.filter((ticket) => ticket.createdAt === createdAt).map((ticket) => ticket.messageId)
      ])
    ]
  }
}

export function skipExtractionTurns(
  key: string,
  messageIds: readonly string[],
  reason: 'budget' | 'source' | 'conflict'
): number {
  const state = readExtractionState(key)
  if (!state) return 0
  const removed = state.pending.filter((ticket) => messageIds.includes(ticket.messageId))
  if (!removed.length) return 0
  const end = state.pending.findIndex((ticket) => ticket.messageId === state.batchEnd)
  const batch = state.pending.slice(0, end + 1).filter((ticket) => !messageIds.includes(ticket.messageId))
  const affectsBatch = end < 0 || state.pending.slice(0, end + 1).some((item) => messageIds.includes(item.messageId))
  if (state.prepared && affectsBatch && end >= 0)
    state.prepared.through ??= sourcePosition(state.pending.slice(0, end + 1))
  const preparedThrough = state.prepared?.through
  settle(state, removed)
  state.pending = state.pending.filter((ticket) => !messageIds.includes(ticket.messageId))
  if (end >= 0) state.batchEnd = batch.at(-1)?.messageId
  if (reason === 'conflict' || !state.batchEnd) state.prepared = undefined
  if (affectsBatch) {
    state.generation++
    state.retryAt = 0
    state.attempts = 0
  }
  if (reason === 'budget') state.skippedBudget += removed.length
  else if (reason === 'source') state.skippedSource += removed.length
  else {
    // These receipts still describe the conversation. excludedThrough fences automatic replay.
    state.recent = [...state.recent, ...removed].slice(-PREVIEW_RECEIPTS)
    state.skippedConflict += removed.length
    state.excludedThrough = sourcePosition(
      [
        ...removed,
        ...(preparedThrough?.messageIds.map((messageId) => ({ messageId, createdAt: preparedThrough.createdAt })) ?? [])
      ],
      state.excludedThrough
    )
  }
  state.outcome = 'skipped'
  state.reason = reason
  writeExtractionState(key, state)
  return removed.length
}

export function invalidateExtractions(sourceKey?: string, operationAt?: number): number {
  const boundary = Math.max(
    operationAt ?? Date.now(),
    Number(read(sourceKey ? `${BOUNDARY}:${sourceKey}` : BOUNDARY) ?? 0)
  )
  write(sourceKey ? `${BOUNDARY}:${sourceKey}` : BOUNDARY, boundary)
  for (const { key, state } of extractionStates()) {
    if (sourceKey && key !== sourceKey && state.entityKey !== sourceKey) continue
    const keep = (ticket: ExtractionTicket) => operationAt !== undefined && ticket.createdAt > boundary
    settle(
      state,
      state.pending.filter((ticket) => !keep(ticket))
    )
    for (const id of Object.keys(state.submitted)) {
      if (operationAt !== undefined && state.submittedAt[id] > boundary) continue
      delete state.submitted[id]
      delete state.submittedAt[id]
    }
    state.pending = state.pending.filter(keep)
    state.recent = state.recent.filter(keep)
    state.generation++
    state.retryAt = 0
    state.attempts = 0
    state.prepared = undefined
    state.batchEnd = undefined
    state.boundary = boundary
    state.outcome = state.pending.length ? 'pending' : 'cancelled'
    writeExtractionState(key, state)
  }
  return boundary
}
