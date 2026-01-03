import * as z from 'zod'

export type ResponsesReasoningRawPayload = {
  itemId: string
  encryptedContent: string
}

const ResponsesReasoningRawPayloadSchema = z.object({
  type: z.literal('responses_reasoning'),
  itemId: z.string().min(1),
  encryptedContent: z.string().min(1)
})

const ResponsesReasoningProviderMetadataSchema = z.object({
  itemId: z.string().min(1),
  reasoningEncryptedContent: z.string().min(1)
})

const ResponsesReasoningProviderMetadataLegacySchema = z.object({
  itemId: z.string().min(1),
  encryptedContent: z.string().min(1)
})

export function parseResponsesReasoningRawPayload(value: unknown): ResponsesReasoningRawPayload | undefined {
  const rawParsed = ResponsesReasoningRawPayloadSchema.safeParse(value)
  if (rawParsed.success) {
    return { itemId: rawParsed.data.itemId, encryptedContent: rawParsed.data.encryptedContent }
  }

  // If this looks like a RAW chunk but isn't our expected type, don't fall back to metadata parsing.
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'type' in value) {
    return undefined
  }

  const providerMetadataParsed = ResponsesReasoningProviderMetadataSchema.safeParse(value)
  if (providerMetadataParsed.success) {
    return {
      itemId: providerMetadataParsed.data.itemId,
      encryptedContent: providerMetadataParsed.data.reasoningEncryptedContent
    }
  }

  const legacyProviderMetadataParsed = ResponsesReasoningProviderMetadataLegacySchema.safeParse(value)
  if (legacyProviderMetadataParsed.success) {
    return {
      itemId: legacyProviderMetadataParsed.data.itemId,
      encryptedContent: legacyProviderMetadataParsed.data.encryptedContent
    }
  }

  return undefined
}
