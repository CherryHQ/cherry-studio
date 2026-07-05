/** Parse a dotenv file into an ordered key-value map, preserving entry order. */
export function parseDotenv(content: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, '$1')
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    out.set(key, value)
  }
  return out
}

// Bare (unquoted) dotenv values are truncated by standard dotenv parsers at the
// first `#`, and lose leading/trailing whitespace — quote whenever that would
// otherwise corrupt the value on read-back by the CLI tool's own loader.
function needsDotenvQuoting(value: string): boolean {
  return value === '' || /^\s|\s$|["'#\\]/.test(value)
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
