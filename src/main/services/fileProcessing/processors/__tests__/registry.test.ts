import { FILE_PROCESSOR_FEATURES } from '@shared/data/preference/preferenceTypes'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/file-processing'
import { describe, expect, it, vi } from 'vitest'

async function importRegistryWithPlatform(platform: { isLinux: boolean; isMac: boolean; isWin: boolean }) {
  vi.resetModules()
  vi.doMock('@main/constant', () => ({
    isLinux: platform.isLinux,
    isMac: platform.isMac,
    isWin: platform.isWin
  }))

  const { processorRegistry } = await import('../registry')
  return processorRegistry
}

describe('processorRegistry', () => {
  it('has one handler for every preset capability', async () => {
    const processorRegistry = await importRegistryWithPlatform({ isLinux: false, isMac: true, isWin: false })

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

  it('does not register handlers for unsupported preset capabilities', async () => {
    const processorRegistry = await importRegistryWithPlatform({ isLinux: false, isMac: true, isWin: false })

    for (const preset of PRESETS_FILE_PROCESSORS) {
      const supportedFeatures = new Set(preset.capabilities.map((capability) => capability.feature))
      const registeredFeatures = Object.keys(processorRegistry[preset.id].capabilities)

      expect(registeredFeatures.every((feature) => FILE_PROCESSOR_FEATURES.includes(feature as never))).toBe(true)

      for (const feature of registeredFeatures) {
        expect(supportedFeatures.has(feature as never), `${preset.id}.${feature} unsupported handler`).toBe(true)
      }
    }
  })

  it.each([
    { isLinux: false, isMac: true, isWin: false, expected: true },
    { isLinux: false, isMac: false, isWin: true, expected: true },
    { isLinux: true, isMac: false, isWin: false, expected: false }
  ])('marks System OCR availability from main platform constants %#', async ({ isLinux, isMac, isWin, expected }) => {
    const processorRegistry = await importRegistryWithPlatform({ isLinux, isMac, isWin })
    const availability = processorRegistry.system.isAvailable

    expect(typeof availability).toBe('function')
    expect(typeof availability === 'function' ? availability() : availability).toBe(expected)
  })
})
