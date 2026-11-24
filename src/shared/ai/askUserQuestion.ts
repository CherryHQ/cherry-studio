import * as z from 'zod'

/** Decode answers keyed by literal question text, including Object.prototype property names. */
export function questionKeyRecord<Value>(valueSchema: z.ZodType<Value>) {
  return z.preprocess(
    (value, ctx) => {
      if (typeof value !== 'object' || value === null || !z.util.isPlainObject(value)) {
        ctx.addIssue({ code: 'invalid_type', expected: 'record', input: value })

        return z.NEVER
      }

      return Reflect.ownKeys(value).flatMap((key) => {
        if (!Object.getOwnPropertyDescriptor(value, key)?.enumerable) return []

        return [[key, value[key]]]
      })
    },
    z.array(z.tuple([z.string(), valueSchema])).transform((entries) => Object.fromEntries<Value>(entries))
  )
}
