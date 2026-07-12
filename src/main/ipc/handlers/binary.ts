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
  'binary.resolve_tools': async (names) => application.get('BinaryManager').resolveTools(names),
  'binary.search_registry': async (query) => application.get('BinaryManager').searchRegistry(query),
  'binary.get_latest_versions': async (force) => application.get('BinaryManager').getLatestVersions(force),
  'binary.list_tools': async () => application.get('BinaryManager').listTools()
}
