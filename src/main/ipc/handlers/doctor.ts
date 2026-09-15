import { application } from '@application'
import type { doctorRequestSchemas } from '@shared/ipc/schemas/doctor'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const doctorHandlers: IpcHandlersFor<typeof doctorRequestSchemas> = {
  'diagnostics.doctor.connectivity': async (input) => application.get('DoctorService').checkConnectivity(input),
  'diagnostics.doctor.cancel_connectivity': async ({ scope, runId }) =>
    application.get('DoctorService').cancelConnectivity(scope, runId),

  'diagnostics.doctor.run': async (input) => application.get('DoctorService').run(input),
  'diagnostics.doctor.cancel': async ({ runId }) => application.get('DoctorService').cancel(runId),
  'diagnostics.doctor.fix': async (input) => application.get('DoctorService').fix(input)
}
