/**
 * Normalizes function-tool JSON Schemas into what providers actually accept.
 *
 * Every function tool loses `$schema` and the advisory keywords rejected by
 * Gemini's Schema proto (issue #10052).
 *
 * Strict tools additionally lose validation keywords outside the sampling
 * grammar subset accepted by Anthropic and OpenAI (issue #18037).
 *
 * Non-object, untyped, `$ref`, and combinator root schemas are normalized to an
 * explicit `type: 'object'` schema with a `properties` map (issue #21957,
 * #25073), preserving `$defs`/`definitions` and `additionalProperties` semantics.
 *
 * Native Gemini replaces non-string `enum`/`const` with their bare type and
 * expands type arrays because its Schema proto requires concrete types.
 * Incompatible enums keep type-compatible choices, split by primitive type,
 * or carry their allowed values in the description when no enum can be sent.
 * Any `enum`/`const` the Google adapter would still reject moves to the description.
 *
 * Native Gemini drops tools with untyped array items: no safe type can be inferred.
 * It drops `propertyNames` / `additionalProperties`, absent from its proto (#20939).
 *
 * Chat completions normalizes incompatible enums and drops `propertyNames` for
 * recognizable Gemini raw model identities; opaque upstream aliases stay unrecognized.
 *
 * Model recognition is a heuristic, not proof of endpoint schema support.
 * Removal intentionally relaxes key constraints instead of converting them losslessly.
 *
 * Responses, Ollama, Anthropic Messages and undefined endpoint scopes receive
 * no new treatment from the chat-completions pass.
 *
 * Responses (including Azure OpenAI) gets `strict: false` when `strict` is absent,
 * preventing its default strict mode from making optional fields required.
 *
 * Other endpoints never receive a `strict` key they didn't ask for.
 *
 * Supplied validators, including MCP's compiled validator, keep the original schema.
 * Caller-owned gateway tools remain the caller's validation responsibility.
 */

import type { JSONSchema7, JSONSchema7Definition, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { normalizeRootObjectSchema } from '@main/ai/utils/toolSchema'
import { ENDPOINT_TYPE, isUniqueModelId } from '@shared/data/types/model'
import { isGeminiModel } from '@shared/utils/model'

import type { RequestFeature } from '../feature'
import type { RequestScope } from '../scope'

const logger = loggerService.withContext('toolSchemaCompatibility')

/** Rejected by Gemini, unenforced everywhere else. */
const ALWAYS_UNSUPPORTED = ['$schema', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'uniqueItems']

/** Gemini's function-declaration Schema has no field for these (issue #20939). */
const GEMINI_UNSUPPORTED = new Set(['propertyNames', 'additionalProperties'])

/** Gemini-backed chat relays may reject record key constraints. */
const CHAT_GEMINI_UNSUPPORTED = new Set(['propertyNames'])

/** Outside the strict-mode subset (`format`, `enum`, `const` stay). */
const STRICT_UNSUPPORTED = new Set([
  ...ALWAYS_UNSUPPORTED,
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'default'
])

/** Keys whose value is a map of schemas — recurse into the values, never filter the keys. */
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'])
/** Keys whose value is an array of schemas. */
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
/** Keys whose value is a schema (`items` may also be an array of schemas in draft-07). */
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

/**
 * Recurses only through schema-bearing keys, applying `mapNode` to every
 * schema node bottom-up — so a *property named* `minimum` survives while the
 * `minimum` **keyword** is only ever seen as a plain value. Returns the same
 * reference when nothing changed.
 */
function mapSchemas(schema: JSONSchema7Definition, mapNode: (node: JSONSchema7) => JSONSchema7): JSONSchema7Definition {
  if (typeof schema !== 'object' || schema === null) return schema

  const result: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(schema)) {
    let next = value
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null) {
      next = mapSchemaMap(value as Record<string, JSONSchema7Definition>, mapNode)
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      next = mapSchemaList(value, mapNode)
    } else if (SCHEMA_VALUES.has(key)) {
      next = Array.isArray(value) ? mapSchemaList(value, mapNode) : mapSchemas(value, mapNode)
    }
    if (next !== value) changed = true
    result[key] = next
  }
  const mapped = mapNode(result)
  if (mapped !== (result as JSONSchema7)) changed = true
  return changed ? mapped : schema
}

function mapSchemaList(list: unknown[], mapNode: (node: JSONSchema7) => JSONSchema7): unknown[] {
  let changed = false
  const next = list.map((item) => {
    const mapped = mapSchemas(item as JSONSchema7Definition, mapNode)
    if (mapped !== item) changed = true
    return mapped
  })
  return changed ? next : list
}

function mapSchemaMap(
  map: Record<string, JSONSchema7Definition>,
  mapNode: (node: JSONSchema7) => JSONSchema7
): Record<string, JSONSchema7Definition> {
  let changed = false
  const next: Record<string, JSONSchema7Definition> = {}
  for (const [key, value] of Object.entries(map)) {
    next[key] = mapSchemas(value, mapNode)
    if (next[key] !== value) changed = true
  }
  return changed ? next : map
}

function dropKeywords(node: JSONSchema7, keywords: ReadonlySet<string>): JSONSchema7 {
  let changed = false
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (keywords.has(key) || (key === 'required' && value === null)) {
      changed = true
      continue
    }
    kept[key] = value
  }
  return changed ? kept : node
}

function stripKeywords(schema: JSONSchema7Definition, keywords: ReadonlySet<string>): JSONSchema7Definition {
  return mapSchemas(schema, (node) => dropKeywords(node, keywords))
}

/** The single simple type shared by every value, if one exists. */
function uniformEnumType(values: unknown[]): 'integer' | 'number' | 'boolean' | undefined {
  if (values.length === 0) return undefined
  if (values.every((value) => typeof value === 'boolean')) return 'boolean'
  if (values.every((value) => typeof value === 'number' && Number.isInteger(value))) return 'integer'
  if (values.every((value) => typeof value === 'number')) return 'number'
  return undefined
}

/**
 * Gemini's Schema proto types `enum` as a string list — a numeric or boolean
 * `enum`/`const` 400s the whole request (`Invalid value at '…enum[0]'
 * (TYPE_STRING)`, e.g. zod `z.union([z.literal(1), z.literal(2)])`). Replaces
 * it with the bare type (nullable when an untyped enum also lists `null`);
 * the original zod schema still validates locally.
 */
function stripNonStringEnums(node: JSONSchema7): JSONSchema7 {
  const values = node.enum !== undefined ? node.enum : node.const !== undefined ? [node.const] : undefined
  if (!Array.isArray(values)) return node
  const nullable = node.type === undefined && values.includes(null)
  const kind = uniformEnumType(nullable ? values.filter((value) => value !== null) : values)
  if (kind === undefined) return node

  const replacement: JSONSchema7 = { ...node }
  delete replacement.enum
  delete replacement.const
  if (replacement.type === undefined) replacement.type = nullable ? [kind, 'null'] : kind
  return replacement
}

function normalizeGeminiEnum(node: JSONSchema7): JSONSchema7 {
  const { enum: values, type, ...rest } = node
  if (!Array.isArray(values)) return node

  const declared = typeof type === 'string' ? [type] : type
  const groups = new Map<Extract<JSONSchema7['type'], string>, NonNullable<JSONSchema7['enum']>>()
  let compatibleValues = 0
  let hasComplexValues = false
  for (const value of values) {
    if (typeof value === 'object' && value !== null) {
      const kind = Array.isArray(value) ? 'array' : 'object'
      if (!declared || declared.includes(kind)) hasComplexValues = true
      continue
    }
    let kind: Extract<JSONSchema7['type'], string>
    if (value === null) kind = 'null'
    else if (typeof value === 'number') {
      kind =
        Number.isInteger(value) && declared?.includes('integer') && !declared.includes('number') ? 'integer' : 'number'
    } else {
      kind = typeof value === 'boolean' ? 'boolean' : 'string'
    }
    if (declared && !declared.includes(kind)) continue
    compatibleValues++
    const group = groups.get(kind)
    if (group) group.push(value)
    else groups.set(kind, [value])
  }

  if (!hasComplexValues && groups.size > 0) {
    // The SDK already handles one primitive type and an optional null in untyped enums.
    const sdkAccepts = groups.size === 1 || (type === undefined && groups.size === 2 && groups.has('null'))
    if (sdkAccepts && !Array.isArray(type) && compatibleValues === values.length) return node

    const branches = [...groups].map(([kind, members]): JSONSchema7 => {
      if (kind === 'string' || kind === 'null') return { type: kind, enum: members }
      // Gemini's function declaration only guarantees string enums.
      return { type: kind, description: `Allowed values (JSON): ${JSON.stringify(members)}.` }
    })
    if (branches.length === 1 && (type !== undefined || node.$ref === undefined)) {
      const [branch] = branches
      const description = [node.description, branch.description].filter(Boolean).join(' ')
      return { ...rest, ...branch, ...(description && { description }) }
    }
    if (
      node.$ref === undefined &&
      node.const === undefined &&
      node.anyOf === undefined &&
      node.allOf === undefined &&
      node.oneOf === undefined &&
      node.format === undefined &&
      node.minLength === undefined
    ) {
      return { ...rest, anyOf: branches }
    }
  }

  return describeEnum(node)
}

/** Drops `enum`/`const`, keeping their values in the description. */
function describeEnum(node: JSONSchema7): JSONSchema7 {
  const { enum: values, const: constant, type, ...rest } = node
  const descriptions = [node.description]
  if (values !== undefined) descriptions.push(`Original enum values (JSON): ${JSON.stringify(values)}.`)
  if (constant !== undefined) descriptions.push(`Required value (JSON): ${JSON.stringify(constant)}.`)
  // Arrays stay `string`: Gemini requires typed `items`, which a bare value cannot supply.
  const members = values ?? [constant]
  const objects =
    members.length > 0 && members.every((value) => typeof value === 'object' && value !== null && !Array.isArray(value))
  return {
    ...rest,
    type: type ?? (node.$ref || node.anyOf || node.allOf || node.oneOf ? undefined : objects ? 'object' : 'string'),
    description: descriptions.filter(Boolean).join(' ')
  }
}

/**
 * Mirrors `@ai-sdk/google`'s `addEnumToSchema`, which throws for the whole
 * request, narrowed to the string and null enums Gemini's proto accepts.
 */
function isGeminiCompatibleEnum(node: JSONSchema7): boolean {
  const values = node.enum ?? (node.const !== undefined ? [node.const] : undefined)
  if (values === undefined) return true

  const { type } = node
  const allows = (kind: Extract<JSONSchema7['type'], string>) =>
    type === undefined || type === kind || (Array.isArray(type) && type.includes(kind))
  if (values.length > 0 && values.every((value) => value === null)) return allows('null')
  const nullable = (Array.isArray(type) && type.includes('null')) || (type === undefined && values.includes(null))
  const members = nullable ? values.filter((value) => value !== null) : values
  return members.length > 0 && allows('string') && members.every((value) => typeof value === 'string')
}

/**
 * Gemini's Schema proto requires a concrete `type` — a draft-07 type array
 * (third-party MCP servers advertise nullable scalars as
 * `type: ["number", "null"]`) reaches `convertJSONSchemaToOpenAPISchema`, which
 * maps the array into an `anyOf` without ever setting a top-level `type`, and
 * the request 400s with "didn't specify the schema type field" (issue #21394).
 * Rewrites the array into explicit `anyOf` branches — one per listed type,
 * each carrying the node's other keywords — which the converter already folds
 * into `nullable` + a typed schema. Nullability survives as its own branch;
 * the original zod schema still validates locally.
 */
function expandTypeArrays(node: JSONSchema7): JSONSchema7 {
  const type = node.type
  if (!Array.isArray(type) || type.length === 0 || type.some((entry) => typeof entry !== 'string')) return node
  if (node.anyOf !== undefined) return node

  const rest: JSONSchema7 = { ...node }
  delete rest.type
  if (type.length === 1) return { ...rest, type: type[0] }

  const branches = type.map((entry) => (entry === 'null' ? { type: entry } : { ...rest, type: entry }))
  return { ...rest, anyOf: branches }
}

function isGeminiArraySchema(schema: JSONSchema7): boolean {
  return schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))
}

function hasGeminiArrayItems(items: JSONSchema7['items']): boolean {
  // @ai-sdk/google serializes the `true` schema as a typed boolean schema.
  if (items === true) return true
  if (typeof items !== 'object' || items === null || Array.isArray(items)) return false
  return typeof items.type === 'string' || (Array.isArray(items.type) && items.type.length > 0)
}

/** Gemini's Schema requires every array declaration to carry a typed items schema. */
function hasIncompatibleGeminiArray(schema: JSONSchema7Definition): boolean {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return false

  const objectSchema = schema
  if (isGeminiArraySchema(objectSchema) && !hasGeminiArrayItems(objectSchema.items)) return true

  return Object.entries(objectSchema).some(([key, value]) => {
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.values(value).some((entry) => hasIncompatibleGeminiArray(entry as JSONSchema7Definition))
    }
    if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      return value.some((entry) => hasIncompatibleGeminiArray(entry as JSONSchema7Definition))
    }
    if (SCHEMA_VALUES.has(key)) {
      return Array.isArray(value)
        ? value.some((entry) => hasIncompatibleGeminiArray(entry as JSONSchema7Definition))
        : hasIncompatibleGeminiArray(value as JSONSchema7Definition)
    }
    return false
  })
}

function normalizeToolSchemas(params: LanguageModelV3CallOptions, scope: RequestScope): LanguageModelV3CallOptions {
  const tools = params.tools
  if (!tools) return params

  const isGeminiEndpoint =
    scope.endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT && scope.sdkConfig.providerId !== 'google-vertex-maas'
  // Partial scopes exist at runtime and may lack a resolvable model identity.
  const isChatGeminiModel =
    scope.endpointType === ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS &&
    scope.model &&
    (scope.model.apiModelId || isUniqueModelId(scope.model.id)) &&
    isGeminiModel(scope.model)
  const isResponsesEndpoint = scope.endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES

  let changed = false
  const droppedTools: string[] = []
  const describedTools: string[] = []
  const transformedTools: NonNullable<LanguageModelV3CallOptions['tools']> = []
  for (const tool of tools) {
    if (tool.type !== 'function') {
      transformedTools.push(tool)
      continue
    }
    let inputSchema: JSONSchema7Definition = normalizeRootObjectSchema(tool.inputSchema)
    if (isGeminiEndpoint && hasIncompatibleGeminiArray(inputSchema)) {
      changed = true
      droppedTools.push(tool.name)
      continue
    }
    const keywords = tool.strict === true ? STRICT_UNSUPPORTED : new Set(ALWAYS_UNSUPPORTED)
    inputSchema = stripKeywords(inputSchema, keywords)
    if (isGeminiEndpoint) inputSchema = stripKeywords(inputSchema, GEMINI_UNSUPPORTED)
    if (isGeminiEndpoint || isChatGeminiModel) {
      inputSchema = mapSchemas(inputSchema, (node) => {
        const normalized = normalizeGeminiEnum(node)
        return isGeminiEndpoint ? expandTypeArrays(normalized) : normalized
      })
    }
    if (isGeminiEndpoint) {
      let described = false
      inputSchema = mapSchemas(inputSchema, (node) => {
        const stripped = stripNonStringEnums(node)
        if (isGeminiCompatibleEnum(stripped)) return stripped
        described = true
        return describeEnum(stripped)
      })
      if (described) describedTools.push(tool.name)
    }
    if (isChatGeminiModel) inputSchema = stripKeywords(inputSchema, CHAT_GEMINI_UNSUPPORTED)
    const optOutOfStrict = isResponsesEndpoint && tool.strict === undefined
    if (inputSchema === tool.inputSchema && !optOutOfStrict) transformedTools.push(tool)
    else {
      changed = true
      transformedTools.push({
        ...tool,
        inputSchema: inputSchema as JSONSchema7,
        ...(optOutOfStrict ? { strict: false } : {})
      })
    }
  }

  if (droppedTools.length > 0) {
    logger.warn('Dropped tools with Gemini-incompatible array schemas', {
      providerId: scope.sdkConfig.providerId,
      toolNames: droppedTools
    })
  }
  if (describedTools.length > 0) {
    logger.warn('Moved Gemini-incompatible enum values into tool descriptions', {
      providerId: scope.sdkConfig.providerId,
      toolNames: describedTools
    })
  }

  return changed ? { ...params, tools: transformedTools } : params
}

function createToolSchemaCompatibilityMiddleware(scope: RequestScope): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => normalizeToolSchemas(params, scope)
  }
}

const createToolSchemaCompatibilityPlugin = (scope: RequestScope) =>
  definePlugin({
    name: 'tool-schema-compatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createToolSchemaCompatibilityMiddleware(scope))
    }
  })

/** Drop provider-rejected JSON Schema keywords and unsafe Gemini array tools; opt Responses tools out of default strict mode. */
export const toolSchemaCompatibilityFeature: RequestFeature = {
  name: 'tool-schema-compatibility',
  contributeModelAdapters: (scope) => [createToolSchemaCompatibilityPlugin(scope)]
}
