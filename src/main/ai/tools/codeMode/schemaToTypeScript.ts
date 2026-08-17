type JsonSchema = Record<string, unknown>

const MAX_NESTING_DEPTH = 5

function quotePropertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}

function literalType(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  return 'unknown'
}

function docText(value: string): string {
  return value.trim().split('\n')[0].replaceAll('*/', '*\\/')
}

export function jsonSchemaToTypeScript(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== 'object' || depth >= MAX_NESTING_DEPTH) return 'unknown'
  const value = schema as JsonSchema

  if ('const' in value) return literalType(value.const)
  if (Array.isArray(value.enum) && value.enum.length > 0) return value.enum.map(literalType).join(' | ')

  for (const unionKey of ['anyOf', 'oneOf'] as const) {
    const variants = value[unionKey]
    if (Array.isArray(variants) && variants.length > 0) {
      return variants.map((variant) => jsonSchemaToTypeScript(variant, depth + 1)).join(' | ')
    }
  }

  if (Array.isArray(value.allOf) && value.allOf.length > 0) {
    return value.allOf.map((variant) => jsonSchemaToTypeScript(variant, depth + 1)).join(' & ')
  }

  const typeValue = value.type
  if (Array.isArray(typeValue)) {
    return typeValue.map((type) => jsonSchemaToTypeScript({ ...value, type }, depth + 1)).join(' | ')
  }

  switch (typeValue) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `Array<${jsonSchemaToTypeScript(value.items, depth + 1)}>`
    case 'object':
    case undefined: {
      const properties = value.properties
      if (!properties || typeof properties !== 'object') {
        return value.additionalProperties && typeof value.additionalProperties === 'object'
          ? `Record<string, ${jsonSchemaToTypeScript(value.additionalProperties, depth + 1)}>`
          : 'Record<string, unknown>'
      }
      const required = new Set(Array.isArray(value.required) ? (value.required as string[]) : [])
      const fields = Object.entries(properties as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, property]) => {
          const description =
            property && typeof property === 'object' && typeof (property as JsonSchema).description === 'string'
              ? `/** ${docText(String((property as JsonSchema).description))} */ `
              : ''
          return `${description}${quotePropertyName(name)}${required.has(name) ? '' : '?'}: ${jsonSchemaToTypeScript(property, depth + 1)}`
        })
      return fields.length > 0 ? `{ ${fields.join('; ')} }` : 'Record<string, unknown>'
    }
    default:
      return 'unknown'
  }
}

interface ToolTypeScriptInput {
  name: string
  description?: string
  inputSchema: unknown
  outputSchema?: unknown
}

function toolInvokeToTypeScript(tool: ToolTypeScriptInput, indent: string): string[] {
  const doc = docText(tool.description || tool.name)
  const output = tool.outputSchema ? jsonSchemaToTypeScript(tool.outputSchema) : 'McpToolResult'
  return [
    `${indent}/** ${doc} */`,
    `${indent}invoke(name: ${JSON.stringify(tool.name)}, params: ${jsonSchemaToTypeScript(tool.inputSchema)}): Promise<${output}>`
  ]
}

/** Generate one valid declaration with an overload for every discovered tool. */
export function toolsToTypeScript(tools: readonly ToolTypeScriptInput[]): string {
  return [
    'type McpToolResult<T = unknown> = {',
    "  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>",
    '  details?: T',
    '}',
    '',
    'declare const tools: {',
    ...tools.flatMap((tool) => toolInvokeToTypeScript(tool, '  ')),
    '}'
  ].join('\n')
}

/** Generate the `tools.invoke` overload shown for one tool in structured discovery details. */
export function toolToTypeScript(
  toolName: string,
  description: string | undefined,
  inputSchema: unknown,
  outputSchema?: unknown
): string {
  return toolsToTypeScript([{ name: toolName, description, inputSchema, outputSchema }])
}
