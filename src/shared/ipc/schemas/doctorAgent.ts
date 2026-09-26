import * as z from 'zod'

import type { DoctorScopeKey } from '@shared/types/doctor'
import type {
  DoctorAgentApplyResult,
  DoctorAgentCancelResult,
  DoctorAgentStartResult,
  DoctorAgentUndoResult
} from '@shared/types/doctorAgent'
import { isDoctorScopeKey } from '@shared/utils/doctor'

import { defineRoute } from '../define'

const scopeKeySchema = z.custom<DoctorScopeKey>(isDoctorScopeKey)

/** Progress, proposals and the change ledger are read through `doctorAgentStateCacheKey(scope)`. */
export const doctorAgentRequestSchemas = {
  'diagnostics.doctor.agent.start': defineRoute({
    input: z
      .object({ scope: scopeKeySchema, reportRunId: z.string().min(1), modelId: z.string().min(1).optional() })
      .strict(),
    output: z.custom<DoctorAgentStartResult>()
  }),
  'diagnostics.doctor.agent.cancel': defineRoute({
    input: z.object({ scope: scopeKeySchema, runId: z.string().min(1) }).strict(),
    output: z.custom<DoctorAgentCancelResult>()
  }),
  'diagnostics.doctor.agent.apply': defineRoute({
    input: z.object({ scope: scopeKeySchema, runId: z.string().min(1), proposalId: z.string().min(1) }).strict(),
    output: z.custom<DoctorAgentApplyResult>()
  }),
  'diagnostics.doctor.agent.undo': defineRoute({
    input: z.object({ scope: scopeKeySchema, runId: z.string().min(1), changeId: z.string().min(1) }).strict(),
    output: z.custom<DoctorAgentUndoResult>()
  })
}
