import { application } from '@application'
import type { doctorAgentRequestSchemas } from '@shared/ipc/schemas/doctorAgent'
import type { IpcHandlersFor } from '@shared/ipc/types'

import { exposeAiError } from './exposeAiError'

export const doctorAgentHandlers: IpcHandlersFor<typeof doctorAgentRequestSchemas> = {
  'diagnostics.doctor.agent.check_model': ({ modelId }) =>
    exposeAiError('diagnostics.doctor.agent.check_model', () =>
      application.get('DoctorAgentService').checkModel(modelId)
    ),
  'diagnostics.doctor.agent.start': (input) =>
    exposeAiError('diagnostics.doctor.agent.start', () => application.get('DoctorAgentService').start(input)),
  'diagnostics.doctor.agent.cancel': async ({ scope, runId }) =>
    application.get('DoctorAgentService').cancel(scope, runId),
  'diagnostics.doctor.agent.apply': async (input) => application.get('DoctorAgentService').apply(input),
  'diagnostics.doctor.agent.undo': async (input) => application.get('DoctorAgentService').undo(input)
}
