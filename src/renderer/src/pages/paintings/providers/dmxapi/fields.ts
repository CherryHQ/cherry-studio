import { generationModeType } from '../../model/types/paintingData'

/**
 * Vendor-specific extras for dmxapi's painting form. `size` and `customSize`
 * are derived from the registry's `imageGeneration` block (per-model);
 * these two rows are dmxapi's bespoke UI knobs that don't fit the canonical
 * schema (`autoCreate` is a vendor product flag, `seed` is conditional on
 * the generation mode).
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
      type: 'switch',
      key: 'autoCreate',
      title: 'paintings.auto_create_paint',
      tooltip: 'paintings.auto_create_paint_tip'
    }
  ]
}
