import { application } from '@application'
import type { doctorAgentRequestSchemas } from '@shared/ipc/schemas/doctorAgent'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const doctorAgentHandlers: IpcHandlersFor<typeof doctorAgentRequestSchemas> = {
  'diagnostics.doctor.agent.start': async (input) => application.get('DoctorAgentService').start(input),
  'diagnostics.doctor.agent.cancel': async ({ scope, runId }) =>
    application.get('DoctorAgentService').cancel(scope, runId),
  'diagnostics.doctor.agent.apply': async (input) => application.get('DoctorAgentService').apply(input),
  'diagnostics.doctor.agent.undo': async (input) => application.get('DoctorAgentService').undo(input)
}
