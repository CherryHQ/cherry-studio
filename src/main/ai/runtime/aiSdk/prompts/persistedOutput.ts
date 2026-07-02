/**
 * Teaches the model the persisted-output protocol: how truncated tool
 * results look and how to retrieve them via fs_read. Adapted from PR
 * #14916's persistedOutputSection (its "~30000 chars" prose corrected to
 * the actual per-call cap). Static text — safe for provider prompt caches.
 */
import { CONTEXT_PERSIST_THRESHOLD_CHARS, FS_READ_TOOL_NAME } from '@shared/ai/builtinTools'

export const PERSISTED_OUTPUT_SYSTEM_PROMPT = `<context-persistence>
For tool outputs that exceed the size threshold, only the head and tail are kept inline, with a marker in between like:

<persisted-output>
output truncated (N lines, M chars total; first X chars shown above, last Y chars shown below)
Full output saved to: /absolute/path/to/persisted_file.txt
URI (alternative): context://vfs/...
</persisted-output>

To inspect the full content, call \`${FS_READ_TOOL_NAME}\` with the absolute path shown after "Full output saved to:". Page through large files with \`offset\` and \`limit\` — a single call returns at most ~${CONTEXT_PERSIST_THRESHOLD_CHARS} chars; oversized pages come back as an \`output-too-large\` error with a recommended \`limit\` for that file.

Paging is line-based and lines come back in full (never chopped mid-line). The one case it can't subdivide is a single physical line larger than the per-call cap (e.g. heavily minified JSON): line paging can't split one line, so \`${FS_READ_TOOL_NAME}\` reports \`output-too-large\` for it. For that input, reason from the inline head/tail excerpt rather than assuming you can page to the rest.

When you retrieve a persisted output to summarize, analyze, or act on it, read it in sequential pages (advance \`offset\` to the returned \`endLine\` + 1) until you have covered 100% of the content. Before summarizing or drawing conclusions, state what fraction you actually read — and if you did not read all of it (including the single-oversized-line case above), say so explicitly rather than implying full coverage.

The persistence layer applies to non-read tools only (e.g. MCP tools). \`${FS_READ_TOOL_NAME}\` never persists its own output — narrow the read instead.
</context-persistence>`
