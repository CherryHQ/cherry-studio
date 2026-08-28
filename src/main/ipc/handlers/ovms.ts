import { application } from '@application'
import { isWin } from '@main/core/platform'
import { runInstallScript } from '@main/utils/processRunner'
import { getCpuName } from '@main/utils/system'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { ovmsErrorCodes } from '@shared/ipc/errors/ovms'
import type { ovmsRequestSchemas } from '@shared/ipc/schemas/ovms'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * OVMS handlers. `is_supported` is the platform gate itself (must keep this predicate in
 * sync with OvmsManager's `@Conditional(onPlatform('win32'), onCpuVendor('intel'))`), and
 * `install_binary` just runs the install script — neither needs the service. The five
 * operation routes resolve OvmsManager at call time (it exists only on Win32+Intel) and
 * throw OVMS_NOT_AVAILABLE when the service is not active.
 */
function requireOvms() {
  const manager = application.getOptional('OvmsManager')
  if (!manager) {
    throw new IpcError(ovmsErrorCodes.OVMS_NOT_AVAILABLE, 'OVMS is only available on Windows with an Intel CPU')
  }
  return manager
}

export const ovmsHandlers: IpcHandlersFor<typeof ovmsRequestSchemas> = {
  'ovms.is_supported': async () => isWin && getCpuName().toLowerCase().includes('intel'),
  'ovms.install_binary': async () => {
    await runInstallScript('install-ovms.js')
  },
  'ovms.add_model': async ({ modelName, modelId, modelSource, task }) =>
    requireOvms().addModel(modelName, modelId, modelSource, task),
  'ovms.cancel_add_model': async () => {
    await requireOvms().stopAddModel()
  },
  'ovms.get_status': async () => requireOvms().getOvmsStatus(),
  'ovms.start': async () => {
    const result = await requireOvms().runOvms()
    if (!result.success) throw new IpcError(ovmsErrorCodes.OVMS_START_FAILED, result.message ?? 'Failed to start OVMS')
  },
  'ovms.stop': async () => {
    const result = await requireOvms().stopOvms()
    if (!result.success) throw new IpcError(ovmsErrorCodes.OVMS_STOP_FAILED, result.message ?? 'Failed to stop OVMS')
  }
}
