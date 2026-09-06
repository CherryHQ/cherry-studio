import { application } from '@application'
import type { doctorRequestSchemas } from '@shared/ipc/schemas/doctor'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const doctorHandlers: IpcHandlersFor<typeof doctorRequestSchemas> = {
  'diagnostics.doctor.run': async (input) => application.get('DoctorService').run(input),
  'diagnostics.doctor.cancel': async ({ runId }) => application.get('DoctorService').cancel(runId),
  'diagnostics.doctor.fix': async (input) => application.get('DoctorService').fix(input)
}
