import * as z from 'zod'

import { remoteFailureSchema } from '../errors'
import { decimal, digest, opaqueId, pageOf, pageParams, timestamp, unicodeText } from '../values'
import { agentCheckpointDescriptorSchema, agentCheckpointPageSchema } from './checkpoints'
import {
  agentCursorSchema,
  commandReceiptSchema,
  interactionSchema,
  interactionResponseSchema,
  workspaceSelectionSchema,
  messageSchema,
  modelSummarySchema,
  partSchema,
  sessionSchema
} from './resources'

const method = <P extends z.ZodType, R extends z.ZodType>(params: P, result: R) => ({
  params,
  result,
  errors: remoteFailureSchema
})
const session = { sessionId: opaqueId }
const command = { commandId: opaqueId, ...session }
const subscription = { subscriptionId: opaqueId }
export const agentMethods = {
  'agent.agents.list': method(
    z.strictObject(pageParams),
    pageOf(
      z.looseObject({
        agentId: opaqueId,
        name: unicodeText.max(4096),
        emoji: unicodeText.trim().min(1).max(64).optional(),
        model: modelSummarySchema.nullable().optional()
      })
    )
  ),
  'agent.workspaces.list': method(
    z.strictObject({ agentId: opaqueId, ...pageParams }),
    pageOf(z.looseObject({ workspaceId: opaqueId, name: unicodeText.max(4096) })).extend({
      systemWorkspace: z.boolean().optional()
    })
  ),
  'agent.sessions.list': method(
    z.strictObject({ agentId: opaqueId.optional(), workspaceId: opaqueId.optional(), ...pageParams }),
    pageOf(sessionSchema)
  ),
  'agent.sessions.get': method(z.strictObject(session), z.looseObject({ session: sessionSchema })),
  'agent.sessions.create': method(
    z.union([
      z.strictObject({
        commandId: opaqueId,
        agentId: opaqueId,
        workspace: workspaceSelectionSchema,
        title: unicodeText.max(4096).optional()
      }),
      z.strictObject({
        commandId: opaqueId,
        agentId: opaqueId,
        workspaceId: opaqueId,
        title: unicodeText.max(4096).optional()
      })
    ]),
    commandReceiptSchema
  ),
  'agent.messages.list': method(
    z.strictObject({ ...session, historyRevision: decimal, ...pageParams }),
    pageOf(messageSchema)
  ),
  'agent.parts.list': method(
    z.strictObject({ ...session, messageId: opaqueId, messageRevision: decimal, ...pageParams }),
    pageOf(partSchema)
  ),
  'agent.content.read': method(
    z.strictObject({
      ...session,
      contentId: opaqueId,
      revision: decimal,
      offset: decimal,
      maxBytes: z.number().int().min(1).max(24_576)
    }),
    z.looseObject({
      contentId: opaqueId,
      revision: decimal,
      offset: decimal,
      dataBase64: z.string().max(32_768),
      nextOffset: decimal,
      eof: z.boolean(),
      sha256: digest
    })
  ),
  'agent.messages.send': method(
    z.strictObject({ ...command, text: unicodeText.min(1).max(32_768), expectedIdleRevision: decimal }),
    commandReceiptSchema
  ),
  'agent.executions.cancel': method(
    z.strictObject({ ...command, expectedExecutionId: opaqueId }),
    commandReceiptSchema
  ),
  'agent.interactions.list': method(z.strictObject({ ...session, ...pageParams }), pageOf(interactionSchema)),
  'agent.interactions.get': method(
    z.strictObject({ ...session, interactionId: opaqueId }),
    z.looseObject({ interaction: interactionSchema })
  ),
  'agent.interactions.respond': method(
    z.union([
      z.strictObject({
        ...command,
        interactionId: opaqueId,
        expectedRevision: decimal,
        expectedExecutionId: opaqueId,
        inputDigest: digest,
        response: interactionResponseSchema
      }),
      z.strictObject({
        ...command,
        interactionId: opaqueId,
        expectedRevision: decimal,
        expectedExecutionId: opaqueId,
        inputDigest: digest,
        decision: z.enum(['approve', 'deny'])
      })
    ]),
    commandReceiptSchema
  ),
  'agent.commands.get': method(z.strictObject({ commandId: opaqueId }), commandReceiptSchema),
  'agent.sessions.subscribe': method(
    z.strictObject({ ...session, cursor: agentCursorSchema.optional() }),
    z.union([
      z.looseObject({
        ...subscription,
        mode: z.literal('replay'),
        fromCursor: agentCursorSchema,
        highWatermark: agentCursorSchema,
        leaseExpiresAt: timestamp
      }),
      z.looseObject({
        ...subscription,
        mode: z.literal('checkpoint'),
        reason: z.string(),
        checkpoint: agentCheckpointDescriptorSchema
      })
    ])
  ),
  'agent.checkpoints.read': method(
    z.strictObject({ ...subscription, checkpointId: opaqueId, pageCursor: opaqueId.optional() }),
    agentCheckpointPageSchema
  ),
  'agent.subscriptions.activate': method(
    z.strictObject({ ...subscription, appliedCursor: agentCursorSchema }),
    z.looseObject({ ...subscription, status: z.literal('active') })
  ),
  'agent.subscriptions.ack': method(
    z.strictObject({ ...subscription, cursor: agentCursorSchema }),
    z.looseObject({ acknowledged: agentCursorSchema })
  ),
  'agent.subscriptions.close': method(z.strictObject(subscription), z.looseObject({ closed: z.literal(true) }))
}
export type AgentMethod = keyof typeof agentMethods
export type AgentParams<M extends AgentMethod> = z.infer<(typeof agentMethods)[M]['params']>
export type AgentResult<M extends AgentMethod> = z.infer<(typeof agentMethods)[M]['result']>
export type AgentMutation =
  | 'agent.sessions.create'
  | 'agent.messages.send'
  | 'agent.executions.cancel'
  | 'agent.interactions.respond'
