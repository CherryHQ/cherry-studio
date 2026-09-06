import {
  DOCTOR_CHECK_IDS,
  type DoctorCancelResult,
  type DoctorFixRequest,
  type DoctorFixResult,
  type DoctorRunResult
} from '@shared/types/doctor'
import { isDoctorFixRequest } from '@shared/utils/doctor'
import * as z from 'zod'

import { defineRoute } from '../define'

/** Progress and the last report are read from the shared cache key `doctor.state`, not via IPC. */
export const doctorRequestSchemas = {
  'diagnostics.doctor.run': defineRoute({
    input: z
      .object({
        tier: z.enum(['quick', 'live']),
        checkIds: z.array(z.enum(DOCTOR_CHECK_IDS)).optional()
      })
      .strict(),
    output: z.custom<DoctorRunResult>()
  }),
  'diagnostics.doctor.cancel': defineRoute({
    input: z.object({ runId: z.string().min(1) }).strict(),
    output: z.custom<DoctorCancelResult>()
  }),
  // The guard rejects fixes the catalog never declared for that check.
  'diagnostics.doctor.fix': defineRoute({
    input: z.custom<DoctorFixRequest>(isDoctorFixRequest),
    output: z.custom<DoctorFixResult>()
  })
}
