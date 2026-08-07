import { FILE_PROCESSOR_FEATURES } from '@shared/data/preference/preferenceTypes'
import { PRESETS_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import { describe, expect, it, vi } from 'vitest'

type Platform = { isLinux: boolean; isMac: boolean; isWin: boolean; isDarwinX64?: boolean }

async function importRegistryWithPlatform(platform: Platform) {
  vi.resetModules()
  vi.doMock('@main/core/platform', () => ({
    isLinux: platform.isLinux,
    isMac: platform.isMac,
    isWin: platform.isWin,
    isDarwinX64: platform.isDarwinX64 ?? false
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

    expect(processorRegistry.system.isSupported()).toBe(expected)
  })

  // isSupported must answer "could this machine ever run it", never "is the model
  // downloaded" — conflating the two is what hid local-paddleocr from the OCR
  // settings page, the only place offering the download that would unhide it.
  it.each([
    { isDarwinX64: false, expected: true },
    { isDarwinX64: true, expected: false }
  ])(
    'gates the local model processors on platform only (isDarwinX64=$isDarwinX64)',
    async ({ isDarwinX64, expected }) => {
      const processorRegistry = await importRegistryWithPlatform({
        isLinux: false,
        isMac: true,
        isWin: false,
        isDarwinX64
      })

      expect(processorRegistry['local-paddleocr'].isSupported()).toBe(expected)
      expect(processorRegistry['local-document'].isSupported()).toBe(expected)
    }
  )
})
