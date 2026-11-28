import { application } from '@application'
import type { computerUseRequestSchemas } from '@shared/ipc/schemas/computerUse'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const computerUseHandlers: IpcHandlersFor<typeof computerUseRequestSchemas> = {
  'computer_use.revoke_approval': ({ identity }) => application.get('ComputerUseService').approvals.revoke(identity),
  'computer_use.get_approvals': async (_, { senderId }) =>
    application.get('ComputerUseService').approvals.list(senderId),
  'computer_use.respond_approval': async ({ approvalId, scope }, { senderId }) =>
    application.get('ComputerUseService').approvals.respond(approvalId, scope, senderId),
  'computer_use.get_call_apps': async ({ cell }) => application.get('AutomationReplService').getCallApps(cell),
  'computer_use.get_app_icon': ({ identity }) => application.get('ComputerUseService').getAppIcon(identity),
  'computer_use.get_controls': async () => application.get('ComputerUseService').getControls(),
  'computer_use.stop_app': async ({ ownerId, appId }) => {
    await application.get('ComputerUseService').stopApp(ownerId, appId)
  },
  'computer_use.stop_all': async () => {
    await application.get('ComputerUseService').stopAll()
  },
  'computer_use.get_permission_status': () => application.get('ComputerUseService').getPermissionStatus(),
  'computer_use.request_permissions': ({ ids }) => application.get('ComputerUseService').requestPermissions(ids)
}
