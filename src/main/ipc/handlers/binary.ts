import { application } from '@application'
import { binaryErrorCodes } from '@shared/ipc/errors/binary'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { binaryRequestSchemas } from '@shared/ipc/schemas/binary'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the BinaryManager routes — each delegates to the matching
 * public `BinaryManager` method, which owns all install orchestration, state, and
 * the deep validation of the install spec. Input is already shape-parsed by the
 * route schema; the source-trust gate (validateSender) runs before dispatch.
 *
 * `install_tool` / `remove_tool` mutate host state (install_tool can execute
 * arbitrary package postinstall code), so they additionally refuse a `senderId:
 * null` caller — one that passed validateSender but is not a WindowManager-managed
 * window. `validateSender` and `senderId` are independent trust sources that are
 * not cross-checked, so a sensitive route gates on `senderId` explicitly rather
 * than assuming a window is present (see ipc-overview.md "Caller Identity").
 * The read-only query routes have no such side effect and need no gate.
 */
function requireManagedSender(senderId: string | null): void {
  if (senderId == null) {
    throw new IpcError(binaryErrorCodes.BINARY_UNMANAGED_SENDER, 'Binary management is not available for this window')
  }
}

export const binaryHandlers: IpcHandlersFor<typeof binaryRequestSchemas> = {
  'binary.install_tool': async (tool, { senderId }) => {
    requireManagedSender(senderId)
    return application.get('BinaryManager').installTool(tool)
  },
  'binary.remove_tool': async (name, { senderId }) => {
    requireManagedSender(senderId)
    return application.get('BinaryManager').removeTool(name)
  },
  'binary.get_tool_snapshots': async (names) => application.get('BinaryManager').getToolSnapshots(names),
  'binary.search_registry': async (query) => application.get('BinaryManager').searchRegistry(query),
  'binary.get_latest_versions': async (force) => application.get('BinaryManager').getLatestVersions(force)
}
