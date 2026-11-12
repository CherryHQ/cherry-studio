import * as z from 'zod'

import { remoteFailureSchema } from '../errors'
import { executionFailureSchema } from '../failure'
import { decimal, digest, opaqueId, pageOf, pageParams, timestamp, unicodeText } from '../values'
import { contentRefSchema, workspaceSelectionSchema } from './resources'

export const taskStatusSchema = z.enum(['active', 'paused', 'completed', 'missed'])
export const taskTriggerSchema = z.discriminatedUnion('kind', [
  z.looseObject({
    kind: z.literal('cron'),
    expr: unicodeText.min(1).max(4096),
    timezone: unicodeText.max(256).optional(),
    limit: z.number().int().positive().optional()
  }),
  z.looseObject({
    kind: z.literal('interval'),
    ms: z.number().int().positive(),
    anchor: z.enum(['createdAt', 'lastRun']).optional()
  }),
  z.looseObject({ kind: z.literal('once'), at: z.number().int().nonnegative() })
])

export const taskSummarySchema = z.looseObject({
  taskId: opaqueId,
  agentId: opaqueId,
  name: unicodeText.max(4096),
  status: taskStatusSchema,
  trigger: taskTriggerSchema,
  nextRunAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp
})

export const taskDetailSchema = taskSummarySchema.extend({
  prompt: z.union([z.strictObject({ text: unicodeText.max(4096) }), z.strictObject({ ref: contentRefSchema })]),
  timeoutMinutes: z.number().positive(),
  workspace: workspaceSelectionSchema,
  reuse: z.discriminatedUnion('kind', [
    z.looseObject({ kind: z.literal('fresh') }),
    z.looseObject({ kind: z.literal('reuse'), sessionId: opaqueId.nullable() })
  ])
})

export const taskResultLocationSchema = z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('none') }),
  z.looseObject({ kind: z.literal('session'), sessionId: opaqueId }),
  z.looseObject({ kind: z.literal('unavailable') })
])
const run = {
  runId: opaqueId,
  taskId: opaqueId,
  createdAt: timestamp,
  scheduledAt: timestamp,
  summary: unicodeText.max(200).nullable(),
  resultLocation: taskResultLocationSchema
}
const terminal = { ...run, startedAt: timestamp.nullable(), finishedAt: timestamp.nullable() }
export const taskRunSchema = z.discriminatedUnion('status', [
  z.looseObject({ ...run, status: z.literal('queued'), startedAt: z.null(), cancelRequested: z.boolean() }),
  z.looseObject({
    ...run,
    status: z.literal('running'),
    startedAt: timestamp.nullable(),
    cancelRequested: z.boolean()
  }),
  z.looseObject({
    ...terminal,
    status: z.literal('completed'),
    outcome: z.enum(['executed', 'skipped', 'unknown'])
  }),
  z.looseObject({ ...terminal, status: z.literal('failed'), failure: executionFailureSchema }),
  z.looseObject({ ...terminal, status: z.literal('cancelled') })
])

export const taskMethods = {
  'agent.tasks.list': {
    params: z.strictObject({
      ...pageParams,
      agentId: opaqueId.optional(),
      statuses: z.array(taskStatusSchema).min(1).max(4).optional()
    }),
    result: pageOf(taskSummarySchema),
    errors: remoteFailureSchema
  },
  'agent.tasks.get': {
    params: z.strictObject({ taskId: opaqueId }),
    result: z.looseObject({ task: taskDetailSchema }),
    errors: remoteFailureSchema
  },
  'agent.tasks.runs.list': {
    params: z.strictObject({ taskId: opaqueId, ...pageParams }),
    result: pageOf(taskRunSchema),
    errors: remoteFailureSchema
  },
  'agent.tasks.runs.get': {
    params: z.strictObject({ taskId: opaqueId, runId: opaqueId }),
    result: z.looseObject({ run: taskRunSchema }),
    errors: remoteFailureSchema
  },
  'agent.tasks.content.read': {
    params: z.strictObject({
      taskId: opaqueId,
      contentId: opaqueId,
      revision: decimal,
      offset: decimal,
      maxBytes: z.number().int().min(1).max(24_576)
    }),
    result: z.looseObject({
      contentId: opaqueId,
      revision: decimal,
      offset: decimal,
      dataBase64: z.string().max(32_768),
      nextOffset: decimal,
      eof: z.boolean(),
      sha256: digest
    }),
    errors: remoteFailureSchema
  }
}

export type TaskMethod = keyof typeof taskMethods
export type TaskStatus = z.infer<typeof taskStatusSchema>
export type TaskTrigger = z.infer<typeof taskTriggerSchema>
export type TaskSummary = z.infer<typeof taskSummarySchema>
export type TaskDetail = z.infer<typeof taskDetailSchema>
export type TaskRun = z.infer<typeof taskRunSchema>
export type TaskResultLocation = z.infer<typeof taskResultLocationSchema>
