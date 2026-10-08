import { isEqual } from 'es-toolkit'
import * as z from 'zod'

import {
  buildImageParamSchema,
  type CanonicalParamKey,
  type ImageGenerationSupport,
  resolveImageCapability,
  type SupportSpec
} from '@cherrystudio/provider-registry'

const GENERATE_IMAGE_PROMPT_FIELD = z
  .string()
  .trim()
  .max(4000)
  .describe('Vivid, self-contained description of the image to produce. Include subject, style, composition, and mood.')

export type GenerateImageToolInput = {
  prompt: string
  image_ids?: string[] | null
} & Partial<Record<CanonicalParamKey, unknown>>

function describeParam(key: CanonicalParamKey, spec: SupportSpec): string {
  const prefix = `Canonical image generation parameter: ${key}.`
  switch (spec.type) {
    case 'enum':
      return `${prefix} Allowed values: ${spec.options.join(', ')}.${spec.default === undefined ? '' : ` Default: ${spec.default}.`}`
    case 'range':
      return `${prefix} Range: ${spec.min}-${spec.max}.${spec.default === undefined ? '' : ` Default: ${spec.default}.`}`
    case 'size':
      return `${prefix} Use WIDTHxHEIGHT with each side between ${spec.minSide} and ${spec.maxSide}.`
    case 'switch':
      return `${prefix}${spec.default === undefined ? '' : ` Default: ${spec.default}.`}`
    case 'text':
      return prefix
    default: {
      const exhaustive: never = spec
      return exhaustive
    }
  }
}

/** Build the tool's ordinary-generation subset from the same capability as Main and the page. */
export function buildGenerateImageToolSchema(
  support: ImageGenerationSupport | null | undefined
): z.ZodObject<Record<string, z.ZodType>> {
  const resolution = resolveImageCapability(support ?? undefined, 'generate', false)
  const withImages = resolveImageCapability(support ?? undefined, 'generate', true)
  const inputShape: Record<string, z.ZodType> = {
    prompt:
      resolution.kind === 'supported' && resolution.capability.inputs.prompt === 'optional'
        ? GENERATE_IMAGE_PROMPT_FIELD
        : GENERATE_IMAGE_PROMPT_FIELD.min(1)
  }
  if (resolution.kind === 'unsupported')
    return z
      .object(inputShape)
      .strict()
      .refine(() => false, 'Ordinary image generation is not supported')
  if (resolution.kind === 'supported') {
    const { supports, inputs } = resolution.capability
    for (const [key, spec] of Object.entries(supports) as Array<[CanonicalParamKey, SupportSpec]>) {
      // The tool exposes shared parameters only; input-specific controls stay on the painting page.
      if (withImages.kind === 'supported' && !isEqual(withImages.capability.supports[key], spec)) continue
      let field = buildImageParamSchema(key, supports)
      if (
        spec.type === 'enum' &&
        Object.values(supports).some((entry) => entry.type === 'size' && entry.pairedEnumKey === key)
      ) {
        field = field.or(z.literal('custom'))
      }
      inputShape[key] = field.describe(describeParam(key, spec)).optional()
    }
    const imageIds = z
      .array(z.string().trim().min(1))
      .min(Math.max(1, inputs.images.min))
      .describe('FileEntry ids of images to use as references.')
    const boundedImages = inputs.images.max.kind === 'known' ? imageIds.max(inputs.images.max.value) : imageIds
    inputShape.image_ids = inputs.images.min > 0 ? boundedImages : boundedImages.optional()
  }
  return z.object(inputShape).strict()
}

/** Fallback contract used when the configured model has no registry capability block. */
export const generateImageInputSchema = buildGenerateImageToolSchema(undefined)
