import { parse as parseWithDotenv } from 'dotenv'

/**
 * Parse a dotenv file into an ordered key-value map.
 *
 * Delegates to the real `dotenv` package — the same loader the CLI tools use to read these files
 * back — so `export KEY=…` prefixes, inline `# comments`, quote handling, and multi-line quoted
 * values all match its semantics (parsing `export GEMINI_API_KEY=…` as the bare key, not
 * `export …`, is what lets `clearCliConfig` actually scrub the managed secret). `dotenv.parse`
 * assigns keys in the order they appear in the file and object insertion order preserves that, so
 * the returned Map keeps entry order for the ordered rewrite in `renderDotenvFile`.
 */
export function parseDotenv(content: string): Map<string, string> {
  return new Map(Object.entries(parseWithDotenv(content)))
}

// Bare (unquoted) dotenv values are truncated by standard dotenv parsers at the
// first `#`, lose leading/trailing whitespace, and — for an embedded newline —
// get split across physical lines (dropping everything after the first line).
// Quote whenever that would otherwise corrupt the value on read-back by the CLI
// tool's own loader.
function needsDotenvQuoting(value: string): boolean {
  return value === '' || /^\s|\s$|[\n\r"'#\\]/.test(value)
}

// The real `dotenv` package (used by the CLI tools that read these files back) only re-expands
// literal `\n`/`\r` sequences inside a double-quoted value on read — it does NOT unescape `\\` or
// `\"`, so injecting those escapes here would corrupt the value on read-back instead of preserving
// it. A single-quoted value, by contrast, is taken back 100% literally with no escape processing at
// all, so prefer it whenever the value has no embedded single quote to conflict with the wrapper.
function quoteDotenvValue(value: string): string {
  if (!value.includes("'")) return `'${value}'`
  return `"${value.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`
}

export function renderDotenvFile(envMap: Map<string, string>): string {
  return `${[...envMap.entries()]
    .map(([key, value]) => `${key}=${needsDotenvQuoting(value) ? quoteDotenvValue(value) : value}`)
    .join('\n')}\n`
}
