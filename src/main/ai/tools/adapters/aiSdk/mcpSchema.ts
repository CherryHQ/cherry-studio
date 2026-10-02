import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import { jsonSchema, type JSONSchema7 } from 'ai'

const jsonSchemaValidator = new CfWorkerJsonSchemaValidator({ draft: '2020-12', shortcircuit: false })

export function createMcpJsonSchemaValidator<T = unknown>(schema: JSONSchema7) {
  const validate = jsonSchemaValidator.getValidator(schema as never)

  return (value: unknown) => {
    const result = validate(value)
    return result.valid
      ? { success: true as const, value: result.data as T }
      : { success: false as const, error: new Error(result.errorMessage) }
  }
}

export function createMcpInputSchema(schema: JSONSchema7) {
  return jsonSchema<Record<string, unknown>>(schema, {
    validate: createMcpJsonSchemaValidator<Record<string, unknown>>(schema)
  })
}
