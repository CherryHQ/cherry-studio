import type { Storage, ConversationId } from '@earendil-works/pi-durable'
import * as z from 'zod'

import type { PiDurableRuntime } from '@cherrystudio/agent-runtime-pi-durable'
import { ServiceTierSelectionSchema, UniqueModelIdSchema } from '@shared/data/types/model'
import { ReasoningEffortOptionSchema } from '@shared/types/aiSdk'

import type { AgentRuntimeConnectInput } from '../types'

const requestSchema = z.object({
  modelId: UniqueModelIdSchema,
  reasoningEffort: ReasoningEffortOptionSchema.optional(),
  serviceTier: ServiceTierSelectionSchema.optional(),
  fastMode: z.boolean().optional(),
  knowledgeBaseIds: z.array(z.string()).optional()
})
async function requestDocument() {
  const { defineDoc } = await import('@earendil-works/pi-durable')
  return defineDoc({
    kind: 'cherry.desktop-request',
    version: 1,
    scope: 'conversation',
    history: 'latest',
    fork: 'initial',
    checkpointWhen: () => false,
    initial: (): { request: z.infer<typeof requestSchema> | null } => ({ request: null })
  })
}
export async function readDurableRequest(storage: Storage, thread: string) {
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
  const token = await requestDocument()
  const address = await storage.findDocument(
    { kind: token.definition.kind, scope: { kind: 'conversation', conversationId: Number(thread) as ConversationId } },
    'current',
    BACKGROUND_CONTEXT
  )
  const doc = address && (await storage.document(address.id, 'current', BACKGROUND_CONTEXT))
  if (!doc) return undefined
  if (doc.version !== 1) throw new Error('Unsupported Durable request configuration')
  return doc.value.request === null ? undefined : requestSchema.parse(doc.value.request)
}
export async function saveDurableRequest(runtime: PiDurableRuntime, thread: string, input: AgentRuntimeConnectInput) {
  const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
  const { copyJson } = await import('@earendil-works/chord/json')
  const token = await requestDocument()
  const request = requestSchema.parse(copyJson(requestSchema.parse(input), { omitUndefinedProperties: true }))
  await runtime.durable.commit(async (tx) => {
    const doc = await tx.doc(token, Number(thread) as ConversationId)
    doc.request = request
  }, BACKGROUND_CONTEXT)
}
