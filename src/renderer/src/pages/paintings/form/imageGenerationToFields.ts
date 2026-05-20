import type { ImageGenerationSupport } from '@shared/data/types/model'

import type { BaseConfigItem, OptionItem } from '../providers/shared/providerFieldSchema'

/**
 * Map an `ImageGenerationSupport` descriptor (from the provider registry, per
 * model) to the existing `BaseConfigItem[]` shape that
 * `PaintingFieldRenderer` already knows how to render. Keeps the renderer
 * pipeline unchanged — only the field-list source switches from a hand-rolled
 * per-provider `fields.ts` to this derivation.
 *
 * Field keys are canonical (`size`, `numImages`, `negativePrompt`, `seed`,
 * `numInferenceSteps`, `guidanceScale`, `safetyTolerance`, `quality`,
 * `moderation`, `background`, `aspectRatio`, `styleType`, `renderingSpeed`,
 * `personGeneration`, `promptEnhancement`, `magicPromptOption`). Providers
 * whose persisted `PaintingData` uses different field names can pass
 * `opts.keyMap` to alias a canonical key to a legacy name without renaming
 * stored data (e.g. silicon: `{ size: 'imageSize', numInferenceSteps: 'steps' }`).
 * `modes` is ignored here — modes drive provider-level tabs today, not
 * field-level controls (revisit in A.6).
 */
export function imageGenerationToFields(
  support: ImageGenerationSupport | undefined,
  opts?: { keyMap?: Record<string, string> }
): BaseConfigItem[] {
  if (!support) return []
  const items: BaseConfigItem[] = []
  const remap = (key: string) => opts?.keyMap?.[key] ?? key

  // size
  if (support.sizes && support.sizes.length > 0) {
    const options: OptionItem[] = support.sizes.map((v) => ({ label: v, value: v }))
    if (support.sizeMode === 'pixel') {
      items.push({
        type: 'sizeChips',
        key: remap('size'),
        title: 'paintings.image.size',
        options,
        initialValue: support.defaultSize,
        columns: 3
      })
    } else {
      items.push({
        type: 'select',
        key: remap('size'),
        title: 'paintings.image.size',
        options,
        initialValue: support.defaultSize
      })
    }
  }

  // batch (numImages)
  if (support.batch && (support.batch.min !== undefined || support.batch.max !== undefined)) {
    items.push({
      type: 'slider',
      key: remap('numImages'),
      title: 'paintings.number_images',
      tooltip: 'paintings.number_images_tip',
      min: support.batch.min ?? 1,
      max: support.batch.max ?? 1,
      initialValue: support.batch.default ?? support.batch.min ?? 1
    })
  }

  const s = support.supports
  if (!s) return items

  if (s.negativePrompt) {
    items.push({
      type: 'textarea',
      key: remap('negativePrompt'),
      title: 'paintings.negative_prompt',
      tooltip: 'paintings.negative_prompt_tip'
    })
  }
  if (s.seed) {
    items.push({ type: 'input', key: remap('seed'), title: 'paintings.seed', tooltip: 'paintings.seed_tip' })
  }
  if (s.promptEnhancement) {
    items.push({
      type: 'switch',
      key: remap('promptEnhancement'),
      title: 'paintings.prompt_enhancement',
      tooltip: 'paintings.prompt_enhancement_tip',
      initialValue: false
    })
  }
  if (s.magicPromptOption) {
    items.push({
      type: 'switch',
      key: remap('magicPromptOption'),
      title: 'paintings.magic_prompt',
      initialValue: false
    })
  }
  if (s.numInferenceSteps) {
    items.push({
      type: 'slider',
      key: remap('numInferenceSteps'),
      title: 'paintings.inference_steps',
      tooltip: 'paintings.inference_steps_tip',
      min: s.numInferenceSteps.min ?? 1,
      max: s.numInferenceSteps.max ?? 50,
      initialValue: s.numInferenceSteps.default ?? 25
    })
  }
  if (s.guidanceScale) {
    items.push({
      type: 'slider',
      key: remap('guidanceScale'),
      title: 'paintings.guidance_scale',
      tooltip: 'paintings.guidance_scale_tip',
      min: s.guidanceScale.min ?? 0,
      max: s.guidanceScale.max ?? 20,
      step: 0.1,
      initialValue: s.guidanceScale.default ?? 4.5
    })
  }
  if (s.safetyTolerance) {
    items.push({
      type: 'slider',
      key: remap('safetyTolerance'),
      title: 'paintings.safety_tolerance',
      min: s.safetyTolerance.min ?? 0,
      max: s.safetyTolerance.max ?? 6,
      initialValue: s.safetyTolerance.default ?? s.safetyTolerance.max ?? 6
    })
  }
  if (s.quality) {
    items.push({
      type: 'select',
      key: remap('quality'),
      title: 'paintings.quality',
      options: s.quality.map((v) => ({ label: v, value: v }))
    })
  }
  if (s.moderation) {
    items.push({
      type: 'select',
      key: remap('moderation'),
      title: 'paintings.moderation',
      options: s.moderation.map((v) => ({ label: v, value: v }))
    })
  }
  if (s.background) {
    items.push({
      type: 'select',
      key: remap('background'),
      title: 'paintings.background',
      options: s.background.map((v) => ({ label: v, value: v }))
    })
  }
  if (s.aspectRatio) {
    items.push({
      type: 'select',
      key: remap('aspectRatio'),
      title: 'paintings.aspect_ratio',
      options: s.aspectRatio.map((v) => ({ label: v, value: v }))
    })
  }
  if (s.styleType) {
    items.push({
      type: 'select',
      key: remap('styleType'),
      title: 'paintings.style_type',
      options: s.styleType.map((v) => ({ label: v, value: v }))
    })
  }
  if (s.renderingSpeed) {
    items.push({
      type: 'select',
      key: remap('renderingSpeed'),
      title: 'paintings.rendering_speed',
      options: s.renderingSpeed.map((v) => ({ label: v, value: v }))
    })
  }
  if (s.personGeneration) {
    items.push({
      type: 'select',
      key: remap('personGeneration'),
      title: 'paintings.person_generation',
      options: s.personGeneration.map((v) => ({ label: v, value: v }))
    })
  }

  return items
}
