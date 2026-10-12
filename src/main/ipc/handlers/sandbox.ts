import { application } from '@application'
import type { sandboxRequestSchemas } from '@shared/ipc/schemas/sandbox'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const sandboxHandlers: IpcHandlersFor<typeof sandboxRequestSchemas> = {
  'sandbox.probe': async () => application.get('SandboxService').probe(),
  'sandbox.run': async (input, { senderId }) => application.get('SandboxService').run(input, senderId),
  'sandbox.stop': async (_, { senderId }) => application.get('SandboxService').stopRun(senderId)
}
