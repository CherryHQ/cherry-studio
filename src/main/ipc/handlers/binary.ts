import { application } from '@application'
import type { binaryRequestSchemas } from '@shared/ipc/schemas/binary'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the BinaryManager routes — each delegates to the matching
 * public `BinaryManager` method, which owns all install orchestration, state, and
 * the deep validation of the install spec. Input is already shape-parsed by the
 * route schema; the source-trust gate (validateSender) runs before dispatch.
 *
 * `install_tool` / `claim_tool` / `remove_tool` mutate the durable ownership
 * manifest (install_tool can additionally execute arbitrary package postinstall
 * code), so they refuse a `senderId: null` caller — one that passed validateSender
 * but is not a WindowManager-managed window. `validateSender` and `senderId` are
 * independent trust sources that are not cross-checked, so a sensitive route gates
 * on `senderId` explicitly rather than assuming a window is present (see
 * ipc-overview.md "Caller Identity"). The read-only query routes have no such side
 * effect and need no gate.
 *
 * This is a should-never-happen guard the renderer does not branch on, so it
 * throws a plain Error (normalized to the framework's INTERNAL code), mirroring
 * the managed-window gates in the ai/translate handlers — not a domain IpcError
 * code, which is reserved for failures the renderer must branch on.
 */
function requireManagedSender(senderId: string | null, route: string): void {
  if (senderId == null) throw new Error(`${route} requires a managed window`)
}

export const binaryHandlers: IpcHandlersFor<typeof binaryRequestSchemas> = {
  'binary.install_tool': async (tool, { senderId }) => {
    requireManagedSender(senderId, 'binary.install_tool')
    return application.get('BinaryManager').installTool(tool)
  },
  'binary.claim_tool': async (intent, { senderId }) => {
    requireManagedSender(senderId, 'binary.claim_tool')
    return application.get('BinaryManager').claimTool(intent)
  },
  'binary.remove_tool': async (name, { senderId }) => {
    requireManagedSender(senderId, 'binary.remove_tool')
    return application.get('BinaryManager').removeTool(name)
  },
  'binary.get_tool_snapshots': async (names) => application.get('BinaryManager').getToolSnapshots(names),
  'binary.search_registry': async (query) => application.get('BinaryManager').searchRegistry(query),
  'binary.get_latest_versions': async (force) => application.get('BinaryManager').getLatestVersions(force)
}
