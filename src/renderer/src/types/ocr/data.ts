import * as z from 'zod'

import { type UpdateOcrProviderRequest } from './api'
import { type OcrProvider } from './provider/base'
import { OcrProviderSchema } from './provider/base'

// ==========================================================
//    Data layer Types
//
//    NOTE: Timestamp operations are not exposed to outside.
// ==========================================================
export const TimestampExtendShape = {
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable()
}
export const DbOcrProviderSchema = OcrProviderSchema.extend(TimestampExtendShape)
export type DbOcrProvider = z.infer<typeof DbOcrProviderSchema>
export function isDbOcrProvider(p: unknown): p is DbOcrProvider {
  return DbOcrProviderSchema.safeParse(p).success
}

export type DbOcrProviderCreate = OcrProvider
export type DbOcrProviderUpdate = UpdateOcrProviderRequest
export type DbOcrProviderReplace = OcrProvider
export type DbOcrProviderKey = DbOcrProvider['id']
