import { generationModeType } from '../../model/types/paintingData'
import { STYLE_TYPE_OPTIONS } from './config'

/**
 * Vendor-specific extras for dmxapi's painting form. `size` and `customSize`
 * are derived from the registry's `imageGeneration` block (per-model);
 * these three rows are dmxapi's bespoke UI knobs that don't fit the
 * canonical schema (`style_type` is dmxapi's 27-Chinese-style enum,
 * `autoCreate` is a vendor product flag, `seed` is conditional on the
 * generation mode).
 */
export function buildDmxapiConfigFields(): any[] {
  return [
    {
      type: 'input',
      key: 'seed',
      title: 'paintings.seed',
      tooltip: 'paintings.seed_desc_tip',
      condition: (painting: Record<string, unknown>) => {
        return painting.generationMode === generationModeType.GENERATION
      }
    },
    {
      type: 'styleToggle',
      key: 'style_type',
      title: 'paintings.style_type',
      toggleMode: 'single' as const,
      options: STYLE_TYPE_OPTIONS.map((style) => ({
        labelKey: style.labelKey,
        value: style.value
      }))
    },
    {
      type: 'switch',
      key: 'autoCreate',
      title: 'paintings.auto_create_paint',
      tooltip: 'paintings.auto_create_paint_tip'
    }
  ]
}
