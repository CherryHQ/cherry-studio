import type {
  CanonicalParamKey,
  ImageGenerationMode,
  ImageGenerationSupport,
  SupportSpec
} from '@shared/data/types/model'

import type { BaseConfigItem, OptionItem } from '../form/baseConfigItem'

/**
 * Canonical key → i18n labels. Exhaustive over `CanonicalParamKey`: every
 * canonical key MUST have a label, so adding a key to `CANONICAL_PARAM_KEY`
 * without a label here is a compile error (rather than a silent raw-key
 * render). Adding a new canonical control is a one-row addition here + a
 * registry data entry on the relevant models — no schema change, no per-key
 * handler.
 */
const KEY_LABELS: Record<CanonicalParamKey, { title: string; tooltip?: string }> = {
  size: { title: 'paintings.image.size' },
  numImages: { title: 'paintings.number_images', tooltip: 'paintings.number_images_tip' },
  aspectRatio: { title: 'paintings.aspect_ratio' },
  imageResolution: { title: 'paintings.image.size' },
  customSize: { title: 'paintings.custom_size' },
  negativePrompt: { title: 'paintings.negative_prompt', tooltip: 'paintings.negative_prompt_tip' },
  seed: { title: 'paintings.seed', tooltip: 'paintings.seed_tip' },
  promptEnhancement: { title: 'paintings.prompt_enhancement', tooltip: 'paintings.prompt_enhancement_tip' },
  promptExtend: { title: 'paintings.prompt_enhancement', tooltip: 'paintings.prompt_enhancement_tip' },
  thinkingMode: { title: 'paintings.thinking_mode', tooltip: 'paintings.thinking_mode_tip' },
  magicPromptOption: { title: 'paintings.magic_prompt_option' },
  addWatermark: { title: 'paintings.watermark' },
  outputFormat: { title: 'paintings.ppio.output_format' },
  quality: { title: 'paintings.quality' },
  moderation: { title: 'paintings.moderation' },
  background: { title: 'paintings.background' },
  styleType: { title: 'paintings.style_type', tooltip: 'paintings.style_type_tip' },
  style: { title: 'paintings.style_type', tooltip: 'paintings.style_type_tip' },
  renderingSpeed: { title: 'paintings.rendering_speed' },
  personGeneration: { title: 'paintings.person_generation', tooltip: 'paintings.person_generation_tip' },
  numInferenceSteps: { title: 'paintings.inference_steps', tooltip: 'paintings.inference_steps_tip' },
  guidanceScale: { title: 'paintings.guidance_scale', tooltip: 'paintings.guidance_scale_tip' },
  cfg: { title: 'paintings.guidance_scale', tooltip: 'paintings.guidance_scale_tip' },
  safetyTolerance: { title: 'paintings.safety_tolerance', tooltip: 'paintings.safety_tolerance_tip' },
  imageWeight: { title: 'paintings.image_weight' },
  resemblance: { title: 'paintings.upscale.resemblance' },
  detail: { title: 'paintings.upscale.detail' },
  refStrength: { title: 'paintings.dashscope.ref_strength' },
  refMode: { title: 'paintings.dashscope.ref_mode' },
  enableInterleave: {
    title: 'paintings.dashscope.enable_interleave',
    tooltip: 'paintings.dashscope.enable_interleave_tip'
  },
  sourceLang: { title: 'paintings.dashscope.source_lang' },
  targetLang: { title: 'paintings.dashscope.target_lang' },
  function: { title: 'paintings.dashscope.function' },
  strength: { title: 'paintings.dashscope.strength' },
  upscaleFactor: { title: 'paintings.dashscope.upscale_factor' },
  topScale: { title: 'paintings.dashscope.top_scale' },
  bottomScale: { title: 'paintings.dashscope.bottom_scale' },
  leftScale: { title: 'paintings.dashscope.left_scale' },
  rightScale: { title: 'paintings.dashscope.right_scale' },
  isSketch: { title: 'paintings.dashscope.is_sketch' },
  sequentialImageGeneration: { title: 'paintings.dmxapi.sequential_image_generation' },
  maxImages: { title: 'paintings.dmxapi.max_images' }
}

/**
 * Canonical key → per-option-value i18n label key. The parallel of
 * `KEY_LABELS`, but for the *options* of enum/chip controls. Values not listed
 * here fall back to the raw option value — correct for literal enums (`size`,
 * `aspectRatio`, `imageResolution`, `outputFormat`, language codes) whose
 * options are already human-readable.
 */
const OPTION_LABELS: Partial<Record<CanonicalParamKey, Record<string, string>>> = {
  quality: {
    auto: 'paintings.quality_options.auto',
    low: 'paintings.quality_options.low',
    medium: 'paintings.quality_options.medium',
    high: 'paintings.quality_options.high',
    standard: 'paintings.quality_options.standard',
    hd: 'paintings.quality_options.hd'
  },
  renderingSpeed: {
    DEFAULT: 'paintings.rendering_speeds.default',
    TURBO: 'paintings.rendering_speeds.turbo',
    QUALITY: 'paintings.rendering_speeds.quality'
  },
  personGeneration: {
    DONT_ALLOW: 'paintings.person_generation_options.allow_none',
    ALLOW_ADULT: 'paintings.person_generation_options.allow_adult',
    ALLOW_ALL: 'paintings.person_generation_options.allow_all'
  },
  background: {
    auto: 'paintings.background_options.auto',
    transparent: 'paintings.background_options.transparent',
    opaque: 'paintings.background_options.opaque'
  },
  moderation: {
    auto: 'paintings.moderation_options.auto',
    low: 'paintings.moderation_options.low'
  },
  styleType: {
    AUTO: 'paintings.style_type_options.auto',
    GENERAL: 'paintings.style_type_options.general',
    REALISTIC: 'paintings.style_type_options.realistic',
    DESIGN: 'paintings.style_type_options.design',
    RENDER_3D: 'paintings.style_type_options.render_3d',
    ANIME: 'paintings.style_type_options.anime'
  },
  sequentialImageGeneration: {
    auto: 'paintings.dmxapi.sequential_image_generation_options.auto',
    disabled: 'paintings.dmxapi.sequential_image_generation_options.disabled'
  },
  refMode: {
    repaint: 'paintings.dashscope.ref_mode_options.repaint',
    refonly: 'paintings.dashscope.ref_mode_options.refonly'
  },
  // The option *value* (e.g. `'<photography>'`, `'natural'`) is preserved and
  // sent to the request body verbatim — only the displayed label is localized.
  style: {
    vivid: 'paintings.style_options.vivid',
    natural: 'paintings.style_options.natural',
    '<auto>': 'paintings.style_options.auto',
    '<photography>': 'paintings.style_options.photography',
    '<portrait>': 'paintings.style_options.portrait',
    '<3d cartoon>': 'paintings.style_options.cartoon_3d',
    '<anime>': 'paintings.style_options.anime',
    '<oil painting>': 'paintings.style_options.oil_painting',
    '<watercolor>': 'paintings.style_options.watercolor',
    '<sketch>': 'paintings.style_options.sketch',
    '<chinese painting>': 'paintings.style_options.chinese_painting',
    '<flat illustration>': 'paintings.style_options.flat_illustration'
  },
  function: {
    stylization_all: 'paintings.dashscope.function_options.stylization_all',
    stylization_local: 'paintings.dashscope.function_options.stylization_local',
    description_edit: 'paintings.dashscope.function_options.description_edit',
    description_edit_with_mask: 'paintings.dashscope.function_options.description_edit_with_mask',
    remove_watermark: 'paintings.dashscope.function_options.remove_watermark',
    expand: 'paintings.dashscope.function_options.expand',
    super_resolution: 'paintings.dashscope.function_options.super_resolution',
    colorization: 'paintings.dashscope.function_options.colorization',
    doodle: 'paintings.dashscope.function_options.doodle',
    control_cartoon_feature: 'paintings.dashscope.function_options.control_cartoon_feature'
  }
}

function toOptions(key: string, values: readonly string[]): OptionItem[] {
  // `key` is a runtime string from the registry `supports` map; index defensively
  // (the typed maps are keyed by CanonicalParamKey, but a registry parse already
  // guarantees membership — the cast just bridges the string→literal index).
  const labelMap = (OPTION_LABELS as Record<string, Record<string, string>>)[key]
  return values.map((v) => {
    const labelKey = labelMap?.[v]
    return labelKey ? { labelKey, value: v } : { label: v, value: v }
  })
}

function specToField(key: string, spec: SupportSpec, allSupports: Record<string, SupportSpec>): BaseConfigItem | null {
  const labels = (KEY_LABELS as Record<string, { title: string; tooltip?: string }>)[key] ?? { title: key }
  switch (spec.type) {
    case 'switch':
      return { type: 'switch', key, ...labels, initialValue: spec.default ?? false }
    case 'text':
      return spec.multiline ? { type: 'textarea', key, ...labels } : { type: 'input', key, ...labels }
    case 'range': {
      const item: BaseConfigItem = {
        type: 'slider',
        key,
        ...labels,
        min: spec.min,
        max: spec.max,
        initialValue: spec.default ?? spec.min
      }
      if (spec.step !== undefined) (item as { step?: number }).step = spec.step
      return item
    }
    case 'enum': {
      const renderAsChips = spec.render === 'chips'
      // A sibling `size`-type spec lets the user pick arbitrary width × height.
      // Append the `'custom'` chip to whichever enum that widget gates on —
      // its `pairedEnumKey` (default `'size'`), the same key the size arm reads.
      const customSizeSpec = allSupports.customSize
      const customSizePairedKey = customSizeSpec?.type === 'size' ? (customSizeSpec.pairedEnumKey ?? 'size') : undefined
      const pairedSize = customSizePairedKey === key
      const options: OptionItem[] = toOptions(key, spec.options)
      if (pairedSize) options.push({ labelKey: 'paintings.custom_size', value: 'custom' })
      if (renderAsChips) {
        return {
          type: 'sizeChips',
          key,
          ...labels,
          options,
          initialValue: spec.default,
          columns: spec.columns ?? 3
        }
      }
      return { type: 'select', key, ...labels, options, initialValue: spec.default }
    }
    case 'size': {
      const pairedKey = spec.pairedEnumKey
      const item: BaseConfigItem = {
        type: 'customSize',
        key,
        widthKey: `${key}_width`,
        heightKey: `${key}_height`,
        sizeKey: pairedKey ?? 'size',
        validation: {
          minWidth: spec.minSide,
          maxWidth: spec.maxSide,
          minHeight: spec.minSide,
          maxHeight: spec.maxSide
        },
        condition: pairedKey ? (painting: Record<string, unknown>) => painting[pairedKey] === 'custom' : undefined
      }
      return item
    }
    default: {
      const _exhaustive: never = spec
      return _exhaustive
    }
  }
}

/**
 * Generic registry → form-fields dispatcher. Iterates the
 * `modes[mode].supports` map and turns each entry into the matching
 * `BaseConfigItem`. No per-vendor knowledge; no per-key handlers; no
 * hardcoded canonical-key list. Adding a new param: declare it on the
 * model in registry data with the right `SupportSpec`, optionally add an
 * i18n label entry to `KEY_LABELS` above.
 *
 * `mode` defaults to `'generate'` when the support carries that mode
 * (which it always does for image-gen-capable models in v2 data).
 */
export function imageGenerationToFields(
  support: ImageGenerationSupport | undefined,
  opts?: { mode?: ImageGenerationMode }
): BaseConfigItem[] {
  const allModes = support?.modes
  if (!allModes) return []
  const requested = opts?.mode ?? 'generate'
  // Edit-only / upscale-only / remix-only models declare a single non-generate
  // mode (e.g. PPIO `qwen-image-edit` → only `modes.edit`). When the requested
  // mode is absent from the model's declared modes, render whatever the model
  // does declare — every painting provider has at most one UI tab now, so
  // falling back to the model's first declared mode is what the user expects
  // to see.
  const fallbackKey = Object.keys(allModes)[0] as ImageGenerationMode | undefined
  const supports = allModes[requested]?.supports ?? (fallbackKey ? allModes[fallbackKey]?.supports : undefined)
  if (!supports) return []
  const items: BaseConfigItem[] = []
  for (const [key, spec] of Object.entries(supports)) {
    const item = specToField(key, spec, supports)
    if (item) items.push(item)
  }
  return items
}
