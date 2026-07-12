/**
 * Hermes tool progress event — emitted by the SSE filter when the API server
 * sends a `hermes.tool.progress` custom SSE event.
 *
 * Mirrors the payload from Hermes Agent's api_server.py (#6972, #16588).
 */
export type HermesToolProgressEvent = {
  /** Tool function name (e.g. "web_search", "read_file") */
  tool: string
  /** Emoji for the tool (e.g. "🔍", "📄") — only present on "running" events */
  emoji?: string
  /** Human-readable label / preview — only present on "running" events */
  label?: string
  /** OpenAI-style tool call ID for correlation */
  toolCallId: string
  /** "running" when the tool starts, "completed" when it finishes */
  status: 'running' | 'completed'
}
