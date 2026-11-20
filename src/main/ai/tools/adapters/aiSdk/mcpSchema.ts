import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker'
import { jsonSchema, type JSONSchema7 } from 'ai'

const jsonSchemaValidator = new CfWorkerJsonSchemaValidator({ shortcircuit: false })

export function createMcpJsonSchemaValidator<T = unknown>(schema: JSONSchema7) {
  const validate = jsonSchemaValidator.getValidator(schema as never)

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- MCP tool inputs stay untyped until the selected server-provided JSON schema validator accepts them.
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
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Server-selected schemas define argument values dynamically; the validator below owns their runtime contract.
  return jsonSchema<Record<string, unknown>>(normalized, {
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Validation does not provide a static TypeScript value type for arbitrary server-defined properties.
    validate: createMcpJsonSchemaValidator<Record<string, unknown>>(normalized)
  })
}
