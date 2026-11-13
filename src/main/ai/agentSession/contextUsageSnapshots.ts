import * as z from 'zod'

import type { AgentSessionContextUsageSnapshot } from '@shared/ai/agentSessionContextUsage'

export const CONTEXT_USAGE_SNAPSHOTS_KEY = 'agent.session.context_usage_snapshots'
const text = z.string().min(1)
const timestamp = z.iso.datetime()
const count = z.object({ tokens: z.number().finite().nonnegative(), precision: z.enum(['reported', 'estimated']) })
const category = z.enum([
  'system-prompt',
  'system-tools',
  'mcp-tools',
  'mcp-instructions',
  'memory-files',
  'skills',
  'agents',
  'messages',
  'other'
])
const snapshotSchema = z.object({
  version: z.literal(1),
  modelId: text,
  agentUpdatedAt: timestamp,
  contextId: text,
  backendId: text,
  nativeThreadId: text,
  headMessageId: text,
  headUpdatedAt: timestamp,
  measuredAt: timestamp,
  usage: z.object({
    model: text,
    revision: text,
    contextWindow: z.number().finite().positive(),
    used: count,
    basis: z.enum(['current-context', 'last-request']),
    reserved: count.optional(),
    free: count.optional(),
    breakdown: z
      .object({
        coverage: z.enum(['partial', 'complete']),
        categories: z.array(
          count.extend({
            id: text,
            key: category,
            label: z.string().optional(),
            occupancy: z.enum(['included', 'deferred'])
          })
        )
      })
      .optional(),
    resources: z
      .array(
        z.object({
          id: text,
          category,
          name: text,
          source: z.string().optional(),
          count: count.optional(),
          state: z.enum(['loaded', 'deferred']).optional()
        })
      )
      .optional()
  })
})

// CacheService nests the map two spaces deep, and each record four spaces deep.
export function snapshotBytes(value: unknown, indent = 2): number {
  const serialized = JSON.stringify(value, null, 2)
  return Buffer.byteLength(serialized, 'utf8') + indent * (serialized.split('\n').length - 1)
}

export function isContextUsageSnapshot(value: unknown): value is AgentSessionContextUsageSnapshot {
  return snapshotSchema.safeParse(value).success && snapshotBytes(value, 4) <= 16 * 1024
}

export function pruneContextUsageSnapshots(
  input: Record<string, AgentSessionContextUsageSnapshot>,
  sessionExists: (sessionId: string) => boolean
): Record<string, AgentSessionContextUsageSnapshot> {
  const records = Object.fromEntries(
    Object.entries(input).filter(([id, record]) => isContextUsageSnapshot(record) && sessionExists(id))
  )
  const oldest = Object.keys(records).sort(
    (a, b) => Date.parse(records[a].measuredAt) - Date.parse(records[b].measuredAt) || a.localeCompare(b)
  )
  while (Object.keys(records).length > 100 || snapshotBytes(records) > 256 * 1024) delete records[oldest.shift()!]
  return records
}

export function mergeContextUsageSnapshot(
  input: Record<string, AgentSessionContextUsageSnapshot>,
  sessionId: string,
  record: AgentSessionContextUsageSnapshot,
  sessionExists: (sessionId: string) => boolean
): Record<string, AgentSessionContextUsageSnapshot> {
  const records = { ...input }
  const previous = records[sessionId]
  if (!isContextUsageSnapshot(record)) delete records[sessionId]
  else if (!previous || JSON.stringify({ ...previous, measuredAt: record.measuredAt }) !== JSON.stringify(record))
    records[sessionId] = record
  return pruneContextUsageSnapshots(records, sessionExists)
}
