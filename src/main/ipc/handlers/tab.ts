import { application } from '@application'
import type { tabRequestSchemas } from '@shared/ipc/schemas/tab'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const tabHandlers: IpcHandlersFor<typeof tabRequestSchemas> = {
  'tab.attach': async (payload, { senderId }) => application.get('SubWindowService').attachTab(payload, senderId),
  'tab.detach': async (payload) => application.get('SubWindowService').detachTab(payload),
  'tab.drag_end': async (_input, { senderId }) => {
    if (!senderId) return
    const win = application.get('WindowManager').getWindow(senderId)
    if (win && !win.isDestroyed() && win.getOpacity() < 1) win.setOpacity(1)
  }
}
