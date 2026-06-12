/**
 * Teaches the model the persisted-output protocol: how truncated tool
 * results look and how to retrieve them via fs__read. Adapted from PR
 * #14916's persistedOutputSection (its "~30000 chars" prose corrected to
 * the actual per-call cap). Static text — safe for provider prompt caches.
 */
import { CONTEXT_PERSIST_THRESHOLD_CHARS } from '@shared/ai/builtinTools'

export const PERSISTED_OUTPUT_SYSTEM_PROMPT = `<context-persistence>
Tool outputs that exceed the size threshold are automatically replaced with a marker like:

<persisted-output>
output truncated (N lines, M chars total)
Full output saved to: /absolute/path/to/persisted_file.txt
URI (alternative): context://vfs/...
</persisted-output>

To inspect the full content, call \`fs__read\` with the absolute path shown after "Full output saved to:". Page through large files with \`offset\` and \`limit\` — a single call returns at most ~${CONTEXT_PERSIST_THRESHOLD_CHARS} chars; oversized pages come back as an \`output-too-large\` error with a recommended \`limit\` for that file.

The persistence layer applies to non-read tools only (e.g. MCP tools). \`fs__read\` never persists its own output — narrow the read instead.
</context-persistence>`
