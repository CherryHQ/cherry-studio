import { objectValues } from '@types'
import * as z from 'zod'

export const BuiltinOcrProviderIdMap = {
  tesseract: 'tesseract',
  system: 'system',
  paddleocr: 'paddleocr',
  ovocr: 'ovocr'
} as const satisfies Record<string, BuiltinOcrProviderId>

export const BuiltinOcrProviderIds = Object.freeze(objectValues(BuiltinOcrProviderIdMap))

export const BuiltinOcrProviderIdSchema = z.enum(['tesseract', 'system', 'paddleocr', 'ovocr'])

export type BuiltinOcrProviderId = z.infer<typeof BuiltinOcrProviderIdSchema>

export const isBuiltinOcrProviderId = (id: string): id is BuiltinOcrProviderId => {
  return BuiltinOcrProviderIdSchema.safeParse(id).success
} // extensible

export const OcrProviderCapabilities = {
  image: 'image'
  // pdf: 'pdf'
} as const satisfies Record<string, OcrProviderCapability>

export const OcrProviderCapabilitySchema = z.enum(['image'])

export type OcrProviderCapability = z.infer<typeof OcrProviderCapabilitySchema>

export const isOcrProviderCapability = (cap: string): cap is OcrProviderCapability => {
  return OcrProviderCapabilitySchema.safeParse(cap).success
}

export const OcrProviderCapabilityRecordSchema = z.partialRecord(OcrProviderCapabilitySchema, z.boolean())

export type OcrProviderCapabilityRecord = z.infer<typeof OcrProviderCapabilityRecordSchema>

/**
 * Extend this type to define provider-specefic config types.
 */
export const OcrProviderApiConfigSchema = z.object({
  apiKey: z.string(),
  apiHost: z.string(),
  apiVersion: z.string().optional()
})
export type OcrProviderApiConfig = z.infer<typeof OcrProviderApiConfigSchema>
export const isOcrProviderApiConfig = (config: unknown): config is OcrProviderApiConfig => {
  return OcrProviderApiConfigSchema.safeParse(config).success
} /**
 * For future. Model based ocr, api based ocr. May different api client.
 *
 * Extend this type to define provider-specific config types.
 */

export const OcrProviderBaseConfigSchema = z.object({
  enabled: z.boolean().default(false)
})

export type OcrProviderBaseConfig = z.infer<typeof OcrProviderBaseConfigSchema>

export const OcrProviderConfigSchema = OcrProviderBaseConfigSchema.loose()

export type OcrProviderConfig = z.infer<typeof OcrProviderConfigSchema>

export const OcrProviderIdSchema = z.string()

export type OcrProviderId = z.infer<typeof OcrProviderIdSchema>

export const OcrProviderNameSchema = z.string()

export const OcrProviderSchema = z.object({
  id: OcrProviderIdSchema,
  name: OcrProviderNameSchema,
  capabilities: OcrProviderCapabilityRecordSchema,
  config: OcrProviderConfigSchema
})

export type OcrProvider = z.infer<typeof OcrProviderSchema>

export const isOcrProvider = (p: unknown): p is OcrProvider => {
  return OcrProviderSchema.safeParse(p).success
}

export const OcrApiProviderConfigSchema = OcrProviderBaseConfigSchema.extend({
  api: OcrProviderApiConfigSchema
})
export type OcrApiProviderConfig = z.infer<typeof OcrApiProviderConfigSchema>
export const isOcrApiProviderConfig = (config: unknown): config is OcrApiProviderConfig => {
  return OcrApiProviderConfigSchema.safeParse(config).success
}

export const OcrApiProviderSchema = OcrProviderSchema
/** Currently, there is no API provider yet, but we've left room for expansion. */
export type OcrApiProvider = z.infer<typeof OcrApiProviderSchema>
export const isOcrApiProvider = (p: unknown): p is OcrApiProvider => {
  return OcrApiProviderSchema.safeParse(p).success
}

export type BuiltinOcrProvider = OcrProvider & {
  id: BuiltinOcrProviderId
}
export const isBuiltinOcrProvider = (p: OcrProvider): p is BuiltinOcrProvider => {
  return isBuiltinOcrProviderId(p.id)
}

// Not sure compatible api endpoint exists. May not support custom ocr provider
export type CustomOcrProvider = OcrProvider & {
  id: Exclude<string, BuiltinOcrProviderId>
}

export type ImageOcrProvider = OcrProvider & {
  capabilities: OcrProviderCapabilityRecord & {
    [OcrProviderCapabilities.image]: true
  }
}
export const isImageOcrProvider = (p: OcrProvider): p is ImageOcrProvider => {
  return p.capabilities.image === true
}
