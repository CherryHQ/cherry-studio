// Aihubmix's per-tab model whitelist — the static set of model ids the
// aihubmix transport knows how to route. Intersected with the user's
// enabled aihubmix image-gen models to populate the painting page model
// dropdown (vendor knowledge + user choice; see index.tsx).
//
// Pure transport routing data — NOT user-facing field metadata (that's
// driven by the registry's per-model `imageGeneration` block).

type AihubmixTab = 'generate' | 'remix' | 'upscale'

interface ModelOption {
  label: string
  value: string
  group?: string
}

const GENERATE_MODELS: ModelOption[] = [
  { label: 'gpt-image-2', value: 'gpt-image-2', group: 'OpenAI' },
  { label: 'gpt-image-1', value: 'gpt-image-1', group: 'OpenAI' },
  { label: 'Nano Banana Pro', value: 'gemini-3-pro-image-preview', group: 'Gemini' },
  { label: 'imagen-4.0-preview', value: 'imagen-4.0-generate-preview-06-06', group: 'Gemini' },
  { label: 'imagen-4.0-ultra', value: 'imagen-4.0-ultra-generate-preview-06-06', group: 'Gemini' },
  { label: 'ideogram_V_3', value: 'V_3', group: 'ideogram' },
  { label: 'ideogram_V_2', value: 'V_2', group: 'ideogram' },
  { label: 'ideogram_V_2_TURBO', value: 'V_2_TURBO', group: 'ideogram' },
  { label: 'ideogram_V_2A', value: 'V_2A', group: 'ideogram' },
  { label: 'ideogram_V_2A_TURBO', value: 'V_2A_TURBO', group: 'ideogram' },
  { label: 'ideogram_V_1', value: 'V_1', group: 'ideogram' },
  { label: 'ideogram_V_1_TURBO', value: 'V_1_TURBO', group: 'ideogram' },
  { label: 'FLUX.1-Kontext-pro', value: 'FLUX.1-Kontext-pro', group: 'Flux' }
]

const IDEOGRAM_MODELS: ModelOption[] = GENERATE_MODELS.filter((m) => m.group === 'ideogram').map((m) => ({
  label: m.label,
  value: m.value
}))

export function getStaticModelsForAihubmixMode(tab: AihubmixTab): ModelOption[] {
  switch (tab) {
    case 'generate':
      return GENERATE_MODELS
    case 'remix':
    case 'upscale':
      return IDEOGRAM_MODELS
  }
}
