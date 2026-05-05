import { FILE_PROCESSOR_FEATURES } from '@shared/data/preference/preferenceTypes'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import { describe, expect, it } from 'vitest'

import { processorRegistry } from '../registry'

describe('processorRegistry', () => {
  it('has one handler for every preset capability', () => {
    for (const preset of PRESETS_FILE_PROCESSORS) {
      const registryEntry = processorRegistry[preset.id]

      expect(registryEntry, `${preset.id} registry entry`).toBeDefined()

      for (const capability of preset.capabilities) {
        expect(
          registryEntry.capabilities[capability.feature],
          `${preset.id}.${capability.feature} registry handler`
        ).toBeDefined()
      }
    }
  })

  it('does not register handlers for unsupported preset capabilities', () => {
    for (const preset of PRESETS_FILE_PROCESSORS) {
      const supportedFeatures = new Set(preset.capabilities.map((capability) => capability.feature))
      const registeredFeatures = Object.keys(processorRegistry[preset.id].capabilities)

      expect(registeredFeatures.every((feature) => FILE_PROCESSOR_FEATURES.includes(feature as never))).toBe(true)

      for (const feature of registeredFeatures) {
        expect(supportedFeatures.has(feature as never), `${preset.id}.${feature} unsupported handler`).toBe(true)
      }
    }
  })
})
