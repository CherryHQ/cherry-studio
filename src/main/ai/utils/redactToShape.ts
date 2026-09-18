import { isSensitiveKey, REDACTED, redactSecretText } from '@shared/utils/redaction'

const MAX_DEPTH = 5
const MAX_ARRAY_ITEMS = 8
const MAX_OBJECT_KEYS = 32
const MAX_NODES = 128
const MAX_LABEL_CHARS = 80
const MAX_SHAPE_BYTES = 4096

type PayloadKind = 'tool' | 'request' | 'response' | 'headers'

const REQUEST_NUMBERS = new Set([
  'temperature',
  'top_p',
  'top_k',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'frequency_penalty',
  'presence_penalty',
  'seed',
  'thinking.budget_tokens'
])
const REQUEST_LABELS = new Set(['model', 'tools[].name', 'tools[].function.name'])
const ROLE_PATH = /^(messages|contents)\[\]\.role$/
const TYPE_PATH = /^(messages\[\]\.content\[\]|tools\[\])\.type$/
const RESPONSE_CODE_PATH = /^(error\.|detail\.error\.|detail\.)?(code|type)$/

function keepScalar(value: unknown, path: string, kind: PayloadKind): boolean {
  if (kind === 'request') {
    if (typeof value === 'number') return REQUEST_NUMBERS.has(path)
    if (typeof value === 'boolean') return path === 'stream'
    if (typeof value !== 'string') return false
    if (REQUEST_LABELS.has(path)) return /^[\w./:-]{1,80}$/.test(value)
    if (ROLE_PATH.test(path))
      return ['system', 'developer', 'user', 'assistant', 'tool', 'model', 'function'].includes(value)
    if (TYPE_PATH.test(path))
      return ['text', 'image', 'image_url', 'tool_use', 'tool_result', 'function'].includes(value)
  }
  if (kind === 'response' && RESPONSE_CODE_PATH.test(path)) {
    return typeof value === 'number' || (typeof value === 'string' && /^[\w.-]{1,80}$/.test(value))
  }
  if (kind === 'headers' && typeof value === 'string') {
    if (path === 'content-type')
      return /^(application\/json|text\/event-stream|text\/plain)(;\s*charset=utf-8)?$/i.test(value)
    return (
      /^(retry-after|x-ratelimit-(limit|remaining|reset)-(requests|tokens))$/.test(path) &&
      /^[\d.smhd-]{1,40}$/.test(value)
    )
  }
  return false
}

/** Payload values are private by default; only protocol fields at known paths survive. */
export function redactToShape(value: unknown, kind: PayloadKind = 'tool'): unknown {
  let nodes = 0
  const shape = (val: unknown, depth: number, path: string): unknown => {
    if (nodes++ >= MAX_NODES) return '<truncated>'
    if (val === null || val === undefined) return null
    if (keepScalar(val, path, kind)) return typeof val === 'string' ? redactSecretText(val) : val
    if (typeof val === 'string') return `<string:${val.length}>`
    if (typeof val !== 'object') return `<${typeof val}>`
    if (depth >= MAX_DEPTH) return Array.isArray(val) ? `<array:${val.length}>` : '<object>'
    if (Array.isArray(val)) {
      const item = (entry: unknown) => shape(entry, depth + 1, `${path}[]`)
      if (val.length <= MAX_ARRAY_ITEMS) return val.map(item)
      const half = MAX_ARRAY_ITEMS / 2
      return [
        ...val.slice(0, half).map(item),
        `<${val.length - MAX_ARRAY_ITEMS} more items>`,
        ...val.slice(-half).map(item)
      ]
    }
    const out: Record<string, unknown> = Object.create(null)
    let keys = 0
    for (const key in val) {
      if (!Object.hasOwn(val, key)) continue
      if (keys >= MAX_OBJECT_KEYS || nodes >= MAX_NODES) {
        out['<truncated>'] = true
        break
      }
      keys += 1
      const label = key.length <= MAX_LABEL_CHARS ? key : `<key:${keys}:${key.length}>`
      const entry = (val as Record<string, unknown>)[key]
      const entryPath = path ? `${path}.${key}` : key
      // Only allowlisted protocol fields bypass the sensitive-key match, including token limits.
      out[label] =
        isSensitiveKey(key) && !keepScalar(entry, entryPath, kind) ? REDACTED : shape(entry, depth + 1, entryPath)
    }
    return out
  }
  const result = shape(value, 0, '')
  return Buffer.byteLength(JSON.stringify(result)) <= MAX_SHAPE_BYTES ? result : '<shape:truncated>'
}
