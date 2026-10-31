import * as z from 'zod'

import { objectValues, REASONING_EFFORT } from '@cherrystudio/provider-registry'

import { defineRoute } from '../define'

// Mirrors the aiSdk.ts pattern (ReasoningEffortOptionSchema); the package index
// does not re-export model.ts's ReasoningEffortSchema.
const reasoningEffortSchema = z.enum(objectValues(REASONING_EFFORT))

/**
 * Preference-domain IPC schemas — targeted writes that must be atomic in the
 * main process and so cannot ride the whole-value `preference:set` channel:
 * there, each renderer read-modify-writes the entire value from its own local
 * snapshot, and independent cross-window edits overwrite each other.
 */
export const preferenceRequestSchemas = {
  // Set or clear one reasoning-effort mapping entry. Main applies it to its
  // authoritative cache in a synchronous read-modify-write, so detached
  // Settings windows editing different entries merge instead of clobbering
  // (#21087 review finding r4364908344). `target` null/absent clears the entry.
  'preference.set_reasoning_effort_mapping_entry': defineRoute({
    input: z.discriminatedUnion('scope', [
      z.strictObject({
        scope: z.literal('global'),
        source: reasoningEffortSchema,
        target: reasoningEffortSchema.nullish()
      }),
      z.strictObject({
        scope: z.literal('provider'),
        providerId: z.string().min(1),
        source: reasoningEffortSchema,
        target: reasoningEffortSchema.nullish()
      })
    ]),
    output: z.void()
  })
}
