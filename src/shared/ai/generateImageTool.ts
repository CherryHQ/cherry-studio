import {
  type CanonicalParamKey,
  IMAGE_PARAM_CATALOG,
  type ImageGenerationMode,
  type ImageGenerationSupport,
  type SupportSpec
} from '@cherrystudio/provider-registry'
import * as z from 'zod'

export const GENERATE_IMAGE_TOOL_NAME = 'generate_image'

const DEFAULT_MAX_INPUT_IMAGES = 4
const ABSOLUTE_MAX_INPUT_IMAGES = 10

const GENERATE_IMAGE_PROMPT_FIELD = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .describe('Vivid, self-contained description of the image to produce. Include subject, style, composition, and mood.')

type ToolMode = Extract<ImageGenerationMode, 'generate' | 'edit'>

export type GenerateImageToolInput = {
  prompt: string
  image_ids?: string[] | null
} & Partial<Record<CanonicalParamKey, unknown>>

function describeParam(key: CanonicalParamKey, spec: SupportSpec, modes: readonly ToolMode[]): string {
  const prefix = `Canonical painting parameter for ${modes.join('/')} mode: ${key}.`
  switch (spec.type) {
    case 'enum':
      return `${prefix} Allowed values: ${spec.options.join(', ')}.${spec.default === undefined ? '' : ` Default: ${spec.default}.`}`
    case 'range':
      return `${prefix} Range: ${spec.min}-${spec.max}.${spec.step === undefined ? '' : ` Step: ${spec.step}.`}${spec.default === undefined ? '' : ` Default: ${spec.default}.`}`
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

type CatalogJsonType = 'boolean' | 'integer' | 'number' | 'string'

function catalogJsonType(key: CanonicalParamKey): CatalogJsonType | undefined {
  // provider-registry and the app can temporarily resolve different Zod patch versions. Read the
  // catalog schema's plain JSON type instead of embedding its Zod instance into the app schema.
  const catalogSchema = IMAGE_PARAM_CATALOG[key].schema as unknown as {
    nonoptional(): { toJSONSchema(): { type?: string } }
  }
  const type = catalogSchema.nonoptional().toJSONSchema().type
  return type === 'boolean' || type === 'integer' || type === 'number' || type === 'string' ? type : undefined
}

function catalogValueSchema(key: CanonicalParamKey): z.ZodType {
  switch (catalogJsonType(key)) {
    case 'boolean':
      return z.boolean()
    case 'integer':
      return z.coerce.number().int()
    case 'number':
      return z.coerce.number()
    case 'string':
      return z.string()
    default:
      return z.unknown()
  }
}

function constrainedParamSchema(key: CanonicalParamKey, spec: SupportSpec): z.ZodType {
  const base = catalogValueSchema(key)
  switch (spec.type) {
    case 'enum': {
      const [first, ...rest] = spec.options
      return first === undefined ? base : z.enum([first, ...rest])
    }
    case 'range': {
      let range =
        catalogJsonType(key) === 'integer'
          ? z.coerce.number().int().min(spec.min).max(spec.max)
          : z.coerce.number().min(spec.min).max(spec.max)
      if (spec.step !== undefined) range = range.multipleOf(spec.step)
      return range
    }
    case 'size':
      return z
        .string()
        .regex(/^\d+x\d+$/i, 'expected WIDTHxHEIGHT')
        .refine(
          (value) => {
            const [width, height] = value.toLowerCase().split('x').map(Number)
            return width >= spec.minSide && width <= spec.maxSide && height >= spec.minSide && height <= spec.maxSide
          },
          { message: 'size side out of range' }
        )
    default:
      return base
  }
}

function resolveToolModes(support: ImageGenerationSupport | null | undefined): ToolMode[] {
  if (!support) return ['generate']
  const modes: ToolMode[] = []
  if (support.modes.generate) modes.push('generate')
  if (support.modes.edit) modes.push('edit')
  return modes
}

export function resolveGenerateImageInputLimit(support: ImageGenerationSupport | null | undefined): number {
  const spec = support?.modes.edit?.supports.maxImages
  const configuredMax = spec?.type === 'range' ? Math.floor(spec.max) : DEFAULT_MAX_INPUT_IMAGES
  return Math.max(1, Math.min(configuredMax, ABSOLUTE_MAX_INPUT_IMAGES))
}

/** Build the runtime tool contract from one model capability block. */
export function buildGenerateImageToolSchema(
  support: ImageGenerationSupport | null | undefined
): z.ZodObject<Record<string, z.ZodType>> {
  const modes = resolveToolModes(support)
  const params = new Map<CanonicalParamKey, Array<{ mode: ToolMode; spec: SupportSpec }>>()

  for (const mode of modes) {
    const modeSupports = support?.modes[mode]?.supports
    if (!modeSupports) continue
    for (const [key, spec] of Object.entries(modeSupports) as Array<[CanonicalParamKey, SupportSpec]>) {
      const entries = params.get(key) ?? []
      entries.push({ mode, spec })
      params.set(key, entries)
    }
  }

  const inputShape: Record<string, z.ZodType> = { prompt: GENERATE_IMAGE_PROMPT_FIELD }

  for (const [key, entries] of params) {
    const variants = entries.map(({ spec }) => constrainedParamSchema(key, spec))
    const schema = (
      variants.length === 1 ? variants[0] : z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]])
    ).describe(
      describeParam(
        key,
        entries[0].spec,
        entries.map(({ mode }) => mode)
      )
    )
    inputShape[key] = schema.optional()
  }

  if (modes.includes('edit')) {
    const imageIds = z
      .array(z.string().trim().min(1))
      .min(1)
      .max(resolveGenerateImageInputLimit(support))
      .describe('FileEntry ids of existing images to edit or use as references. Omit to generate a new image.')
    const editOnly = !modes.includes('generate')
    inputShape.image_ids = editOnly ? imageIds : imageIds.optional()
  }

  return z.object(inputShape).strict()
}

/** Fallback contract used when the configured model has no registry capability block. */
export const generateImageInputSchema = buildGenerateImageToolSchema(undefined)

export const generateImageOutputItemSchema = z.object({
  id: z.string().describe('File entry id of the generated image.'),
  name: z.string().describe('File name of the generated image.')
})

export const generateImageOutputSchema = z.array(generateImageOutputItemSchema)

export type GenerateImageOutputItem = z.infer<typeof generateImageOutputItemSchema>
export type GenerateImageOutput = z.infer<typeof generateImageOutputSchema>
