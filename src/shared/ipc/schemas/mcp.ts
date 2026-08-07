import { ProtocolMcpInstallRequestSchema } from '@shared/data/types/mcpProtocolInstall'
import { McpServerSchema } from '@shared/data/types/mcpServer'
import type { McpProgressEvent, McpServerLogEntry } from '@shared/types/mcp'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * MCP (Model Context Protocol) IPC schemas, grouped by subject:
 *   - `mcp.protocol_install.*` — one-shot external install preview handoff
 *   - `mcp.server.*` — server lifecycle + per-server queries (all serverId-scoped)
 *   - `mcp.tool.*`   — in-flight tool-call control
 *   - `mcp.package.*`— .dxt/.mcpb package upload
 * plus three push events. Handlers span three services (McpRuntimeService /
 * McpCatalogService / McpPackageService); see handlers/mcp.ts.
 *
 * `server.list_prompts` / `server.list_resources` / `server.get_prompt` / `server.get_resource` keep
 * `z.any()` outputs: they hand back raw MCP protocol shapes (`GetPromptResult`,
 * `GetResourceResponse`) whose types live in the SDK / src/main, and the renderer consumes them
 * untyped — same contract the legacy preload had. Upload inputs carry the file as an ArrayBuffer
 * (structured-clone safe); the renderer does `file.arrayBuffer()` at the call site now.
 */
const serverId = z.object({ serverId: z.string() })
const serverIdNonEmpty = z.object({ serverId: z.string().min(1) })
const uploadInput = z.object({ buffer: z.instanceof(ArrayBuffer), fileName: z.string() })
const protocolInstallRequestId = z.object({ requestId: z.uuid() })

export const mcpRequestSchemas = {
  // Server lifecycle + per-server queries.
  'mcp.server.remove': defineRoute({ input: serverId, output: z.void() }),
  'mcp.server.restart': defineRoute({ input: serverId, output: z.void() }),
  'mcp.server.stop': defineRoute({ input: serverId, output: z.void() }),
  'mcp.server.refresh_tools': defineRoute({ input: serverId, output: z.void() }),
  'mcp.server.list_prompts': defineRoute({ input: serverIdNonEmpty, output: z.any() }),
  'mcp.server.list_resources': defineRoute({ input: serverIdNonEmpty, output: z.any() }),
  'mcp.server.get_prompt': defineRoute({
    input: z.object({
      serverId: z.string().min(1),
      name: z.string().min(1),
      args: z.record(z.string(), z.any()).optional()
    }),
    output: z.any()
  }),
  'mcp.server.get_resource': defineRoute({
    input: z.object({ serverId: z.string().min(1), uri: z.string().min(1) }),
    output: z.any()
  }),
  'mcp.server.check_connectivity': defineRoute({ input: serverIdNonEmpty, output: z.boolean() }),
  'mcp.server.get_version': defineRoute({ input: serverIdNonEmpty, output: z.string().nullable() }),
  'mcp.server.get_logs': defineRoute({ input: serverIdNonEmpty, output: z.custom<McpServerLogEntry[]>() }),
  'mcp.protocol_install.list_pending': defineRoute({
    input: z.void(),
    output: ProtocolMcpInstallRequestSchema.array()
  }),
  'mcp.protocol_install.install': defineRoute({
    input: protocolInstallRequestId,
    output: McpServerSchema.array()
  }),
  'mcp.protocol_install.cancel': defineRoute({ input: protocolInstallRequestId, output: z.void() }),
  // In-flight tool-call control.
  'mcp.tool.abort_call': defineRoute({ input: z.object({ callId: z.string().min(1) }), output: z.boolean() }),
  // Package upload. Output kept as `z.any()` (McpPackageUploadResult, whose `data.manifest`
  // type lives in src/main): matches the legacy preload's `Promise<any>` and avoids hoisting
  // the manifest type into @shared for this transport migration.
  'mcp.package.upload_dxt': defineRoute({ input: uploadInput, output: z.any() }),
  'mcp.package.upload_mcpb': defineRoute({ input: uploadInput, output: z.any() })
}

export type McpEventSchemas = {
  'mcp.server.log': McpServerLogEntry & { serverId: string }
  'mcp.tool.call_progress': McpProgressEvent
}
