import type { ImageGenerationMode, ImageGenerationSupport, SupportSpec } from '@shared/data/types/model'

import type { BaseConfigItem, OptionItem } from '../form/baseConfigItem'

/**
 * Canonical key → i18n labels. Adding a new canonical control is a one-row
 * addition here + a registry data entry on the relevant models — no schema
 * change, no per-key handler.
 */
const KEY_LABELS: Record<string, { title: string; tooltip?: string }> = {
  size: { title: 'paintings.image.size' },
  numImages: { title: 'paintings.number_images', tooltip: 'paintings.number_images_tip' },
  aspectRatio: { title: 'paintings.aspect_ratio' },
  imageResolution: { title: 'paintings.image.size' },
  customSize: { title: 'paintings.custom_size' },
  negativePrompt: { title: 'paintings.negative_prompt', tooltip: 'paintings.negative_prompt_tip' },
  seed: { title: 'paintings.seed', tooltip: 'paintings.seed_tip' },
  promptEnhancement: { title: 'paintings.prompt_enhancement', tooltip: 'paintings.prompt_enhancement_tip' },
  magicPromptOption: { title: 'paintings.magic_prompt' },
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
  resemblance: { title: 'paintings.resemblance' },
  detail: { title: 'paintings.detail' }
}

function toOptions(values: readonly string[]): OptionItem[] {
  return values.map((v) => ({ label: v, value: v }))
}

function specToField(key: string, spec: SupportSpec, allSupports: Record<string, SupportSpec>): BaseConfigItem | null {
  const labels = KEY_LABELS[key] ?? { title: key }
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
      // Mode allows arbitrary width × height via a sibling `size` spec —
      // append the `'custom'` chip so the customSize widget can gate on it.
      const pairedSize = key === 'size' && allSupports.customSize?.type === 'size'
      const options: OptionItem[] = toOptions(spec.options)
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
      return {
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
      } as unknown as BaseConfigItem
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
