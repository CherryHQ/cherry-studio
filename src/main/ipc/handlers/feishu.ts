import { application } from '@application'
import { credentialErrorCodes } from '@shared/ipc/errors/credential'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { feishuRequestSchemas } from '@shared/ipc/schemas/feishu'
import type { IpcHandlersFor } from '@shared/ipc/types'

async function registrationCommand<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch {
    throw new IpcError(credentialErrorCodes.UNAVAILABLE)
  }
}

export const feishuHandlers: IpcHandlersFor<typeof feishuRequestSchemas> = {
  'feishu.registration.begin': async (input, { senderId }) =>
    registrationCommand(() =>
      input.purpose === 'knowledge'
        ? application
            .get('KnowledgeService')
            .beginFeishuAppRegistration(senderId, input.requestId, input.applicationCredentialId)
        : application.get('FeishuRegistrationService').beginWindow(senderId, input)
    ),
  'feishu.registration.complete': async ({ registrationSessionId }, { senderId }) =>
    registrationCommand(() => application.get('FeishuRegistrationService').complete(senderId, registrationSessionId)),
  'feishu.registration.cancel': async ({ registrationSessionId }, { senderId }) => {
    application.get('FeishuRegistrationService').cancel(senderId, registrationSessionId)
  }
}
