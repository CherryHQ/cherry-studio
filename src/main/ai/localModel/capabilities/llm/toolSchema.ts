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

  if (typeof schema.$ref === 'string') return { ...base, $ref: schema.$ref.replace('#/definitions/', '#/$defs/') }
  if ('const' in schema) return { ...base, const: schema.const }
  if (Array.isArray(schema.enum)) return { ...base, enum: schema.enum }

  const union = schema.anyOf ?? schema.oneOf
  if (Array.isArray(union)) return { ...base, oneOf: union.map((option) => convert(option, defs)) }
  if (Array.isArray(schema.allOf)) return convert(mergeAllOf(schema, defs), defs)

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
      const required = new Set(Array.isArray(schema.required) ? schema.required : [])
      const additional = schema.additionalProperties
      return {
        ...base,
        type,
        ...pick(schema, ['minProperties', 'maxProperties']),
        ...(properties && {
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, value]) => {
              const converted = convert(value, defs)
              return [key, required.has(key) || acceptsNull(converted) ? converted : nullable(converted)]
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
  const schema = mergeAllOf(resolveRef(input, defs), defs)
  if (Array.isArray(value)) {
    return 'items' in schema ? value.map((item) => stripUnsetOptionals(schema.items, item, defs)) : value
  }
  const properties = schema.properties
  if (!isRecord(value) || !isRecord(properties)) return value
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => {
        const unset = item === null && key in properties && !required.has(key)
        return !unset || acceptsNull(convert(properties[key], defs))
      })
      .map(([key, item]) => [key, stripUnsetOptionals(properties[key], item, defs)])
  )
}

/** One object schema from `allOf`, with each referenced part resolved first so its fields survive the merge. */
function mergeAllOf(schema: Schema, defs: Schema): Schema {
  if (!Array.isArray(schema.allOf)) return schema
  const { allOf, ...rest } = schema
  return allOf
    .filter(isRecord)
    .map((part) => mergeAllOf(resolveRef(part, defs), defs))
    .reduce(mergeObjectSchemas, rest)
}

function resolveRef(schema: Schema, defs: Schema): Schema {
  if (typeof schema.$ref !== 'string') return schema
  const target = defs[schema.$ref.replace(/^#\/(\$defs|definitions)\//, '')]
  return isRecord(target) ? target : schema
}

function withLocalDefs(schema: Schema, outerDefs: Schema): Schema {
  const localDefs = schema.$defs ?? schema.definitions
  return isRecord(localDefs) ? { ...outerDefs, ...localDefs } : outerDefs
}

function acceptsNull(schema: Schema): boolean {
  if (schema.type === 'null' || (Array.isArray(schema.type) && schema.type.includes('null'))) return true
  return Array.isArray(schema.oneOf) && schema.oneOf.some((option) => isRecord(option) && acceptsNull(option))
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
