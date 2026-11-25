import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker'
import { jsonSchema, type JSONSchema7 } from 'ai'

const jsonSchemaValidator = new CfWorkerJsonSchemaValidator({ shortcircuit: false })

export function createMcpJsonSchemaValidator<T = unknown>(schema: JSONSchema7) {
  const validate = jsonSchemaValidator.getValidator(schema as never)

  return (value: unknown) => {
    const result = validate(value)
    return result.valid
      ? { success: true as const, value: result.data as T }
      : { success: false as const, error: new Error(result.errorMessage) }
  }
}

/**
 * Strict OpenAI-compatible providers reject object schemas without `type` or `properties`,
 * which MCP servers emit for tools that take no arguments.
 */
function normalizeMcpInputSchema(schema: JSONSchema7): JSONSchema7 {
  if (schema.$ref !== undefined) return schema

  const type = schema.type ?? 'object'
  return {
    ...schema,
    type,
    properties: type === 'object' ? (schema.properties ?? {}) : schema.properties
  }
}

export function createMcpInputSchema(schema: JSONSchema7) {
  const normalized = normalizeMcpInputSchema(schema)
  return jsonSchema<Record<string, unknown>>(normalized, {
    validate: createMcpJsonSchemaValidator<Record<string, unknown>>(normalized)
  })
}
