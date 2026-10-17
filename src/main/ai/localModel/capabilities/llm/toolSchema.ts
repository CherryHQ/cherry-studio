import { isEqual } from 'es-toolkit'
import type { GbnfJsonSchema } from 'node-llama-cpp'

type Schema = Record<string, unknown>

const IMMUTABLE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])
const GRAMMAR_FORMATS = new Set(['date-time', 'time', 'date'])
const ANY_VALUE: Schema = {
  oneOf: [
    { type: ['string', 'number', 'boolean', 'null'] },
    { type: 'object', additionalProperties: true },
    { type: 'array' }
  ]
}
const NULL_VALUE: Schema = { type: 'null' }

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

  const union = schema.anyOf ?? schema.oneOf
  if (Array.isArray(union)) return { ...base, oneOf: union.map((option) => convert(option, defs)) }

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
    case 'string':
    case 'boolean':
    case 'number':
      return typeof value === type
    case 'integer':
      return Number.isInteger(value)
    case 'array':
      return Array.isArray(value) && value.every((item, index) => matches(itemSchema(schema, index), item, defs))
    case 'object': {
      if (!isRecord(value)) return false
      const properties = isRecord(schema.properties) ? schema.properties : undefined
      const required = requiredKeys(schema)
      if ([...required].some((key) => !Object.hasOwn(value, key))) return false
      const additional = schema.additionalProperties ?? !properties
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
  return [...allOf, ...(typeof $ref === 'string' ? [{ $ref }] : [])]
    .filter(isRecord)
    .map((part) => expand(part, defs, seen))
    .reduce(mergeObjectSchemas, rest)
}

/** The schema with its reference chain followed and `allOf` merged; `allOf` goes first since it may sit beside a `$ref`. */
function expand(schema: Schema, defs: Schema, seen = new Set<Schema>()): Schema {
  return mergeAllOf(Array.isArray(schema.allOf) ? schema : resolveRef(schema, defs), defs, seen)
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
  const part: Schema = { ...source, allOf: undefined }
  return {
    ...target,
    ...part,
    properties: { ...(target.properties as Schema), ...(part.properties as Schema) },
    required: [...((target.required as string[]) ?? []), ...((part.required as string[]) ?? [])]
  }
}

function pick(schema: Schema, keys: string[]): Schema {
  return Object.fromEntries(keys.filter((key) => schema[key] !== undefined).map((key) => [key, schema[key]]))
}

function isRecord(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
