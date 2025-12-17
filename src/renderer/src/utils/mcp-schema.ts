/**
 * Recursively filters and validates properties for OpenAI o3 strict schema validation
 *
 * o3 strict mode requirements:
 * 1. ALL object schemas (including nested ones) must have complete required arrays with ALL property keys
 * 2. Object schemas with additionalProperties: false MUST have a properties field (even if empty)
 *
 * This function recursively processes the entire schema tree to ensure compliance.
 */
export function filterProperties(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  // Handle arrays by recursively processing items
  if (Array.isArray(schema)) {
    return schema.map(filterProperties)
  }

  const filtered = { ...schema }

  // Process all properties recursively first
  if (filtered.properties && typeof filtered.properties === 'object') {
    const newProperties: any = {}
    for (const [key, value] of Object.entries(filtered.properties)) {
      newProperties[key] = filterProperties(value)
    }
    filtered.properties = newProperties
  }

  // Process other schema fields that might contain nested schemas
  if (filtered.items) {
    filtered.items = filterProperties(filtered.items)
  }
  if (filtered.additionalProperties && typeof filtered.additionalProperties === 'object') {
    filtered.additionalProperties = filterProperties(filtered.additionalProperties)
  }
  if (filtered.patternProperties) {
    const newPatternProperties: any = {}
    for (const [pattern, value] of Object.entries(filtered.patternProperties)) {
      newPatternProperties[pattern] = filterProperties(value)
    }
    filtered.patternProperties = newPatternProperties
  }

  // Handle schema composition keywords (array-based)
  const arrayCompositionKeywords = ['allOf', 'anyOf', 'oneOf']
  for (const keyword of arrayCompositionKeywords) {
    if (filtered[keyword]) {
      filtered[keyword] = filtered[keyword].map(filterProperties)
    }
  }

  // Handle single schema keywords
  const singleSchemaKeywords = ['not', 'if', 'then', 'else']
  for (const keyword of singleSchemaKeywords) {
    if (filtered[keyword]) {
      filtered[keyword] = filterProperties(filtered[keyword])
    }
  }

  // For ALL object schemas in strict mode, ensure proper o3 compliance
  if (filtered.type === 'object') {
    // o3 requirement: object schemas must have a properties field (even if empty)
    if (!filtered.properties) {
      filtered.properties = {}
    }

    // o3 strict requirement 1: ALL properties must be in required array
    const propertyKeys = Object.keys(filtered.properties)
    filtered.required = propertyKeys

    // o3 strict requirement 2: additionalProperties must ALWAYS be false for strict validation
    // This applies regardless of the original value (true, undefined, etc.)
    filtered.additionalProperties = false
  }

  return filtered
}

/**
 * Fixes object properties for o3 strict mode by ensuring objects have properties field (even if empty)
 */
export function fixObjectPropertiesForO3(properties: Record<string, any>): Record<string, any> {
  const fixedProperties = { ...properties }
  for (const [propKey, propValue] of Object.entries(fixedProperties || {})) {
    if (propValue && typeof propValue === 'object') {
      const prop = propValue as any
      if (prop.type === 'object') {
        // For object types, ensure they have a properties field (even if empty) for o3 strict mode
        if (!prop.properties && prop.additionalProperties === false) {
          fixedProperties[propKey] = {
            ...prop,
            properties: {} // Add empty properties object for strict validation
          }
        }
      }
    }
  }
  return fixedProperties
}

/**
 * Processes MCP tool schema for OpenAI o3 strict validation requirements
 */
export function processSchemaForO3(inputSchema: any): {
  properties: Record<string, any>
  required: string[]
  additionalProperties: boolean
} {
  const filteredSchema = filterProperties(inputSchema)

  // For strict mode (like o3), ensure ALL properties are in required array
  // This must be done AFTER filterProperties since it sets its own required array
  const allPropertyKeys = Object.keys(filteredSchema.properties || {})

  // Fix object properties for o3 strict mode - ensure objects have properties field
  const fixedProperties = fixObjectPropertiesForO3(filteredSchema.properties)

  // Create clean schema object to avoid mutations
  return {
    properties: fixedProperties || {},
    required: allPropertyKeys, // o3 requires ALL properties to be in required
    additionalProperties: false
  }
}
