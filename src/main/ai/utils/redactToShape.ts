import { isSensitiveKey, REDACTED, redactSecretText } from '@shared/utils/redaction'

const MAX_DEPTH = 5
const MAX_ARRAY_ITEMS = 8
const MAX_OBJECT_KEYS = 32
const MAX_NODES = 128
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
const RATE_LIMIT_HEADER = /^(retry-after|x-ratelimit-(limit|remaining|reset)-(requests|tokens))$/
const REQUEST_FIELDS = new Set([
  'stream',
  'thinking',
  'messages',
  'contents',
  'tools',
  'messages[].content',
  'messages[].content[].text',
  'messages[].content[].image_url',
  'messages[].content[].input',
  'contents[].parts',
  'contents[].parts[].text',
  'tools[].function',
  'tools[].description',
  'tools[].parameters',
  'tools[].input_schema',
  'tools[].function.description',
  'tools[].function.parameters'
])
const RESPONSE_FIELDS = new Set([
  'error',
  'error.message',
  'detail',
  'detail.message',
  'detail.error',
  'detail.error.message',
  'message',
  'choices',
  'choices[].message',
  'choices[].message.role',
  'choices[].message.content'
])

function keepKey(path: string, kind: PayloadKind): boolean {
  if (kind === 'request')
    return (
      REQUEST_FIELDS.has(path) ||
      REQUEST_NUMBERS.has(path) ||
      REQUEST_LABELS.has(path) ||
      ROLE_PATH.test(path) ||
      TYPE_PATH.test(path)
    )
  if (kind === 'response') return RESPONSE_FIELDS.has(path) || RESPONSE_CODE_PATH.test(path)
  return kind === 'headers' && (path === 'content-type' || RATE_LIMIT_HEADER.test(path))
}

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
    return RATE_LIMIT_HEADER.test(path) && /^[\d.smhd-]{1,40}$/.test(value)
  }
  return false
}

/** Payload keys and values are private by default; only protocol fields at known paths survive. */
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
      const entry = (val as Record<string, unknown>)[key]
      const candidatePath = path ? `${path}.${key}` : key
      const knownKey = !/[.[\]]/.test(key) && keepKey(candidatePath, kind)
      const label = knownKey ? key : `<key:${keys}:${key.length}>`
      const entryPath = knownKey ? candidatePath : '<private>'
      // Only allowlisted protocol fields bypass the sensitive-key match, including token limits.
      out[label] =
        isSensitiveKey(key) && !keepScalar(entry, entryPath, kind) ? REDACTED : shape(entry, depth + 1, entryPath)
    }
    return out
  }
  const result = shape(value, 0, '')
  return Buffer.byteLength(JSON.stringify(result)) <= MAX_SHAPE_BYTES ? result : '<shape:truncated>'
}
