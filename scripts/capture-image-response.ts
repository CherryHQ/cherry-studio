/**
 * Capture a raw image-generation response, for fixturing the response parsers
 * under `src/renderer/aiCore/provider/custom/__tests__/boundary/__fixtures__/`.
 *
 * Self-contained (no app imports): it just performs one HTTP request and prints
 * the raw JSON response. The API key is read from your shell — it is never
 * hard-coded, stored, or echoed by this script. Run it locally; paste only the
 * response JSON (redact signed URLs / PII) into a fixture.
 *
 * Usage:
 *   npx tsx scripts/capture-image-response.ts \
 *     --url 'https://www.dmxapi.com/v1/images/generations' \
 *     --header "Authorization: Bearer $DMXAPI_API_KEY" \
 *     --body '{"model":"flux-1","prompt":"a fox","n":1,"response_format":"url"}'
 *
 * Flags: --url (required), --body (JSON string; omit for GET), --method
 * (default POST, or GET when --body is absent), --header (repeatable
 * "Name: value"), --out <file> (also write the response there).
 */
import { writeFileSync } from 'node:fs'

interface Args {
  url?: string
  body?: string
  method?: string
  out?: string
  headers: Record<string, string>
}

function parseArgs(argv: string[]): Args {
  const args: Args = { headers: {} }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[++i]
    if (value === undefined) throw new Error(`Missing value for ${flag}`)
    switch (flag) {
      case '--url':
        args.url = value
        break
      case '--body':
        args.body = value
        break
      case '--method':
        args.method = value.toUpperCase()
        break
      case '--out':
        args.out = value
        break
      case '--header': {
        const idx = value.indexOf(':')
        if (idx === -1) throw new Error(`Invalid --header (expected "Name: value"): ${value}`)
        args.headers[value.slice(0, idx).trim()] = value.slice(idx + 1).trim()
        break
      }
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.url) throw new Error('--url is required')

  const method = args.method ?? (args.body ? 'POST' : 'GET')
  const headers: Record<string, string> = { Accept: 'application/json', ...args.headers }
  if (args.body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json'
  }

  // Show the request WITHOUT auth values.
  const safeHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, /authorization|api-key|x-api-key|token/i.test(k) ? '<redacted>' : v])
  )
  process.stderr.write(`→ ${method} ${args.url}\n  headers: ${JSON.stringify(safeHeaders)}\n`)

  const res = await fetch(args.url, { method, headers, body: args.body })
  const text = await res.text()
  process.stderr.write(`← ${res.status} ${res.statusText}\n`)

  let pretty = text
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    // not JSON — print as-is
  }
  process.stdout.write(pretty + '\n')
  if (args.out) {
    writeFileSync(args.out, pretty + '\n')
    process.stderr.write(`(written to ${args.out})\n`)
  }
  if (!res.ok) process.exitCode = 1
}

main().catch((err) => {
  process.stderr.write(`capture failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
