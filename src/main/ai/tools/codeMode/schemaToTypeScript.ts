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
  return schemaToTypeScript(schema, schema, depth, new Set())
}

function schemaToTypeScript(schema: unknown, root: unknown, depth: number, resolvingRefs: ReadonlySet<string>): string {
  if (!schema || typeof schema !== 'object' || depth >= MAX_NESTING_DEPTH) return 'unknown'
  const value = schema as JsonSchema

  if (typeof value.$ref === 'string') {
    const ref = value.$ref
    if (resolvingRefs.has(ref)) return 'unknown'
    const resolved = resolveLocalRef(root, ref)
    if (!resolved) return 'unknown'
    return schemaToTypeScript(resolved, root, depth + 1, new Set([...resolvingRefs, ref]))
  }

  if ('const' in value) return literalType(value.const)
  if (Array.isArray(value.enum) && value.enum.length > 0) return value.enum.map(literalType).join(' | ')

  for (const unionKey of ['anyOf', 'oneOf'] as const) {
    const variants = value[unionKey]
    if (Array.isArray(variants) && variants.length > 0) {
      return variants.map((variant) => schemaToTypeScript(variant, root, depth + 1, resolvingRefs)).join(' | ')
    }
  }

  if (Array.isArray(value.allOf) && value.allOf.length > 0) {
    return value.allOf.map((variant) => schemaToTypeScript(variant, root, depth + 1, resolvingRefs)).join(' & ')
  }

  const typeValue = value.type
  if (Array.isArray(typeValue)) {
    return typeValue.map((type) => schemaToTypeScript({ ...value, type }, root, depth + 1, resolvingRefs)).join(' | ')
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
      return `Array<${schemaToTypeScript(value.items, root, depth + 1, resolvingRefs)}>`
    case 'object':
    case undefined: {
      const properties = value.properties
      if (!properties || typeof properties !== 'object') {
        return value.additionalProperties && typeof value.additionalProperties === 'object'
          ? `Record<string, ${schemaToTypeScript(value.additionalProperties, root, depth + 1, resolvingRefs)}>`
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
          return `${description}${quotePropertyName(name)}${required.has(name) ? '' : '?'}: ${schemaToTypeScript(property, root, depth + 1, resolvingRefs)}`
        })
      return fields.length > 0 ? `{ ${fields.join('; ')} }` : 'Record<string, unknown>'
    }
    default:
      return 'unknown'
  }
}

function resolveLocalRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  return ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((value, segment) => {
      if (!value || typeof value !== 'object' || !(segment in value)) return undefined
      return (value as Record<string, unknown>)[segment]
    }, root)
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
