import * as z from 'zod'

import {
  CANONICAL_PARAM_KEY,
  imageParamsSchema,
  type CanonicalParamKey,
  type ImageGenerationMode,
  type ImageGenerationSupport,
  type ParamValues,
  type SupportSpec
} from '@cherrystudio/provider-registry'

import { resolveImageCanvasParams } from './imageCanvases'
import { ImageConfigError } from './ImageConfigError'

export const IMAGE_CONFIG_PRESETS = [
  { id: 'catalog', name: 'Auto', protocol: undefined },
  { id: 'seedream', name: 'Seedream', protocol: 'doubao' },
  { id: 'gpt-image-2', name: 'GPT Image 2', protocol: 'openai' },
  {
    id: 'gpt-image-2-5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    protocol: 'openai'
  },
  {
    id: 'gpt-image-2-5-flare',
    name: 'GPT Image 2.5 Flare',
    protocol: 'openai'
  },
  { id: 'gemini-3-1-flash-image', name: 'Nano Banana 2', protocol: 'google' },
  { id: 'gemini-3-pro-image', name: 'Nano Banana Pro', protocol: 'google' },
  {
    id: 'doubao-seedream-5-0-lite',
    name: 'Seedream 5.0 Lite',
    protocol: 'doubao'
  },
  {
    id: 'doubao-seedream-5-0-pro',
    name: 'Seedream 5.0 Pro',
    protocol: 'doubao'
  },
  { id: 'doubao-seedream-4-5', name: 'Seedream 4.5', protocol: 'doubao' },
  { id: 'grok-imagine-image-2-0', name: 'Grok Image 2.0', protocol: 'xai' }
] as const

/** Compact UI choices are separate from persisted IDs so saved presets remain readable. */
export const IMAGE_PRESET_CHOICES = [
  { id: 'gpt-image-2-5-sunburst', name: 'GPT Image' },
  { id: 'gemini-3-1-flash-image', name: 'Nano Banana' },
  { id: 'seedream', name: 'Seedream' },
  { id: 'grok-imagine-image-2-0', name: 'Grok Image' }
] as const

export function imagePresetFamily(preset: string): string {
  if (preset === 'catalog') return 'gpt-image-2-5-sunburst'
  if (preset === 'gpt-image-2-5-flare') return 'gpt-image-2-5-sunburst'
  if (preset.startsWith('doubao-seedream-')) return 'seedream'
  return preset
}

/** Resolve the exact registry template used to validate and run a saved preset. */
export function imagePresetSupportId(preset: string): string {
  if (preset === 'catalog') return 'catalog'
  if (preset === 'seedream') return 'doubao-seedream-5-0-pro'
  if (preset === 'gpt-image-2-5-flare') return 'gpt-image-2-5-sunburst'
  return preset
}

/** Infer a native image preset for a known model id; unknown ids keep the GPT default. */
export function inferImagePreset(modelId: string): string | undefined {
  const id = modelId.toLowerCase().replace(/[._]/g, '-')
  if (id.includes('gemini') && id.includes('image')) return 'gemini-3-1-flash-image'
  if (id.includes('nano-banana')) return 'gemini-3-1-flash-image'
  if (id.includes('seedream') || id.includes('doubao')) {
    if (id.includes('4-5')) return 'doubao-seedream-4-5'
    if (id.includes('5-0-pro') || id.includes('5-pro')) return 'doubao-seedream-5-0-pro'
    if (id.includes('5-0-lite') || id.includes('5-lite')) return 'doubao-seedream-5-0-lite'
    return 'seedream'
  }
  if (id.includes('grok') && id.includes('image')) return 'grok-imagine-image-2-0'
  if (id.startsWith('gpt-image') || id.startsWith('dall-e')) return 'gpt-image-2-5-sunburst'
  return undefined
}

export function visibleImagePresets(preset: string): Array<{ id: string; name: string }> {
  const choices: Array<{ id: string; name: string }> = [...IMAGE_PRESET_CHOICES]
  if (!choices.some((choice) => choice.id === imagePresetFamily(preset))) {
    const saved = IMAGE_CONFIG_PRESETS.find((choice) => choice.id === preset)
    if (saved) choices.push(saved)
  }
  return choices
}

const optionKeys = z.enum(Object.values(CANONICAL_PARAM_KEY) as [CanonicalParamKey, ...CanonicalParamKey[]])
export const ImageOperationConfigSchema = z.strictObject({
  defaults: imageParamsSchema.strict().default({}),
  options: z.partialRecord(optionKeys, z.array(z.string().trim().min(1)).min(1)).default({}),
  maxImages: z.number().int().positive().optional(),
  maxInputImages: z.number().int().positive().optional(),
  sizeRules: z
    .record(
      z.string(),
      z.object({
        longEdge: z.number().int().positive(),
        maxPixels: z.number().int().positive().optional(),
        multiple: z.number().int().positive().default(16)
      })
    )
    .optional(),
  canvases: z
    .array(
      z.object({
        resolution: z.string().min(1),
        aspectRatio: z.string().min(1),
        size: z.string().regex(/^[1-9]\d*x[1-9]\d*$/)
      })
    )
    .optional()
})
export const ImageGenerationConfigSchema = z
  .strictObject({
    preset: z
      .enum(IMAGE_CONFIG_PRESETS.map((entry) => entry.id) as [string, ...string[]])
      .default('gpt-image-2-5-sunburst'),
    apiProtocol: z.enum(['openai', 'doubao']).optional(),
    generate: ImageOperationConfigSchema.default({ defaults: {}, options: {} }),
    edit: ImageOperationConfigSchema.nullable().default(null)
  })
  .refine((config) => !config.apiProtocol || imagePresetFamily(config.preset) === 'seedream', {
    path: ['apiProtocol'],
    message: 'An explicit image API protocol is only supported for Seedream templates'
  })
export type ImageGenerationConfig = z.infer<typeof ImageGenerationConfigSchema>
export type ImageOperationConfig = z.infer<typeof ImageOperationConfigSchema>

export function imageConfigProtocol(config?: ImageGenerationConfig | null) {
  return config?.apiProtocol ?? IMAGE_CONFIG_PRESETS.find((entry) => entry.id === config?.preset)?.protocol
}

function validateValue(key: string, value: unknown, spec: SupportSpec) {
  if (key === 'aspectRatio' && value !== 'auto') {
    const ratio = String(value)
      .replace(/^ASPECT_/, '')
      .replace(/_/g, ':')
    if (
      !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(ratio) ||
      ratio.split(':').some((part) => !Number.isFinite(Number(part)) || Number(part) <= 0)
    )
      throw new ImageConfigError('invalid_ratio', 'Invalid aspect ratio')
  }
  if (spec.type === 'enum' && !spec.options.includes(String(value)))
    throw new ImageConfigError('invalid_parameter', `${key}: unsupported option`)
  if (
    spec.type === 'range' &&
    (typeof value !== 'number' ||
      value < spec.min ||
      value > spec.max ||
      (spec.step && Math.abs((value - spec.min) / spec.step - Math.round((value - spec.min) / spec.step)) > 1e-8))
  )
    throw new ImageConfigError('invalid_parameter', `${key}: value outside the supported range`)
  if (spec.type === 'switch' && typeof value !== 'boolean')
    throw new ImageConfigError('invalid_parameter', `${key}: expected a boolean`)
}

/** Templates supply initial values; user options define the configured model without changing protocol keys. */
export function applyImageGenerationConfig(
  base: ImageGenerationSupport | null | undefined,
  input: ImageGenerationConfig
): ImageGenerationSupport {
  if (!base) throw new ImageConfigError('preset_required', 'Select an image preset with supported parameters')
  const config = ImageGenerationConfigSchema.parse(input)
  const result = structuredClone(base)
  for (const mode of ['generate', 'edit'] as const) {
    const original = base.modes[mode]
    if (!original) continue
    const definition = structuredClone(original)
    result.modes[mode] = definition
    definition.userConfigured = true
    const aspectRatio = definition.supports.aspectRatio
    if (aspectRatio?.type === 'enum') {
      if (!aspectRatio.options.includes('auto')) {
        aspectRatio.options = ['auto', ...aspectRatio.options]
      }
      aspectRatio.default = 'auto'
    }
    const settings = mode === 'edit' ? (config.edit ?? config.generate) : config.generate
    const inherited = mode === 'edit' && config.edit === null
    for (const [key, options] of Object.entries(settings.options)) {
      const spec = definition.supports[key as CanonicalParamKey]
      if (!spec && inherited) continue
      if (!spec || spec.type !== 'enum')
        throw new ImageConfigError('invalid_parameter', `${mode}/${key}: parameter is not an option field`)
      spec.options = [...new Set(key === 'aspectRatio' ? ['auto', ...options] : options)]
      if (spec.default !== undefined && !spec.options.includes(spec.default)) spec.default = spec.options[0]
    }
    if (settings.maxImages !== undefined) {
      const count = definition.supports.numImages ?? definition.supports.maxImages
      if (count?.type !== 'range' || settings.maxImages < count.min)
        throw new ImageConfigError('invalid_parameter', `${mode}: image count exceeds the selected preset`)
      count.max = settings.maxImages
      if (count.default !== undefined && count.default > count.max) count.default = count.max
    }
    if (settings.maxInputImages !== undefined) definition.maxInputImages = settings.maxInputImages
    if (settings.sizeRules) definition.sizeRules = structuredClone(settings.sizeRules)
    if (settings.canvases?.length) {
      definition.customCanvases = structuredClone(settings.canvases)
      const map = new Map(
        (definition.canvases ?? []).map((canvas) => [`${canvas.resolution}/${canvas.aspectRatio}`, canvas])
      )
      for (const canvas of settings.canvases) map.set(`${canvas.resolution}/${canvas.aspectRatio}`, canvas)
      definition.canvases = [...map.values()]
    }
    for (const [key, value] of Object.entries(settings.defaults)) {
      if (value === undefined) continue
      const spec = definition.supports[key as CanonicalParamKey]
      if (!spec && inherited) continue
      if (!spec) throw new ImageConfigError('invalid_parameter', `${mode}/${key}: parameter is not supported`)
      if (
        spec.type === 'enum' &&
        !settings.options[key as CanonicalParamKey] &&
        typeof value === 'string' &&
        !spec.options.includes(value)
      )
        spec.options.push(value)
      validateValue(key, value, spec)
      if ('default' in spec || spec.type === 'enum' || spec.type === 'range' || spec.type === 'switch')
        Object.assign(spec, { default: value })
    }
    resolveImageCanvasParams(result, mode, imageParameterDefaults(result, mode, {}))
  }
  return result
}

/** Explicit request values win over saved model defaults. Canvas axes resolve together downstream. */
export function imageParameterDefaults(
  support: ImageGenerationSupport | null | undefined,
  mode: ImageGenerationMode,
  requested: ParamValues
): ParamValues {
  const definition = support?.modes[mode]
  if (!definition) return requested
  const defaults: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(definition.supports)) {
    if (definition.canvases?.length && ['size', 'imageResolution', 'aspectRatio'].includes(key)) continue
    if ('default' in spec && spec.default !== undefined) defaults[key] = spec.default
  }
  const params = {
    ...defaults,
    ...Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== undefined))
  } as ParamValues
  for (const [key, value] of Object.entries(params)) {
    const spec = definition.supports[key as CanonicalParamKey]
    if (spec && value !== undefined) validateValue(key, value, spec)
  }
  return params
}
