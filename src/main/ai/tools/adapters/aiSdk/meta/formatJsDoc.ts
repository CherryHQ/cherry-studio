// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Foreign schema keywords stay opaque until their individual fields are checked below.
type PropertySchema = Record<string, unknown>

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This container check does not establish a schema dialect or validate child values.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- External JSON Schema type fields can be unions or malformed values; only recognized scalar names produce a concrete JSDoc type.
function jsonSchemaTypeToJs(schemaType: unknown): string {
  if (typeof schemaType !== 'string') {
    return '*'
  }

  switch (schemaType) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'Array'
    case 'object':
      return 'Object'
    default:
      return '*'
  }
}

function schemaToParamType(prop: PropertySchema): string {
  const enumValues = prop.enum

  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return enumValues.map((v) => JSON.stringify(v)).join('|')
  }

  const typeValue = prop.type

  if (Array.isArray(typeValue)) {
    return typeValue.map((t) => jsonSchemaTypeToJs(t)).join('|')
  }

  if (typeValue === 'array') {
    // Keep it simple in JSDoc; item typing is often noisy.
    return 'Array'
  }

  return jsonSchemaTypeToJs(typeValue)
}

const MAX_NESTING_DEPTH = 5

function appendPropertyParams(
  lines: string[],
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Property entries may be boolean schemas or malformed; inspect each before emitting documentation.
  properties: Record<string, unknown>,
  required: Set<string>,
  prefix: string,
  depth: number = 0
): void {
  if (depth >= MAX_NESTING_DEPTH) return
  const propNames = Object.keys(properties).sort((a, b) => a.localeCompare(b))

  for (const propName of propNames) {
    const rawProp = properties[propName]
    const prop: PropertySchema | undefined = typeof rawProp === 'boolean' ? {} : isRecord(rawProp) ? rawProp : undefined

    if (!prop) continue
    const isReq = required.has(propName)
    const jsType = schemaToParamType(prop)

    const paramPath = isReq ? `${prefix}.${propName}` : `[${prefix}.${propName}]`

    const propDesc = typeof prop.description === 'string' ? prop.description.trim().split('\n')[0] : ''
    const suffix = isReq ? (propDesc ? `${propDesc} (required)` : '(required)') : propDesc

    if (suffix) {
      lines.push(` * @param {${jsType}} ${paramPath} - ${suffix}`)
    } else {
      lines.push(` * @param {${jsType}} ${paramPath}`)
    }

    // Recurse into nested object properties
    if (prop.type === 'object' && isRecord(prop.properties)) {
      const nestedProps = prop.properties

      const nestedRequired = new Set<string>(
        Array.isArray(prop.required) ? prop.required.filter((key): key is string => typeof key === 'string') : []
      )

      appendPropertyParams(lines, nestedProps, nestedRequired, `${prefix}.${propName}`, depth + 1)
    }

    // Recurse into array item properties
    if (prop.type === 'array' && isRecord(prop.items)) {
      const items = prop.items

      if (items.type === 'object' && isRecord(items.properties)) {
        const itemProps = items.properties

        const itemRequired = new Set<string>(
          Array.isArray(items.required) ? items.required.filter((key): key is string => typeof key === 'string') : []
        )

        appendPropertyParams(lines, itemProps, itemRequired, `${prefix}.${propName}[]`, depth + 1)
      }
    }
  }
}

/**
 * Generate a JSDoc function stub from a tool schema.
 *
 * This mirrors mcphub's `inspect` output style.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Serialized tool schemas are not deep-validated by their wrappers; verify each consumed field and keep wildcard documentation for supported boolean schemas.
export function schemaToJSDoc(toolName: string, description: string | undefined, inputSchema: unknown): string {
  const schema = isRecord(inputSchema) ? inputSchema : undefined

  const desc = (description || toolName).trim() || toolName

  const rawRequired = schema?.required

  const required = new Set<string>(
    Array.isArray(rawRequired) ? rawRequired.filter((key): key is string => typeof key === 'string') : []
  )

  const rawProperties = schema?.properties
  const properties = isRecord(rawProperties) ? rawProperties : {}

  const lines: string[] = []
  lines.push('/**')
  lines.push(` * ${desc}`)

  if (Object.keys(properties).length > 0) {
    lines.push(' *')
    lines.push(' * @param {Object} params - Parameters')
    appendPropertyParams(lines, properties, required, 'params')
  }

  lines.push(' */')
  lines.push(`function ${toolName}(params) {}`)

  return lines.join('\n')
}
