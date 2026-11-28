import type { JSONSchema7, JSONSchema7Definition } from '@ai-sdk/provider'

export interface NormalizeRootObjectSchemaOptions {
  /**
   * Keep a root `$ref` intact so local JSON Schema validators (such as MCP's
   * `CfWorkerJsonSchemaValidator`) continue validating against the original reference.
   */
  preserveRootRef?: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fallbackObjectSchema(node?: Record<string, unknown>): JSONSchema7 {
  const fallback: JSONSchema7 = { type: 'object', properties: {} }
  if (node && typeof node.description === 'string') {
    fallback.description = node.description
  }
  return fallback
}

function decodePointerSegment(segment: string): string {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    decoded = segment
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

function resolveLocalPointer(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  const segments = ref.slice(2).split('/').map(decodePointerSegment)
  let current: unknown = root
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
    } else if (isPlainObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

function hasObjectCompatibleType(type: unknown): boolean {
  if (type === undefined || type === null || type === 'object') return true
  return Array.isArray(type) && type.includes('object')
}

function resolveRefTarget(
  node: Record<string, unknown>,
  root: Record<string, unknown>,
  visited: Set<string>
): { resolved: unknown; nextVisited: Set<string> } {
  const nextVisited = new Set(visited)
  const siblingLayers: Record<string, unknown>[] = []
  let current: unknown = node

  while (isPlainObject(current) && typeof current.$ref === 'string') {
    if (nextVisited.has(current.$ref)) return { resolved: undefined, nextVisited }
    nextVisited.add(current.$ref)
    const { $ref: ref, ...siblings } = current
    siblingLayers.push(siblings)
    current = resolveLocalPointer(root, ref)
  }

  if (current === true) {
    return { resolved: Object.assign({}, ...siblingLayers.reverse()), nextVisited }
  }
  if (!isPlainObject(current)) return { resolved: undefined, nextVisited }

  return {
    resolved: Object.assign({}, current, ...siblingLayers.reverse()),
    nextVisited
  }
}

function resolveRootRef(root: Record<string, unknown>): Record<string, unknown> | undefined {
  if (typeof root.$ref !== 'string') return root

  const visited = new Set<string>()
  const siblingLayers: Record<string, unknown>[] = []
  let current: unknown = root

  while (isPlainObject(current) && typeof current.$ref === 'string') {
    if (visited.has(current.$ref)) return undefined
    visited.add(current.$ref)
    const { $ref: ref, ...siblings } = current
    siblingLayers.push(siblings)
    current = resolveLocalPointer(root, ref)
  }

  if (current === true) {
    return Object.assign({}, ...siblingLayers.reverse())
  }
  if (!isPlainObject(current) || !hasObjectCompatibleType(current.type)) return undefined

  // Merge innermost-to-outermost so root siblings override defaults while keeping `$defs`/`definitions`.
  return Object.assign({}, current, ...siblingLayers.reverse())
}

function isObjectCompatibleSchema(
  node: unknown,
  root: Record<string, unknown>,
  visited: Set<string> = new Set()
): boolean {
  if (node === true) return true
  if (!isPlainObject(node)) return false

  if (typeof node.$ref === 'string') {
    const { resolved, nextVisited } = resolveRefTarget(node, root, visited)
    if (!isPlainObject(resolved)) return false
    return isObjectCompatibleSchema(resolved, root, nextVisited)
  }

  if (!hasObjectCompatibleType(node.type)) return false
  if (Array.isArray(node.allOf)) {
    if (node.allOf.length === 0 || !node.allOf.every((branch) => isObjectCompatibleSchema(branch, root, visited))) {
      return false
    }
  }
  if (Array.isArray(node.anyOf) && !node.anyOf.some((branch) => isObjectCompatibleSchema(branch, root, visited))) {
    return false
  }
  if (Array.isArray(node.oneOf) && !node.oneOf.some((branch) => isObjectCompatibleSchema(branch, root, visited))) {
    return false
  }
  return true
}

function collectObjectProperties(
  node: Record<string, unknown>,
  root: Record<string, unknown>
): Record<string, JSONSchema7Definition> {
  const collected = new Map<string, JSONSchema7Definition[]>()

  const visit = (current: unknown, seen: Set<string>): void => {
    if (!isPlainObject(current)) return
    let target: Record<string, unknown> = current
    let nextSeen = seen
    if (typeof current.$ref === 'string') {
      const refResult = resolveRefTarget(current, root, seen)
      if (!isPlainObject(refResult.resolved)) return
      target = refResult.resolved
      nextSeen = refResult.nextVisited
    }
    if (!isObjectCompatibleSchema(target, root, nextSeen)) return

    if (isPlainObject(target.properties)) {
      for (const [key, propSchema] of Object.entries(target.properties)) {
        const list = collected.get(key)
        if (list) list.push(propSchema as JSONSchema7Definition)
        else collected.set(key, [propSchema as JSONSchema7Definition])
      }
    }

    for (const combinator of ['allOf', 'anyOf', 'oneOf'] as const) {
      const branches = target[combinator]
      if (!Array.isArray(branches)) continue
      for (const branch of branches) {
        visit(branch, nextSeen)
      }
    }
  }

  visit(node, new Set())

  const properties: Record<string, JSONSchema7Definition> = {}
  for (const [key, variants] of collected) {
    const deduped = new Map<string, JSONSchema7Definition>()
    for (const variant of variants) {
      const signature = JSON.stringify(variant)
      if (!deduped.has(signature)) deduped.set(signature, variant)
    }
    const unique = [...deduped.values()]
    properties[key] = unique.length === 1 ? unique[0] : { anyOf: unique }
  }
  return properties
}

/**
 * Normalize a tool's root JSON Schema so upstream providers always receive an
 * `object`-typed root schema with a `properties` map.
 *
 * Explicit `type: 'object'` schemas that already own `properties` (and have no
 * root `$ref`) are returned by reference without copying.
 */
export function normalizeRootObjectSchema(
  schema: unknown,
  options: NormalizeRootObjectSchemaOptions = {}
): JSONSchema7 {
  if (!isPlainObject(schema)) return fallbackObjectSchema()
  if (options.preserveRootRef && typeof schema.$ref === 'string') {
    return schema
  }

  const resolved = resolveRootRef(schema)
  if (!resolved) return fallbackObjectSchema(schema)

  const hasProperties = Object.hasOwn(resolved, 'properties')
  if (resolved.type === 'object') {
    return hasProperties ? resolved : { ...resolved, properties: {} }
  }

  if (!hasObjectCompatibleType(resolved.type) || !isObjectCompatibleSchema(resolved, resolved)) {
    return fallbackObjectSchema(resolved)
  }

  const hasCombinator = Array.isArray(resolved.anyOf) || Array.isArray(resolved.oneOf) || Array.isArray(resolved.allOf)
  const properties = hasProperties
    ? resolved.properties
    : hasCombinator
      ? collectObjectProperties(resolved, resolved)
      : {}

  return {
    ...resolved,
    type: 'object',
    properties: properties as JSONSchema7['properties']
  }
}

const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SCHEMA_VALUES = new Set([
  'items',
  'additionalItems',
  'additionalProperties',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else'
])
const HEX_DIGITS_PATTERN = /^[0-9a-fA-F]+$/

function hasUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1
        continue
      }
      return true
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

function hasNonPortableRegexEscape(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] !== '\\') continue
    const next = pattern[i + 1]
    if (next === undefined) return true
    // Rust regex / RE2 JSON Schema validators reject JS `\uXXXX` escapes and surrogate code points.
    if (next === 'u') return true
    if (next === 'x' && pattern[i + 2] === '{') {
      const end = pattern.indexOf('}', i + 3)
      if (end === -1) return true
      const hex = pattern.slice(i + 3, end)
      if (!HEX_DIGITS_PATTERN.test(hex)) return true
      const codePoint = Number.parseInt(hex, 16)
      if ((codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
        return true
      }
    }
    i += 1
  }
  return false
}

/**
 * Returns true when a JSON Schema `pattern` is syntactically valid and portable
 * across strict UTF-8 regex validators (Rust `regex` / RE2 / ECMA-262).
 */
export function isPortableSchemaPattern(pattern: unknown): boolean {
  if (typeof pattern !== 'string') return false
  if (hasUnpairedSurrogate(pattern) || hasNonPortableRegexEscape(pattern)) return false
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

function stripPatternsFromMap(map: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let changed = false
  for (const [key, entry] of Object.entries(map)) {
    const next = stripIncompatibleSchemaPatterns(entry)
    result[key] = next
    if (next !== entry) changed = true
  }
  return changed ? result : map
}

function stripPatternsFromList(list: unknown[]): unknown[] {
  let changed = false
  const result = list.map((entry) => {
    const next = stripIncompatibleSchemaPatterns(entry)
    if (next !== entry) changed = true
    return next
  })
  return changed ? result : list
}

/**
 * Recursively removes non-portable or invalid `pattern` keywords from schema-bearing
 * positions without mutating the input or stripping object properties named `pattern`.
 * Returns the original reference when nothing changes.
 */
export function stripIncompatibleSchemaPatterns<T>(schema: T): T {
  if (!isPlainObject(schema)) return schema

  const result: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'pattern' && !isPortableSchemaPattern(value)) {
      changed = true
      continue
    }
    let next = value
    if (SCHEMA_MAPS.has(key) && isPlainObject(value)) {
      next = stripPatternsFromMap(value)
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      next = stripPatternsFromList(value)
    } else if (SCHEMA_VALUES.has(key)) {
      next = Array.isArray(value) ? stripPatternsFromList(value) : stripIncompatibleSchemaPatterns(value)
    }
    result[key] = next
    if (next !== value) changed = true
  }

  return (changed ? result : schema) as T
}
