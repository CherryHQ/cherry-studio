import * as z from 'zod'

import type { OcrProviderCapabilityRecord } from './provider/base'
import { OcrProviderCapabilityRecordSchema } from './provider/base'

// OCR models and providers share the same type definition.
// A provider can offer capabilities to process multiple file types,
// while a model belonging to that provider may be limited to processing only one specific file type.

export type OcrModelCapabilityRecord = OcrProviderCapabilityRecord
export const OcrModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerId: z.string(),
  capabilities: OcrProviderCapabilityRecordSchema
})
export type OcrModel = z.infer<typeof OcrModelSchema>
