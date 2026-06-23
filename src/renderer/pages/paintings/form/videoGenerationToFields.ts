import type {
  CanonicalVideoParamKey,
  SupportSpec,
  VideoGenerationMode,
  VideoGenerationSupport
} from '@shared/data/types/model'

import type { BaseConfigItem, OptionItem } from './baseConfigItem'

/**
 * Video counterpart of `imageGenerationToFields` — the data-driven mapper that turns a
 * model's `videoGeneration.modes[mode].supports` block (from the video-generation-support
 * DataApi route) into renderer `BaseConfigItem[]`, reusing the same field renderer as the
 * image form. Media inputs (first/last frame, reference images, …) are NOT mapped here —
 * those are rendered by the video prompt bar from the mode's `mediaInputs`; this maps only
 * the scalar `supports`.
 *
 * i18n keys live under the current `paintings.*` namespace (renamed to `creation.*` wholesale
 * in the Creation-page rename slice). Exhaustive over `CanonicalVideoParamKey`: adding a key to
 * `CANONICAL_VIDEO_PARAM_KEY` without a label here is a compile error.
 */
const KEY_LABELS: Record<CanonicalVideoParamKey, { title: string; tooltip?: string }> = {
  aspectRatio: { title: 'paintings.aspect_ratio' },
  resolution: { title: 'paintings.video.resolution' },
  size: { title: 'paintings.video.size' },
  duration: { title: 'paintings.video.duration', tooltip: 'paintings.video.duration_tip' },
  fps: { title: 'paintings.video.fps' },
  seed: { title: 'paintings.seed', tooltip: 'paintings.seed_tip' },
  negativePrompt: { title: 'paintings.negative_prompt', tooltip: 'paintings.negative_prompt_tip' },
  cfg: { title: 'paintings.guidance_scale', tooltip: 'paintings.guidance_scale_tip' },
  watermark: { title: 'paintings.watermark' },
  generateAudio: { title: 'paintings.video.generate_audio', tooltip: 'paintings.video.generate_audio_tip' },
  sound: { title: 'paintings.video.generate_audio' },
  cameraFixed: { title: 'paintings.video.camera_fixed', tooltip: 'paintings.video.camera_fixed_tip' },
  movementAmplitude: { title: 'paintings.video.movement_amplitude' },
  mode: { title: 'paintings.video.mode' },
  shotType: { title: 'paintings.video.shot_type' },
  promptExtend: { title: 'paintings.prompt_enhancement', tooltip: 'paintings.prompt_enhancement_tip' },
  promptOptimizer: { title: 'paintings.prompt_enhancement', tooltip: 'paintings.prompt_enhancement_tip' }
}

/**
 * Canonical key → per-option-value i18n label key. Most video enums (resolution `720p`,
 * aspectRatio `16:9`, duration `5`, size `1280*720`) are already human-readable, so only the
 * few non-obvious vocabularies are mapped; everything else falls back to the raw value.
 */
const OPTION_LABELS: Partial<Record<CanonicalVideoParamKey, Record<string, string>>> = {
  movementAmplitude: {
    auto: 'paintings.video.movement_amplitude_options.auto',
    small: 'paintings.video.movement_amplitude_options.small',
    medium: 'paintings.video.movement_amplitude_options.medium',
    large: 'paintings.video.movement_amplitude_options.large'
  },
  shotType: {
    single: 'paintings.video.shot_type_options.single',
    multi: 'paintings.video.shot_type_options.multi'
  }
}

function toOptions(key: string, values: readonly string[]): OptionItem[] {
  const labelMap = (OPTION_LABELS as Record<string, Record<string, string>>)[key]
  return values.map((v) => {
    const labelKey = labelMap?.[v]
    return labelKey ? { labelKey, value: v } : { label: v, value: v }
  })
}

/** Turn one registry `SupportSpec` into a `BaseConfigItem`. Video has no custom-size widget, so the enum arm is plain. */
function specToField(key: string, spec: SupportSpec): BaseConfigItem | null {
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
    case 'enum':
      return { type: 'select', key, ...labels, options: toOptions(key, spec.options), initialValue: spec.default }
    case 'size':
      // No video model declares a free width×height `size`-type spec (Wan's `size` is an enum),
      // so this arm is unreachable in practice; ignore rather than render an image-only widget.
      return null
    default: {
      const _exhaustive: never = spec
      return _exhaustive
    }
  }
}

/**
 * Generic registry → form-fields dispatcher for video. Iterates the requested mode's `supports`
 * (falling back to the model's first declared mode when the requested one is absent) and maps
 * each entry to a `BaseConfigItem`. No per-vendor logic; adding a param = declare it on the model
 * in registry data + (optionally) a label above.
 */
export function videoGenerationToFields(
  support: VideoGenerationSupport | undefined,
  opts?: { mode?: VideoGenerationMode }
): BaseConfigItem[] {
  const allModes = support?.modes
  if (!allModes) return []
  const requested = opts?.mode ?? 't2v'
  const fallbackKey = Object.keys(allModes)[0] as VideoGenerationMode | undefined
  const supports = allModes[requested]?.supports ?? (fallbackKey ? allModes[fallbackKey]?.supports : undefined)
  if (!supports) return []
  const items: BaseConfigItem[] = []
  for (const [key, spec] of Object.entries(supports)) {
    const item = specToField(key, spec)
    if (item) items.push(item)
  }
  return items
}
