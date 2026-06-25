import { application } from '@application'
import type { binaryRequestSchemas } from '@shared/ipc/schemas/binary'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the BinaryManager routes — each delegates to the matching
 * public `BinaryManager` method, which owns all install orchestration, state, and
 * the deep validation of the install spec. Input is already shape-parsed by the
 * route schema; the source-trust gate (validateSender) runs before dispatch.
 */
export const binaryHandlers: IpcHandlersFor<typeof binaryRequestSchemas> = {
  'binary.install_tool': async (tool) => application.get('BinaryManager').installTool(tool),
  'binary.remove_tool': async (name) => application.get('BinaryManager').removeTool(name),
  'binary.get_state': async () => application.get('BinaryManager').getState(),
  'binary.search_registry': async (query) => application.get('BinaryManager').searchRegistry(query),
  'binary.get_tool_dir': async (name) => application.get('BinaryManager').getToolDir(name),
  'binary.probe_bundled': async () => application.get('BinaryManager').probeBundled()
}
