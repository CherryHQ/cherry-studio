type PropertySchema = Record<string, unknown>

type InputSchema = {
  type?: string
  properties?: Record<string, PropertySchema>
  required?: string[]
}

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
  const enumValues = prop.enum as unknown[] | undefined
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return enumValues.map((v) => JSON.stringify(v)).join('|')
  }

  const typeValue = prop.type as unknown

  if (Array.isArray(typeValue)) {
    return typeValue.map((t) => jsonSchemaTypeToJs(t)).join('|')
  }

  if (typeValue === 'array') {
    // Keep it simple in JSDoc; item typing is often noisy.
    return 'Array'
  }

  return jsonSchemaTypeToJs(typeValue)
}

function appendPropertyParams(
  lines: string[],
  properties: Record<string, PropertySchema>,
  required: Set<string>,
  prefix: string
): void {
  const propNames = Object.keys(properties).sort((a, b) => a.localeCompare(b))

  for (const propName of propNames) {
    const prop = properties[propName]
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
    if ((prop.type as string) === 'object' && prop.properties) {
      const nestedProps = prop.properties as Record<string, PropertySchema>
      const nestedRequired = new Set<string>(
        Array.isArray(prop.required) ? (prop.required as string[]) : []
      )
      appendPropertyParams(lines, nestedProps, nestedRequired, `${prefix}.${propName}`)
    }

    // Recurse into array item properties
    if ((prop.type as string) === 'array' && prop.items) {
      const items = prop.items as PropertySchema
      if ((items.type as string) === 'object' && items.properties) {
        const itemProps = items.properties as Record<string, PropertySchema>
        const itemRequired = new Set<string>(
          Array.isArray(items.required) ? (items.required as string[]) : []
        )
        appendPropertyParams(lines, itemProps, itemRequired, `${prefix}.${propName}[]`)
      }
    }
  }
}

/**
 * Generate a JSDoc function stub from a tool schema.
 *
 * This mirrors mcphub's `inspect` output style.
 */
export function schemaToJSDoc(toolName: string, description: string | undefined, inputSchema: unknown): string {
  const schema =
    (inputSchema as InputSchema | undefined) && typeof inputSchema === 'object'
      ? (inputSchema as InputSchema)
      : undefined

  const desc = (description || toolName).trim() || toolName

  const required = new Set<string>(Array.isArray(schema?.required) ? schema?.required : [])
  const properties = schema?.properties ?? {}

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

export function formatAsText(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
