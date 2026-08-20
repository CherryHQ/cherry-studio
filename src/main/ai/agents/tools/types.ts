/**
 * Agent-autonomy tool definitions consumed by Cherry's in-process MCP servers.
 *
 * Canonical schemas use the MCP-compatible JSON Schema form. Agent runtimes consume these tools
 * through the runtime-neutral MCP server set; they do not wrap these definitions directly.
 */

/** A single content block returned by a tool. Structurally shared by MCP and pi. */
export type NeutralToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** The result of invoking a tool handler. */
export interface NeutralToolResult {
  content: NeutralToolContent[]
  /**
   * Soft-failure flag. The tool ran to completion but the outcome is an error
   * the model should see (e.g. a notification that reached no one). Hard
   * failures (bad input, missing agent) are signalled by throwing `ToolError`.
   */
  isError?: boolean
}

/**
 * Error codes carried by {@link ToolError}. Values intentionally match the
 * JSON-RPC / MCP `ErrorCode` numbers so the MCP adapter can reproduce the
 * historical `MCP error <code>: <message>` wire text byte-for-byte.
 */
export enum ToolErrorCode {
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603
}

/**
 * A recoverable tool error. Handlers throw this for invalid input or missing
 * preconditions; each runtime adapter decides how to surface it (MCP encodes it
 * as an `isError` text result; pi rethrows so the agent loop encodes it).
 */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code?: ToolErrorCode
  ) {
    super(message)
    this.name = 'ToolError'
  }
}

/**
 * A runtime-neutral tool: name, description, JSON Schema input, and a handler
 * closed over per-session context `Ctx`.
 */
export interface NeutralTool<Ctx> {
  name: string
  description: string
  /** JSON Schema for the tool input (canonical form; see module doc). */
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: Ctx) => Promise<NeutralToolResult> | NeutralToolResult
}
