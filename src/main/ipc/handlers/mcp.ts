import { application } from '@application'
import type { mcpRequestSchemas } from '@shared/ipc/schemas/mcp'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * MCP request handlers. Delegation spans three services: McpRuntimeService (server
 * lifecycle + queries), McpCatalogService (server.refresh_tools), and McpPackageService
 * (package upload). The former NonEmptyString guards now live in the route schemas. Upload
 * receives the file as an ArrayBuffer (the renderer does `file.arrayBuffer()`);
 * McpPackageService stages it to a temp file and installs it. The server.added /
 * tool.call_progress / server.log events are emitted by the services, not here.
 */
export const mcpHandlers: IpcHandlersFor<typeof mcpRequestSchemas> = {
  // Server lifecycle + per-server queries.
  'mcp.server.remove': async ({ serverId }) => {
    await application.get('McpRuntimeService').removeServer(serverId)
  },
  'mcp.server.restart': async ({ serverId, interactive }) => {
    await application.get('McpRuntimeService').restartServer(serverId, {
      authMode: interactive ? 'interactive' : 'silent'
    })
  },
  'mcp.server.stop': async ({ serverId }) => {
    await application.get('McpRuntimeService').stopServer(serverId)
  },
  'mcp.server.refresh_tools': async ({ serverId, interactive }) => {
    await application.get('McpCatalogService').refreshTools(serverId, {
      authMode: interactive ? 'interactive' : 'silent'
    })
  },
  'mcp.server.list_prompts': async ({ serverId }) => application.get('McpRuntimeService').listPrompts(serverId),
  'mcp.server.list_resources': async ({ serverId }) => application.get('McpRuntimeService').listResources(serverId),
  'mcp.server.check_connectivity': async ({ serverId }) =>
    application.get('McpRuntimeService').checkMcpConnectivity(serverId),
  'mcp.server.get_version': async ({ serverId }) => application.get('McpRuntimeService').getServerVersion(serverId),
  'mcp.server.get_logs': async ({ serverId }) => application.get('McpRuntimeService').getServerLogs(serverId),
  // In-flight tool-call control.
  'mcp.tool.abort_call': async ({ callId }) => application.get('McpRuntimeService').abortTool(callId),
  // Package upload.
  'mcp.package.upload_dxt': async ({ buffer, fileName }) =>
    application.get('McpPackageService').uploadDxt(buffer, fileName),
  'mcp.package.upload_mcpb': async ({ buffer, fileName }) =>
    application.get('McpPackageService').uploadMcpb(buffer, fileName)
}
