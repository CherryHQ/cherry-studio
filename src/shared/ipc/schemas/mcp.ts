import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpProgressEvent, McpServerLogEntry } from '@shared/types/mcp'
import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * MCP (Model Context Protocol) IPC schemas, grouped by subject:
 *   - `mcp.server.*` — server lifecycle + per-server queries (all serverId-scoped)
 *   - `mcp.tool.*`   — in-flight tool-call control
 *   - `mcp.package.*`— .dxt/.mcpb package upload
 * plus three push events. Handlers span three services (McpRuntimeService /
 * McpCatalogService / McpPackageService); see handlers/mcp.ts.
 *
 * `server.list_prompts` / `server.list_resources` keep `z.any()` outputs: the legacy preload
 * returned `Promise<any>` and the renderer consumes the result untyped, so the migration
 * preserves that rather than tightening it. Upload inputs carry the file as an ArrayBuffer
 * (structured-clone safe); the renderer does `file.arrayBuffer()` at the call site now.
 */
const serverId = z.object({ serverId: z.string() })
const serverIdNonEmpty = z.object({ serverId: z.string().min(1) })
const uploadInput = z.object({ buffer: z.instanceof(ArrayBuffer), fileName: z.string() })

export const mcpRequestSchemas = {
  // Server lifecycle + per-server queries.
  'mcp.server.remove': defineRoute({ input: serverId, output: z.void() }),
  'mcp.server.restart': defineRoute({ input: serverId, output: z.void() }),
  'mcp.server.stop': defineRoute({ input: serverId, output: z.void() }),
  'mcp.server.refresh_tools': defineRoute({ input: serverId, output: z.void() }),
  'mcp.server.list_prompts': defineRoute({ input: serverIdNonEmpty, output: z.any() }),
  'mcp.server.list_resources': defineRoute({ input: serverIdNonEmpty, output: z.any() }),
  'mcp.server.check_connectivity': defineRoute({ input: serverIdNonEmpty, output: z.boolean() }),
  'mcp.server.get_version': defineRoute({ input: serverIdNonEmpty, output: z.string().nullable() }),
  'mcp.server.get_logs': defineRoute({ input: serverIdNonEmpty, output: z.custom<McpServerLogEntry[]>() }),
  // In-flight tool-call control.
  'mcp.tool.abort_call': defineRoute({ input: z.object({ callId: z.string().min(1) }), output: z.boolean() }),
  // Package upload. Output kept as `z.any()` (McpPackageUploadResult, whose `data.manifest`
  // type lives in src/main): matches the legacy preload's `Promise<any>` and avoids hoisting
  // the manifest type into @shared for this transport migration.
  'mcp.package.upload_dxt': defineRoute({ input: uploadInput, output: z.any() }),
  'mcp.package.upload_mcpb': defineRoute({ input: uploadInput, output: z.any() })
}

export type McpEventSchemas = {
  'mcp.server.added': McpServer
  'mcp.server.log': McpServerLogEntry & { serverId: string }
  'mcp.tool.call_progress': McpProgressEvent
}
