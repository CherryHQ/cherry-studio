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

Paging is line-based and each line is capped at ~2000 chars: if a persisted output is a single very long physical line (e.g. minified JSON or one long log line), \`${FS_READ_TOOL_NAME}\` can only return that line's first ~2000 chars. Treat such a result as a head excerpt, not the full content — don't assume you've read the rest.

The persistence layer applies to non-read tools only (e.g. MCP tools). \`${FS_READ_TOOL_NAME}\` never persists its own output — narrow the read instead.
</context-persistence>`
