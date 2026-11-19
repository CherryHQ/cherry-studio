import { application } from '@application'
import { dispatchHandle } from '@main/services/file'
import type { fileObservationRequestSchemas } from '@shared/ipc/schemas/fileObservation'
import type { IpcHandlersFor, WindowId } from '@shared/ipc/types'

function requireOwner(senderId: WindowId | null) {
  const webContents = senderId === null ? undefined : application.get('WindowManager').getWindow(senderId)?.webContents
  if (senderId === null || !webContents) throw new Error('File observation requires a managed window sender')
  return { windowId: senderId, webContents }
}

export const fileObservationHandlers: IpcHandlersFor<typeof fileObservationRequestSchemas> = {
  'file.observe.open': async ({ handle }, { senderId }) => {
    const owner = requireOwner(senderId)
    const target = await dispatchHandle(
      handle,
      async (entryId) => application.get('FileManager').getPhysicalPath(entryId),
      async (path) => path
    )
    return application.get('FileObservationService').open(owner, target)
  },
  'file.observe.activate': async ({ subscriptionId, revision }, { senderId }) =>
    application
      .get('FileObservationService')
      .activateSubscription(subscriptionId, revision, requireOwner(senderId).webContents.id),
  'file.observe.close': async ({ subscriptionId }, { senderId }) =>
    application.get('FileObservationService').close(subscriptionId, requireOwner(senderId).webContents.id)
}
