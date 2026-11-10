import { application } from '@application'
import type { doctorRequestSchemas } from '@shared/ipc/schemas/doctor'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const doctorHandlers: IpcHandlersFor<typeof doctorRequestSchemas> = {
  'diagnostics.doctor.confirm_check': async (input) => application.get('DoctorService').confirmCheck(input),
  'diagnostics.doctor.connectivity': async (input) => application.get('DoctorService').checkConnectivity(input),
  'diagnostics.doctor.cancel_connectivity': async ({ scope, runId }) =>
    application.get('DoctorService').cancelConnectivity(scope, runId),
  'diagnostics.doctor.run': async (input) => application.get('DoctorService').run(input),
  'diagnostics.doctor.run_contextual': async ({ subject }) =>
    application.get('DoctorService').runContextualDiagnosis(subject),
  'diagnostics.doctor.cancel': async ({ scope, runId }) => application.get('DoctorService').cancel(scope, runId),
  'diagnostics.doctor.fix': async (input) => application.get('DoctorService').fix(input)
}
