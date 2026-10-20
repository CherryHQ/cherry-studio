import { isEqual, omit } from 'es-toolkit'
import type { GbnfJsonSchema } from 'node-llama-cpp'

type Schema = Record<string, unknown>

const IMMUTABLE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])
// The formats the grammar enforces, with the patterns node-llama-cpp validates them by.
const GRAMMAR_FORMATS = new Map([
  ['date', /^\d{4}-(0[1-9]|1[012])-(0[1-9]|[12]\d|3[01])$/],
  ['time', /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{3})?(Z|[+-]([01][0-9]|2[0-3])?:[0-5][0-9])$/],
  [
    'date-time',
    /^\d{4}-(0[1-9]|1[012])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{3})?(Z|[+-]([01][0-9]|2[0-3])?:[0-5][0-9])$/
  ]
])
const ANY_VALUE: Schema = {
  oneOf: [
    { type: ['string', 'number', 'boolean', 'null'] },
    { type: 'object', additionalProperties: true },
    { type: 'array' }
  ]
}
const NULL_VALUE: Schema = { type: 'null' }
// Keywords that annotate a schema instead of constraining its value.
const ANNOTATION_KEYS = ['description', '$defs', 'definitions']

/**
 * Rewrites a tool's JSON Schema into the subset node-llama-cpp compiles into a grammar. Shapes it
 * does not recognize (`anyOf`, `allOf`, untyped schemas, `object` inside a type list) compile to
 * `null` and force the model to pass null; they become their equivalent here, or "any value".
 *
 * The grammar requires every declared property, so an optional one also accepts `null`, which
 * {@link toToolArguments} removes again before the tool sees the call.
 */
export function toGbnfJsonSchema(schema: unknown): GbnfJsonSchema {
  return convert(schema, {}) as GbnfJsonSchema
}

/** The arguments a tool receives: generated params without the nulls standing in for omitted optional ones. */
export function toToolArguments(schema: unknown, params: unknown): unknown {
  return stripUnsetOptionals(schema, params, {})
}

function convert(input: unknown, outerDefs: Schema): Schema {
  if (!isRecord(input)) return ANY_VALUE
  const schema = input
  const defs = withLocalDefs(schema, outerDefs)
  const base: Schema = typeof schema.description === 'string' ? { description: schema.description } : {}
  const localDefs = schema.$defs ?? schema.definitions
  if (isRecord(localDefs)) {
    base.$defs = Object.fromEntries(Object.entries(localDefs).map(([key, def]) => [key, convert(def, defs)]))
  }

  if (Array.isArray(schema.allOf)) return convert(mergeAllOf(schema, defs), defs)
  if (typeof schema.$ref === 'string') return { ...base, $ref: schema.$ref.replace('#/definitions/', '#/$defs/') }
  if ('const' in schema) return { ...base, const: schema.const }
  if (Array.isArray(schema.enum)) return { ...base, enum: schema.enum }

  if (Array.isArray(schema.anyOf ?? schema.oneOf)) {
    const distributed = distributeUnion(schema, defs)
    const options = (distributed.anyOf ?? distributed.oneOf) as unknown[]
    return { ...base, oneOf: options.map((option) => convert(option, defs)) }
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? inferType(schema)]
  if (types.length !== 1) {
    if (types.every((type) => IMMUTABLE_TYPES.has(type))) return { ...base, type: types }
    return { ...base, oneOf: types.map((type) => convert({ ...schema, type }, defs)) }
  }
  const [type] = types
  switch (type) {
    case 'string':
      return {
        ...base,
        type,
        ...pick(schema, ['minLength', 'maxLength']),
        ...(GRAMMAR_FORMATS.has(schema.format as string) && { format: schema.format })
      }
    case 'object': {
      const properties = isRecord(schema.properties) ? schema.properties : undefined
      const required = requiredKeys(schema)
      const additional = schema.additionalProperties
      return {
        ...base,
        type,
        ...pick(schema, ['minProperties', 'maxProperties']),
        ...(properties && {
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, value]) => {
              const converted = convert(value, defs)
              return [key, required.has(key) || acceptsNull(value, defs) ? converted : nullable(converted)]
            })
          )
        }),
        ...(properties && required.size > 0 && { required: [...required].filter((key) => key in properties) }),
        // JSON Schema allows extra keys by default; the grammar only does when told to.
        additionalProperties: isRecord(additional) ? convert(additional, defs) : (additional ?? !properties)
      }
    }
    case 'array':
      return {
        ...base,
        type,
        ...pick(schema, ['minItems', 'maxItems']),
        ...('items' in schema && { items: convert(schema.items, defs) }),
        ...(Array.isArray(schema.prefixItems) && {
          prefixItems: schema.prefixItems.map((item) => convert(item, defs))
        })
      }
    default:
      return IMMUTABLE_TYPES.has(type) ? { ...base, type } : { ...base, ...ANY_VALUE }
  }
}

function stripUnsetOptionals(input: unknown, value: unknown, outerDefs: Schema): unknown {
  if (!isRecord(input)) return value
  const defs = withLocalDefs(input, outerDefs)
  const schema = branchFor(expand(input, defs), value, defs)
  if (Array.isArray(value)) {
    return value.map((item, index) => stripUnsetOptionals(itemSchema(schema, index), item, defs))
  }
  if (!isRecord(value)) return value
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = requiredKeys(schema)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => {
        const declared = Object.hasOwn(properties, key)
        return !(item === null && declared && !required.has(key) && !acceptsNull(properties[key], defs))
      })
      .map(([key, item]) => {
        const declared = Object.hasOwn(properties, key)
        return [key, stripUnsetOptionals(declared ? properties[key] : schema.additionalProperties, item, defs)]
      })
  )
}

/** The union branch the grammar generated `value` from, so only that branch decides what a null means. */
function branchFor(schema: Schema, value: unknown, defs: Schema, seen = new Set<Schema>()): Schema {
  const union = schema.anyOf ?? schema.oneOf
  if (!Array.isArray(union) || seen.has(schema)) return schema
  seen.add(schema)
  const branch = union
    .filter(isRecord)
    .map((option) => expand(option, defs))
    .find((option) => matches(option, value, defs))
  return branch ? branchFor(branch, value, defs, seen) : schema
}

function acceptsNull(schema: unknown, defs: Schema): boolean {
  return matches(schema, null, defs)
}

/** Whether the grammar built from `input` can produce `value`, with optional properties set to null. */
function matches(input: unknown, value: unknown, defs: Schema, seen = new Set<Schema>()): boolean {
  if (!isRecord(input)) return true
  if (seen.has(input)) return false
  seen.add(input)
  const schema = expand(input, defs)
  if (typeof schema.$ref === 'string') return false
  if ('const' in schema) return isEqual(schema.const, value)
  if (Array.isArray(schema.enum)) return schema.enum.some((option) => isEqual(option, value))
  const union = schema.anyOf ?? schema.oneOf
  if (Array.isArray(union)) return union.some((option) => matches(option, value, defs, seen))
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? inferType(schema)]
  return types.some((type) => matchesType(schema, type, value, defs))
}

function matchesType(schema: Schema, type: unknown, value: unknown, defs: Schema): boolean {
  switch (type) {
    case 'null':
      return value === null
    case 'string': {
      const pattern = GRAMMAR_FORMATS.get(schema.format as string)
      return (
        typeof value === 'string' &&
        withinBounds(value.length, schema.minLength, schema.maxLength) &&
        (!pattern || pattern.test(value))
      )
    }
    case 'boolean':
    case 'number':
      return typeof value === type
    case 'integer':
      return Number.isInteger(value)
    case 'array': {
      if (!Array.isArray(value)) return false
      const tupleLength = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0
      return (
        withinBounds(value.length, schema.minItems, schema.maxItems, tupleLength) &&
        value.every((item, index) => matches(itemSchema(schema, index), item, defs))
      )
    }
    case 'object': {
      if (!isRecord(value)) return false
      const properties = isRecord(schema.properties) ? schema.properties : undefined
      const required = requiredKeys(schema)
      // The grammar requires every declared property, the optional ones as null.
      if (Object.keys(properties ?? {}).some((key) => !Object.hasOwn(value, key))) return false
      const additional = schema.additionalProperties ?? !properties
      const declared = Object.keys(properties ?? {}).length
      const size = Object.keys(value).length
      if (additional !== false && !withinBounds(size, schema.minProperties, schema.maxProperties, declared))
        return false
      return Object.entries(value).every(([key, item]) => {
        if (!properties || !Object.hasOwn(properties, key))
          return additional !== false && matches(additional, item, defs)
        return (item === null && !required.has(key)) || matches(properties[key], item, defs)
      })
    }
    default:
      // An unknown or missing type becomes "any value".
      return true
  }
}

/** A length or count check the way node-llama-cpp's validator does it: `floor` raises the minimum, and the maximum never drops below it. */
function withinBounds(count: number, min: unknown, max: unknown, floor = 0): boolean {
  const lower = Math.max(typeof min === 'number' ? min : 0, floor)
  return count >= lower && (typeof max !== 'number' || count <= Math.max(max, lower))
}

function itemSchema(schema: Schema, index: number): unknown {
  return Array.isArray(schema.prefixItems) && index < schema.prefixItems.length
    ? schema.prefixItems[index]
    : schema.items
}

/** One object schema from `allOf`, with each part's reference chain resolved first so its fields survive. */
function mergeAllOf(schema: Schema, defs: Schema, seen = new Set<Schema>()): Schema {
  if (!Array.isArray(schema.allOf) || seen.has(schema)) return schema
  seen.add(schema)
  // A `$ref` beside `allOf` is one more part of the intersection.
  const { allOf, $ref, ...rest } = schema
  const merged = [...allOf, ...(typeof $ref === 'string' ? [{ $ref }] : [])]
    .filter(isRecord)
    .map((part) => expand(part, defs, seen))
    .reduce((target, part) => intersect(target, part, defs, seen), omit(rest, ANNOTATION_KEYS))
  return { ...merged, ...pick(rest, ANNOTATION_KEYS) }
}

/** Both schemas at once; a union on either side keeps each of its alternatives combined with the other side. */
function intersect(target: Schema, source: Schema, defs: Schema, seen: Set<Schema>): Schema {
  if (isUnion(target)) {
    return { oneOf: alternatives(target, defs, seen).map((option) => intersect(option, source, defs, seen)) }
  }
  if (isUnion(source)) {
    return { oneOf: alternatives(source, defs, seen).map((option) => intersect(target, option, defs, seen)) }
  }
  return mergeObjectSchemas(target, source)
}

/** The schema with its reference chain followed and `allOf` merged; `allOf` goes first since it may sit beside a `$ref`. */
function expand(schema: Schema, defs: Schema, seen = new Set<Schema>()): Schema {
  return distributeUnion(mergeAllOf(Array.isArray(schema.allOf) ? schema : resolveRef(schema, defs), defs, seen), defs)
}

/** Keywords beside `anyOf`/`oneOf` constrain every alternative, so each alternative takes them in. */
function distributeUnion(schema: Schema, defs: Schema): Schema {
  if (!isUnion(schema) || Object.keys(omit(schema, ['anyOf', 'oneOf', ...ANNOTATION_KEYS])).length === 0) return schema
  return { ...pick(schema, ANNOTATION_KEYS), oneOf: alternatives(schema, defs) }
}

/** The alternatives of a union, each expanded and carrying the keywords beside the union. */
function alternatives(schema: Schema, defs: Schema, seen?: Set<Schema>): Schema[] {
  const shared = omit(schema, ['anyOf', 'oneOf', ...ANNOTATION_KEYS])
  return ((schema.anyOf ?? schema.oneOf) as unknown[])
    .filter(isRecord)
    .map((option) => mergeObjectSchemas(shared, expand(option, defs, seen)))
}

function isUnion(schema: Schema): boolean {
  return Array.isArray(schema.anyOf ?? schema.oneOf)
}

function resolveRef(schema: Schema, defs: Schema): Schema {
  const seen = new Set<Schema>()
  let current = schema
  while (typeof current.$ref === 'string' && !Array.isArray(current.allOf) && !seen.has(current)) {
    seen.add(current)
    const target = defs[current.$ref.replace(/^#\/(\$defs|definitions)\//, '')]
    if (!isRecord(target)) break
    current = target
  }
  return current
}

function withLocalDefs(schema: Schema, outerDefs: Schema): Schema {
  const localDefs = schema.$defs ?? schema.definitions
  return isRecord(localDefs) ? { ...outerDefs, ...localDefs } : outerDefs
}

function requiredKeys(schema: Schema): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === 'string') : [])
}

function nullable(schema: Schema): Schema {
  const { description, ...rest } = schema
  return { ...(description !== undefined && { description }), oneOf: [rest, NULL_VALUE] }
}

function inferType(schema: Schema): string | undefined {
  if (isRecord(schema.properties)) return 'object'
  if ('items' in schema) return 'array'
  return undefined
}

function mergeObjectSchemas(target: Schema, source: Schema): Schema {
  // A part whose allOf could not be expanded (a cycle) must not reintroduce allOf into the result.
  const part = omit(source, ['allOf'])
  const hasProperties = isRecord(target.properties) || isRecord(part.properties)
  const hasRequired = Array.isArray(target.required) || Array.isArray(part.required)
  const properties: Schema = { ...(target.properties as Schema) }
  for (const [key, value] of Object.entries((part.properties as Schema) ?? {})) {
    // Both parts constrain this property, so its value must meet both.
    properties[key] = Object.hasOwn(properties, key) ? { allOf: [properties[key], value] } : value
  }
  // Both parts constrain the array items, so each item must meet both.
  const bothHaveItems = isRecord(target.items) && isRecord(part.items)
  const targetPrefix = Array.isArray(target.prefixItems) ? target.prefixItems : []
  const sourcePrefix = Array.isArray(part.prefixItems) ? part.prefixItems : []
  const prefixItems = Array.from({ length: Math.max(targetPrefix.length, sourcePrefix.length) }, (_, index) => {
    const left = itemSchema(target, index)
    const right = itemSchema(part, index)
    return isRecord(left) && isRecord(right) ? { allOf: [left, right] } : (right ?? left)
  })
  return {
    ...target,
    ...part,
    ...(bothHaveItems && { items: { allOf: [target.items, part.items] } }),
    ...(prefixItems.length > 0 && { prefixItems }),
    ...(hasProperties && { properties }),
    ...(hasRequired && {
      required: [...((target.required as string[]) ?? []), ...((part.required as string[]) ?? [])]
    })
  }
}

function pick(schema: Schema, keys: string[]): Schema {
  return Object.fromEntries(keys.filter((key) => schema[key] !== undefined).map((key) => [key, schema[key]]))
}

function isRecord(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
