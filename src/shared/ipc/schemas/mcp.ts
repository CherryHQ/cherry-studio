import * as z from 'zod'

import { ProtocolMcpInstallRequestSchema } from '@shared/data/types/mcpProtocolInstall'
import { McpServerSchema } from '@shared/data/types/mcpServer'
import type { McpProgressEvent, McpServerLogEntry } from '@shared/types/mcp'

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
 * `server.list_prompts` / `server.list_resources` / `server.get_prompt` keep `z.any()` outputs: they
 * hand back raw MCP protocol shapes (`GetPromptResult`) whose types live in the SDK / src/main, and
 * the renderer consumes them untyped — same contract the legacy preload had.
 * `server.read_resource_preview` is typed, since its shape exists for the composer alone. Upload inputs carry the file as an ArrayBuffer
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
  // Bounded read for the composer: capped main-side so an oversized resource never crosses IPC in
  // full just to be discarded (`readMcpResourcePreview`).
  'mcp.server.read_resource_preview': defineRoute({
    input: z.object({
      serverId: z.string().min(1),
      uri: z.string().min(1),
      maxChars: z.number().int().positive()
    }),
    output: z.object({
      text: z.string(),
      totalChars: z.number().int().nonnegative(),
      mimeType: z.string().optional(),
      isBinary: z.boolean()
    })
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
  // In-flight tool-call control. `scope` is the caller-isolation key the call was registered
  // under (topicId for chat) — abort only matches within the same scope.
  'mcp.tool.abort_call': defineRoute({
    input: z.object({ callId: z.string().min(1), scope: z.string().min(1).optional() }),
    output: z.boolean()
  }),
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
