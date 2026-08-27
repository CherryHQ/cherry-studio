/**
 * One line of a mini app's activity log: what the app DID, never what it said.
 *
 * Written by main as JSONL, read back by the detail panel. No entry carries a
 * payload — no storage key or value, no file name, no message text, no clipboard
 * text — only names, outcomes, sizes and addresses. `v` lets a later shape be told
 * apart from this one without rewriting old files.
 */

import * as z from 'zod'

const Facet = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))

/** A capability call worth its own line: every refusal, and every call that leaves the sandbox. */
export const MiniAppActivityCallSchema = z.object({
  v: z.literal(1),
  ts: z.number(),
  kind: z.literal('call'),
  /** The bridge method, e.g. `network.fetch`. */
  name: z.string(),
  /** `ok`, or one of the seven public error names. */
  outcome: z.string(),
  durationMs: z.number(),
  facet: Facet.optional()
})

/** A permission decision, taken by the user in the host UI. */
export const MiniAppActivityGrantSchema = z.object({
  v: z.literal(1),
  ts: z.number(),
  kind: z.literal('grant'),
  name: z.enum([
    'install',
    'reinstall',
    'update',
    'rollback',
    'grant',
    'revoke',
    'grant_pending',
    'snooze_pending',
    'clear_data'
  ]),
  permissions: z.array(z.string()).optional(),
  removed: z.array(z.string()).optional(),
  version: z.string().optional()
})

/** Sandbox-internal calls, counted per method and flushed once a minute. */
export const MiniAppActivityCountSchema = z.object({
  v: z.literal(1),
  ts: z.number(),
  kind: z.literal('count'),
  name: z.string(),
  calls: z.number(),
  bytes: z.number()
})

/** The day's budget ran out; nothing after this line was recorded that day. */
export const MiniAppActivityTruncatedSchema = z.object({
  v: z.literal(1),
  ts: z.number(),
  kind: z.literal('truncated')
})

export const MiniAppActivityEntrySchema = z.discriminatedUnion('kind', [
  MiniAppActivityCallSchema,
  MiniAppActivityGrantSchema,
  MiniAppActivityCountSchema,
  MiniAppActivityTruncatedSchema
])

/** What the detail panel asks for: the newest lines, and what the whole log weighs. */
export const MiniAppActivityListingSchema = z.object({
  entries: z.array(MiniAppActivityEntrySchema),
  /** Every kept day file, on disk. */
  bytes: z.number(),
  /** Day files kept — activity days, not calendar days. */
  days: z.number()
})

export type MiniAppActivityListing = z.infer<typeof MiniAppActivityListingSchema>
export type MiniAppActivityCall = z.infer<typeof MiniAppActivityCallSchema>
export type MiniAppActivityGrant = z.infer<typeof MiniAppActivityGrantSchema>
export type MiniAppActivityCount = z.infer<typeof MiniAppActivityCountSchema>
export type MiniAppActivityEntry = z.infer<typeof MiniAppActivityEntrySchema>
