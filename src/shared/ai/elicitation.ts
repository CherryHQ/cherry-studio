import * as z from 'zod'

const labels = { title: z.string().nullish(), description: z.string().nullish() }
const choice = z.object({ const: z.string(), title: z.string(), description: z.string().nullish() })
const bounds = { minimum: z.number().nullish(), maximum: z.number().nullish(), default: z.number().nullish() }
const FieldSchema = z.discriminatedUnion('type', [
  z.object({
    ...labels,
    type: z.literal('string'),
    minLength: z.number().int().nonnegative().nullish(),
    maxLength: z.number().int().nonnegative().nullish(),
    pattern: z.string().nullish(),
    format: z.enum(['email', 'uri', 'date', 'date-time']).nullish(),
    enum: z.array(z.string()).min(1).nullish(),
    oneOf: z.array(choice).min(1).nullish(),
    default: z.string().nullish()
  }),
  z.object({ ...labels, type: z.literal('number'), ...bounds }),
  z.object({ ...labels, type: z.literal('integer'), ...bounds }),
  z.object({ ...labels, type: z.literal('boolean'), default: z.boolean().nullish() }),
  z.object({
    ...labels,
    type: z.literal('array'),
    items: z.union([
      z.object({ type: z.literal('string'), enum: z.array(z.string()).min(1) }),
      z.object({ anyOf: z.array(choice).min(1) })
    ]),
    minItems: z.number().int().nonnegative().nullish(),
    maxItems: z.number().int().nonnegative().nullish(),
    default: z.array(z.string()).nullish()
  })
])

export const ElicitationFormSchema = z
  .object({
    type: z.literal('object').default('object'),
    ...labels,
    properties: z.record(z.string(), FieldSchema).default({}),
    required: z.array(z.string()).nullish()
  })
  .refine((form) => (form.required ?? []).every((id) => Object.hasOwn(form.properties, id)), {
    message: 'Unknown required field'
  })
export type ElicitationForm = z.infer<typeof ElicitationFormSchema>
export type ElicitationField = z.infer<typeof FieldSchema>
export type ElicitationContent = Record<string, string | number | boolean | string[]>

export function elicitationChoices(field: ElicitationField) {
  if (field.type === 'boolean')
    return [
      { id: 'true', label: 'true' },
      { id: 'false', label: 'false' }
    ]
  const items = field.type === 'array' ? field.items : undefined
  const titled = field.type === 'string' ? field.oneOf : items && 'anyOf' in items ? items.anyOf : undefined
  const values = field.type === 'string' ? field.enum : items && 'enum' in items ? items.enum : undefined
  return (
    titled?.map((option) => ({
      id: option.const,
      label: option.title,
      description: option.description ?? undefined
    })) ??
    values?.map((value) => ({ id: value, label: value })) ??
    []
  )
}

function jsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSchema)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => item != null && key !== 'default')
        .map(([key, item]) => [key, jsonSchema(item)])
    )
  return value
}

export function elicitationValidator(form: ElicitationForm) {
  return z.fromJSONSchema({
    type: 'object',
    properties: Object.fromEntries(Object.entries(form.properties).map(([id, field]) => [id, jsonSchema(field)])),
    required: form.required ?? [],
    additionalProperties: false
  } as z.core.JSONSchema.BaseSchema)
}

export function elicitationContent(
  form: ElicitationForm,
  selected: Record<number, string[]>,
  custom: Record<number, string>
): ElicitationContent {
  return Object.fromEntries(
    Object.entries(form.properties).flatMap<[string, ElicitationContent[string]]>(([id, field], index) => {
      const values = selected[index] ?? []
      if (field.type === 'array') return selected[index] === undefined ? [] : [[id, values]]
      if (values.length) return [[id, field.type === 'boolean' ? values[0] === 'true' : values[0]]]
      if (elicitationChoices(field).length || custom[index] === undefined) return []
      const value = custom[index]
      if (field.type === 'number' || field.type === 'integer') return value.trim() ? [[id, Number(value)]] : []
      return [[id, value]]
    })
  )
}
