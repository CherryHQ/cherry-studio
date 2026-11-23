// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Declaration generation inspects raw schema keywords without asserting that a whole dialect was validated.
type JsonSchema = Record<string, unknown>

const MAX_NESTING_DEPTH = 5

function quotePropertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Schema const/enum entries are unvalidated; emit literals only for supported scalar values and fall back to unknown otherwise.
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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This declaration converter accepts raw schema values; its recursive walker checks containers and supported keywords before emitting types.
export function jsonSchemaToTypeScript(schema: unknown, depth = 0): string {
  return schemaToTypeScript(schema, schema, depth, new Set())
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Nested keywords and local JSON pointers can resolve to arbitrary schema values; check each container and bound recursion before rendering.
function schemaToTypeScript(schema: unknown, root: unknown, depth: number, resolvingRefs: ReadonlySet<string>): string {
  if (!schema || typeof schema !== 'object' || depth >= MAX_NESTING_DEPTH) return 'unknown'
  // SAFETY: The container is an object; each rendering branch checks its own supported keywords.
  const value = schema as JsonSchema

  if (typeof value.$ref === 'string') {
    const ref = value.$ref

    if (resolvingRefs.has(ref)) return 'unknown'

    if (!ref.startsWith('#/')) return 'unknown'
    let resolved: unknown = root

    for (const segment of ref.slice(2).split('/')) {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~')

      if (!resolved || typeof resolved !== 'object' || !(key in resolved)) return 'unknown'
      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- A JSON pointer may resolve to any value; the recursive walker validates the next container.
      resolved = (resolved as Record<string, unknown>)[key]
    }

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

      // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Property values remain unvalidated schemas and re-enter the bounded recursive walker.
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool declaration inputs retain raw schemas; jsonSchemaToTypeScript owns keyword inspection and unsupported-value fallback.
  inputSchema: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Optional output schemas use the same raw-schema converter as inputs rather than asserting a fully validated schema dialect.
  outputSchema?: unknown
): string {
  return toolsToTypeScript([{ name: toolName, description, inputSchema, outputSchema }])
}
