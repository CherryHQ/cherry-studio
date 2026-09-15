import * as z from 'zod'

import {
  DOCTOR_CHECK_IDS,
  type DoctorCancelResult,
  type DoctorConfirmResult,
  type DoctorFixRequest,
  type DoctorFixResult,
  type DoctorRunResult,
  type DoctorScopeKey
} from '@shared/types/doctor'
import type { DoctorConnectivityResult } from '@shared/types/doctorConnectivity'
import { isDoctorFixRequest, isDoctorScopeKey } from '@shared/utils/doctor'

import { defineRoute } from '../define'

const contextualSubjects = [
  z.object({ kind: z.literal('chat'), providerId: z.string().min(1), modelId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('agent'), agentId: z.string().min(1) }).strict()
] as const
const subjectRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  ...contextualSubjects
])
const scopeKeySchema = z.custom<DoctorScopeKey>(isDoctorScopeKey)

/** Progress and the last report are read from the shared cache key `doctor.state.${scope}`, not via IPC. */
export const doctorRequestSchemas = {
  'diagnostics.doctor.confirm_check': defineRoute({
    input: z.object({ scope: scopeKeySchema, runId: z.string().min(1), requestId: z.uuid() }).strict(),
    output: z.custom<DoctorConfirmResult>()
  }),
  'diagnostics.doctor.connectivity': defineRoute({
    input: z.object({ subject: z.discriminatedUnion('kind', contextualSubjects), runId: z.uuid() }).strict(),
    output: z.custom<DoctorConnectivityResult>()
  }),
  'diagnostics.doctor.cancel_connectivity': defineRoute({
    input: z.object({ scope: scopeKeySchema, runId: z.uuid() }).strict(),
    output: z.custom<DoctorCancelResult>()
  }),
  'diagnostics.doctor.run': defineRoute({
    input: z
      .object({
        tier: z.enum(['quick', 'live']),
        subject: subjectRefSchema,
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
