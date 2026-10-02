/** Converts boolean subschemas to equivalent objects for strict MCP clients, leaving schema data untouched. */
export function normalizeMcpServedSchema(schema: unknown): unknown {
  if (schema === true) return {}
  if (schema === false) return { not: {} }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return schema

  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => {
      switch (key) {
        case 'properties':
        case 'patternProperties':
        case 'dependentSchemas':
        case '$defs':
        case 'definitions':
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            return [
              key,
              Object.fromEntries(Object.entries(value).map(([name, child]) => [name, normalizeMcpServedSchema(child)]))
            ]
          }
          break
        case 'items':
          return [key, Array.isArray(value) ? value.map(normalizeMcpServedSchema) : normalizeMcpServedSchema(value)]
        case 'prefixItems':
        case 'allOf':
        case 'anyOf':
        case 'oneOf':
          if (Array.isArray(value)) return [key, value.map(normalizeMcpServedSchema)]
          break
        case 'additionalProperties':
        case 'unevaluatedProperties':
        case 'propertyNames':
        case 'contains':
        case 'unevaluatedItems':
        case 'additionalItems':
        case 'not':
        case 'if':
        case 'then':
        case 'else':
          return [key, normalizeMcpServedSchema(value)]
      }
      return [key, value]
    })
  )
}
