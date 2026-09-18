import * as z from 'zod'

const id = z.string().min(1).max(128)
const session = z.strictObject({ sessionId: id })
const command = session.extend({ commandId: z.uuid() })
const page = z.object({ cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(50).default(20) })
const contentPage = {
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limitBytes: z.number().int().min(4).max(32768).default(16384),
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
}
const hasPageRevision = (input: { offset: number; revision?: string }) => input.offset === 0 || Boolean(input.revision)

export const requestSchema = z.strictObject({
  type: z.literal('request'),
  requestId: id,
  method: z.string().min(1).max(64),
  params: z.unknown().optional()
})

export const authSchema = z.strictObject({
  type: z.literal('auth'),
  transcriptHash: id,
  mode: z.literal('device'),
  token: id
})
export type RemoteAuth = z.infer<typeof authSchema>

export const methodSchemas = {
  'system.info': z.strictObject({}),
  'agents.list': page.strict(),
  'workspaces.list': page.strict(),
  'sessions.list': page.extend({ agentId: id }).strict(),
  'sessions.create': z.strictObject({ agentId: id, workspaceId: id.optional(), commandId: z.uuid() }),
  'sessions.get': session,
  'messages.list': page.extend({ sessionId: id }).strict(),
  'messages.parts.list': page.extend({ sessionId: id, messageId: id }).strict(),
  'messages.parts.get': session
    .extend({
      messageId: id,
      partIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      field: z.enum(['text', 'input', 'output', 'error', 'artifact', 'artifacts']),
      ...contentPage
    })
    .refine(hasPageRevision),
  'artifacts.read': session
    .extend({
      messageId: id,
      partIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      artifactIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      ...contentPage,
      limitBytes: z.number().int().min(1).max(262144).default(65536)
    })
    .refine(hasPageRevision),
  'messages.send': command.extend({
    parts: z
      .array(z.strictObject({ type: z.literal('text'), text: z.string().min(1).max(65536) }))
      .min(1)
      .max(8)
  }),
  'commands.get': z.strictObject({ commandId: z.uuid() }),
  'turns.cancel': command.extend({ expectedExecutionId: id }),
  'interactions.list': session,
  'interactions.get': session.extend({ interactionId: id, ...contentPage }).refine(hasPageRevision),
  'interactions.respond': command.extend({
    interactionId: id,
    response: z.strictObject({
      approved: z.boolean(),
      reason: z.string().max(4096).optional(),
      updatedInput: z.record(z.string(), z.unknown()).optional()
    })
  }),
  'session.subscribe': session,
  unsubscribe: z.strictObject({ subscriptionId: z.uuid() })
}

export type RemoteMethod = keyof typeof methodSchemas
export type MethodInput<M extends RemoteMethod> = z.infer<(typeof methodSchemas)[M]>
export type RemoteEvent = {
  type: 'event'
  event: string
  subscriptionId: string
  subscriptionEpoch: string
  eventSeq: number
  sessionId: string
  data: unknown
}

export type RemoteErrorCode =
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_FOUND'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_BUSY'
  | 'AGENT_UNAVAILABLE'
  | 'COMMAND_CONFLICT'
  | 'COMMAND_INTERRUPTED'
  | 'INTERACTION_UNSUPPORTED'
  | 'SUBSCRIPTION_LIMIT'
  | 'RATE_LIMITED'
  | 'CONTENT_CHANGED'
  | 'ARTIFACT_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export class RemoteRequestError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    readonly retryable = false
  ) {
    super(code)
    this.name = 'RemoteRequestError'
  }
}
