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

function renderDotenvEntry(key: string, value: string): string {
  return `${key}=${needsDotenvQuoting(value) ? quoteDotenvValue(value) : value}`
}

/**
 * One block of an existing .env file: a `KEY=value` entry (spanning multiple
 * physical lines when its quoted value does) or a line dotenv ignores
 * (comment, blank, garbage) carried through verbatim.
 */
interface DotenvBlock {
  key: string | null
  lines: string[]
}

// Mirrors the key half of dotenv's LINE regex (`export ` prefix, `KEY=` / `KEY: `).
const DOTENV_ENTRY_START = /^\s*(?:export\s+)?([\w.-]+)(?:\s*=|:\s+)(.*)$/

function hasUnescapedQuote(text: string, quote: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === quote) return true
  }
  return false
}

function splitDotenvBlocks(content: string): DotenvBlock[] {
  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const blocks: DotenvBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = DOTENV_ENTRY_START.exec(lines[i])
    if (!match) {
      blocks.push({ key: null, lines: [lines[i]] })
      continue
    }
    const blockLines = [lines[i]]
    const rest = match[2].trimStart()
    const quote = ["'", '"', '`'].includes(rest[0]) ? rest[0] : null
    if (quote && !hasUnescapedQuote(rest.slice(1), quote)) {
      // The quoted value continues on later lines; consume up to the closing quote.
      let closed = false
      for (let j = i + 1; j < lines.length; j++) {
        blockLines.push(lines[j])
        if (hasUnescapedQuote(lines[j], quote)) {
          closed = true
          i = j
          break
        }
      }
      // No closing quote anywhere — dotenv reads the opening line alone as a
      // literal single-line value, so leave the rest for the normal scan.
      if (!closed) blockLines.length = 1
    }
    // Demote to a verbatim line when dotenv itself cannot parse the block.
    const key = match[1] in parseWithDotenv(blockLines.join('\n')) ? match[1] : null
    blocks.push({ key, lines: blockLines })
  }
  return blocks
}

/**
 * Render an env map back to file text. When `originalContent` is supplied, the
 * rewrite is a merge that keeps everything dotenv ignores (comments, blank
 * lines, unparseable lines) and unchanged entries byte-for-byte: an entry
 * whose value changed is re-rendered in place, a key deleted from `envMap`
 * loses every occurrence, and keys new to the map are appended at the end.
 */
export function renderDotenvFile(envMap: Map<string, string>, originalContent = ''): string {
  const blocks = splitDotenvBlocks(originalContent)
  // dotenv is last-occurrence-wins, so only a key's final block is authoritative;
  // earlier (shadowed) duplicates are kept verbatim below.
  const lastBlockByKey = new Map<string, DotenvBlock>()
  for (const block of blocks) {
    if (block.key) lastBlockByKey.set(block.key, block)
  }

  const out: string[] = []
  for (const block of blocks) {
    if (!block.key) {
      out.push(...block.lines)
    } else if (!envMap.has(block.key)) {
      // deleted key — drop every occurrence so it cannot resurface on read-back
    } else if (
      lastBlockByKey.get(block.key) !== block ||
      parseWithDotenv(block.lines.join('\n'))[block.key] === envMap.get(block.key)
    ) {
      out.push(...block.lines)
    } else {
      out.push(renderDotenvEntry(block.key, envMap.get(block.key) as string))
    }
  }
  for (const [key, value] of envMap) {
    if (!lastBlockByKey.has(key)) out.push(renderDotenvEntry(key, value))
  }
  return `${out.join('\n')}\n`
}
