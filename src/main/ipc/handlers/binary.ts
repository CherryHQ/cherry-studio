import { application } from '@application'
import { CODE_CLI_TOOL_PRESET_BY_EXECUTABLE } from '@shared/data/presets/codeCliTools'
import type { binaryRequestSchemas } from '@shared/ipc/schemas/binary'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Thin adapters for the BinaryManager routes — each delegates to the matching
 * public `BinaryManager` method, which owns all install orchestration, state, and
 * the deep validation of the install spec. Input is already shape-parsed by the
 * route schema; the source-trust gate (validateSender) runs before dispatch.
 */
export const binaryHandlers: IpcHandlersFor<typeof binaryRequestSchemas> = {
  'binary.install_tool': async (request) =>
    CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[request.name]
      ? application.get('CodeCliService').installCli(request)
      : application.get('BinaryManager').installByName(request),
  'binary.add_custom_tool': async (definition) => application.get('BinaryManager').addCustomTool(definition),
  'binary.remove_tool': async (request) =>
    CODE_CLI_TOOL_PRESET_BY_EXECUTABLE[request.name]
      ? application.get('CodeCliService').removeCli(request)
      : application.get('BinaryManager').removeTool(request),
  'binary.get_tool_snapshots': async (names) => application.get('BinaryManager').getToolSnapshots(names),
  'binary.search_registry': async (query) => application.get('BinaryManager').searchRegistry(query),
  'binary.get_latest_versions': async (force) => application.get('BinaryManager').getLatestVersions(force)
}
