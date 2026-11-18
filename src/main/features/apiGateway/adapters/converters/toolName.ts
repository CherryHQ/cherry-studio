import * as z from 'zod'

export const nonBlankToolNameSchema = z.string().refine((name) => name.trim().length > 0)
