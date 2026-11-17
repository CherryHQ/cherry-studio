import { eq, like } from 'drizzle-orm'
import * as z from 'zod'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'

import type { ExtractionTicket } from './memoryExtraction'

const PREFIX = 'memory:extraction:'
const BOUNDARY = 'memory:extraction-boundary'
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
  contextHash: z.string().optional(),
  receivedAt: z.number()
})
const stateSchema = z.object({
  version: z.literal(2),
  entityKey: z.string(),
  boundary: z.number(),
  pending: z.array(ticketSchema),
  settled: z.array(z.string()),
  settledAt: z.number().default(0),
  batchEnd: z.string().optional(),
  completed: z.string().optional(),
  retryAt: z.number(),
  attempts: z.number().int().nonnegative().default(0),
  skippedBudget: z.number().int().nonnegative().default(0),
  outcome: z.enum(['pending', 'completed', 'failed', 'cancelled', 'skipped']),
  reason: z.string().optional(),
  prepared: z
    .object({ end: z.string(), sourceHash: z.string(), before: z.string().nullable(), after: z.string() })
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

export function extractionBoundary(sourceKey?: string): number {
  const value = read(sourceKey ? `${BOUNDARY}:${sourceKey}` : BOUNDARY)
  if (value !== undefined) return z.number().parse(value)
  if (sourceKey) return 0
  const boundary = Date.now()
  write(BOUNDARY, boundary)
  return boundary
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

export function enqueueExtraction(ticket: ExtractionTicket, boundary: number, ancestors: Set<string>): boolean {
  const state: ExtractionState =
    readExtractionState(ticket.key) ??
    ({
      version: 2,
      entityKey: ticket.entityKey,
      boundary,
      pending: [],
      settled: [],
      settledAt: 0,
      retryAt: 0,
      attempts: 0,
      skippedBudget: 0,
      outcome: 'pending'
    } satisfies ExtractionState)
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
    state.pending = state.pending.filter((item) => ancestors.has(item.messageId))
    state.batchEnd = undefined
    state.prepared = undefined
  }
  const existing = state.pending.findIndex((item) => item.messageId === ticket.messageId)
  if (existing >= 0) {
    if (state.pending[existing].hash === ticket.hash) {
      if (branchChanged) writeExtractionState(ticket.key, state)
      return branchChanged
    }
    state.pending[existing] = { ...ticket, receivedAt: state.pending[existing].receivedAt }
  } else state.pending.push({ ...ticket, receivedAt: Date.now() })
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
      const count =
        state.pending.length >= EXTRACTION_TURNS
          ? EXTRACTION_TURNS
          : state.pending.filter((ticket) => ticket.receivedAt <= cutoff).length
      state.batchEnd = state.pending[count - 1].messageId
    }
    if (state.attempts >= 3) state.attempts = 0
    writeExtractionState(entry.key, state)
    return entry
  }
  return undefined
}

export function completeExtraction(key: string, end: string, reason = 'completed', skippedBudget = 0): void {
  const state = readExtractionState(key)
  if (!state) return
  const index = state.pending.findIndex((item) => item.messageId === end)
  if (index < 0) return
  settle(state, state.pending.splice(0, index + 1))
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

export function deferExtraction(key: string, interrupted: boolean, reason = 'unavailable'): void {
  const state = readExtractionState(key)
  if (!state?.pending.length) return
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
  const state = readExtractionState(key)
  if (!state) return
  const index = state.pending.findIndex((ticket) => ticket.messageId === messageId)
  if (index < 0) return
  settle(state, [state.pending[index]])
  state.pending.splice(index, 1)
  if (state.batchEnd === messageId) state.batchEnd = state.pending[index - 1]?.messageId
  state.prepared = undefined
  state.retryAt = 0
  state.attempts = 0
  state.skippedBudget++
  state.outcome = 'skipped'
  state.reason = 'budget'
  writeExtractionState(key, state)
}

export function invalidateExtractions(sourceKey?: string): number {
  const boundary = Date.now()
  write(sourceKey ? `${BOUNDARY}:${sourceKey}` : BOUNDARY, boundary)
  for (const { key, state } of extractionStates()) {
    if (sourceKey && key !== sourceKey && state.entityKey !== sourceKey) continue
    settle(state, state.pending)
    state.pending = []
    state.prepared = undefined
    state.batchEnd = undefined
    state.boundary = boundary
    state.outcome = 'cancelled'
    writeExtractionState(key, state)
  }
  return boundary
}
