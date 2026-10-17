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

/**
 * Rewrites a tool's JSON Schema into the subset node-llama-cpp compiles into a grammar. Shapes it
 * does not recognize (`anyOf`, `allOf`, untyped schemas, `object` inside a type list) compile to
 * `null` and force the model to pass null; they become their equivalent here, or "any value".
 */
export function toGbnfJsonSchema(schema: unknown): GbnfJsonSchema {
  return convert(schema) as GbnfJsonSchema
}

function convert(input: unknown): Schema {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return ANY_VALUE
  const schema = input as Schema
  const base: Schema = typeof schema.description === 'string' ? { description: schema.description } : {}
  const defs = schema.$defs ?? schema.definitions
  if (isRecord(defs)) base.$defs = Object.fromEntries(Object.entries(defs).map(([key, def]) => [key, convert(def)]))

  if (typeof schema.$ref === 'string') return { ...base, $ref: schema.$ref.replace('#/definitions/', '#/$defs/') }
  if ('const' in schema) return { ...base, const: schema.const }
  if (Array.isArray(schema.enum)) return { ...base, enum: schema.enum }

  const union = schema.anyOf ?? schema.oneOf
  if (Array.isArray(union)) return { ...base, oneOf: union.map(convert) }
  if (Array.isArray(schema.allOf)) {
    const { allOf, ...rest } = schema
    return convert((allOf as unknown[]).filter(isRecord).reduce(mergeObjectSchemas, rest))
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? inferType(schema)]
  if (types.length !== 1) {
    if (types.every((type) => IMMUTABLE_TYPES.has(type))) return { ...base, type: types }
    return { ...base, oneOf: types.map((type) => convert({ ...schema, type })) }
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
      const additional = schema.additionalProperties
      return {
        ...base,
        type,
        ...pick(schema, ['minProperties', 'maxProperties']),
        ...(properties && {
          properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, convert(value)]))
        }),
        ...(properties &&
          Array.isArray(schema.required) && { required: schema.required.filter((key) => key in properties) }),
        // JSON Schema allows extra keys by default; the grammar only does when told to.
        additionalProperties: isRecord(additional) ? convert(additional) : (additional ?? !properties)
      }
    }
    case 'array':
      return {
        ...base,
        type,
        ...pick(schema, ['minItems', 'maxItems']),
        ...('items' in schema && { items: convert(schema.items) }),
        ...(Array.isArray(schema.prefixItems) && { prefixItems: schema.prefixItems.map(convert) })
      }
    default:
      return IMMUTABLE_TYPES.has(type) ? { ...base, type } : { ...base, ...ANY_VALUE }
  }
}

function inferType(schema: Schema): string | undefined {
  if (isRecord(schema.properties)) return 'object'
  if ('items' in schema) return 'array'
  return undefined
}

function mergeObjectSchemas(target: Schema, source: Schema): Schema {
  return {
    ...target,
    ...source,
    properties: { ...(target.properties as Schema), ...(source.properties as Schema) },
    required: [...((target.required as string[]) ?? []), ...((source.required as string[]) ?? [])]
  }
}

function pick(schema: Schema, keys: string[]): Schema {
  return Object.fromEntries(keys.filter((key) => schema[key] !== undefined).map((key) => [key, schema[key]]))
}

function isRecord(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
