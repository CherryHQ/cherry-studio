import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import * as z from 'zod'

const SessionStoreEntryEnvelopeSchema = z.object({
  type: z.string(),
  uuid: z.string().optional(),
  timestamp: z.string().optional()
})

// The SDK treats other fields as opaque JSON; returning an object-schema result would rewrite that payload.
export const SessionStoreEntrySchema = z.custom<SessionStoreEntry>(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native history JSON is untyped; validate the SDK envelope while retaining the original payload.
  (value: unknown) => SessionStoreEntryEnvelopeSchema.safeParse(value).success
)
