import * as z from 'zod'

import { UniqueModelIdSchema } from '@shared/data/types/model'
import type { DoctorScopeKey } from '@shared/types/doctor'
import type {
  DoctorAgentApplyResult,
  DoctorAgentCancelResult,
  DoctorAgentKey,
  DoctorAgentStartResult,
  DoctorAgentUndoResult
} from '@shared/types/doctorAgent'
import { isDoctorAgentKey, isDoctorScopeKey } from '@shared/utils/doctor'

import { defineRoute } from '../define'

const scopeKeySchema = z.custom<DoctorScopeKey>(isDoctorScopeKey)
const agentKeySchema = z.custom<DoctorAgentKey>(isDoctorAgentKey)
const incidentSchema = z.object({ topicId: z.string().min(1), messageId: z.string().min(1) }).strict()

/** Progress, proposals and the change ledger are read through `doctorAgentStateCacheKey(key)`. */
export const doctorAgentRequestSchemas = {
  'diagnostics.doctor.agent.check_model': defineRoute({
    input: z.object({ modelId: UniqueModelIdSchema }).strict(),
    output: z.object({ latency: z.number() })
  }),
  'diagnostics.doctor.agent.start': defineRoute({
    input: z
      .object({
        scope: scopeKeySchema,
        reportRunId: z.string().min(1),
        modelId: z.string().min(1).optional(),
        incident: incidentSchema.optional()
      })
      .strict(),
    output: z.custom<DoctorAgentStartResult>()
  }),
  'diagnostics.doctor.agent.cancel': defineRoute({
    input: z.object({ key: agentKeySchema, runId: z.string().min(1) }).strict(),
    output: z.custom<DoctorAgentCancelResult>()
  }),
  'diagnostics.doctor.agent.apply': defineRoute({
    input: z.object({ key: agentKeySchema, runId: z.string().min(1), proposalId: z.string().min(1) }).strict(),
    output: z.custom<DoctorAgentApplyResult>()
  }),
  'diagnostics.doctor.agent.undo': defineRoute({
    input: z.object({ key: agentKeySchema, runId: z.string().min(1), changeId: z.string().min(1) }).strict(),
    output: z.custom<DoctorAgentUndoResult>()
  })
}
