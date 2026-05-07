import type { SectionContributor } from './types'

const PERSISTED_OUTPUT_TEXT = `<context-persistence>
Tool outputs that exceed the configured size threshold are automatically replaced with a marker like:

\`\`\`
<persisted-output>
output truncated (N lines, M chars total)
Full output saved to: /absolute/path/to/persisted_file.txt
URI (alternative): context://vfs/...
</persisted-output>
\`\`\`

To inspect the full content, call \`fs__read\` with the absolute path shown after \`Full output saved to:\`. Use \`offset\` and \`limit\` parameters to page through large files — \`fs__read\` will refuse to return more than ~30000 chars in a single call (it returns an \`output-too-large\` error suggesting smaller \`limit\`).

The persistence layer applies to non-read tools only (e.g. shell exec, MCP tools). Read tools (\`fs__read\`) never persist their output — instead they reject oversized pages directly and ask you to narrow the read.
</context-persistence>`

/**
 * Tells the model how to retrieve content that chef has persisted to
 * disk via its `<persisted-output>` marker, and warns about the
 * `output-too-large` error path on `fs__read` itself.
 *
 * Gated on `contextSettings.enabled` — chef only persists when context
 * settings are active.
 *
 * Cacheable: text is static and the gate flips only on user setting
 * change, not per call.
 */
export const persistedOutputSection: SectionContributor = (ctx) => {
  if (ctx.contextSettings?.enabled !== true) return undefined

  return {
    id: 'persisted_output',
    text: PERSISTED_OUTPUT_TEXT,
    cacheable: true
  }
}
