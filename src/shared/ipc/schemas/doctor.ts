import * as z from 'zod'

import {
  DOCTOR_CHECK_IDS,
  type DoctorCancelResult,
  type DoctorFixRequest,
  type DoctorFixResult,
  type DoctorRunResult,
  type DoctorScopeKey
} from '@shared/types/doctor'
import { isDoctorFixRequest, isDoctorScopeKey } from '@shared/utils/doctor'

import { defineRoute } from '../define'

const subjectRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chat'), providerId: z.string().min(1), modelId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('agent'), agentId: z.string().min(1) }).strict()
])
const scopeKeySchema = z.custom<DoctorScopeKey>(isDoctorScopeKey)

/** Progress and the last report are read from the shared cache key `doctor.state.${scope}`, not via IPC. */
export const doctorRequestSchemas = {
  'diagnostics.doctor.run': defineRoute({
    input: z
      .object({
        tier: z.enum(['quick', 'live']),
        /** Absent = a global run. Present = only checks whose `scope` the resolved subject satisfies. */
        subject: subjectRefSchema.optional(),
        checkIds: z.array(z.enum(DOCTOR_CHECK_IDS)).optional()
      })
      .strict(),
    output: z.custom<DoctorRunResult>()
  }),
  'diagnostics.doctor.cancel': defineRoute({
    input: z.object({ scope: scopeKeySchema, runId: z.string().min(1) }).strict(),
    output: z.custom<DoctorCancelResult>()
  }),
  // The guard rejects fixes the catalog never declared for that check.
  'diagnostics.doctor.fix': defineRoute({
    input: z.custom<DoctorFixRequest>(isDoctorFixRequest),
    output: z.custom<DoctorFixResult>()
  })
}
