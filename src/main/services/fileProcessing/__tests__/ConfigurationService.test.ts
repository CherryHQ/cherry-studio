import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigurationService } from '../config/ConfigurationService'

describe('ConfigurationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    // @ts-expect-error - Reset singleton for testing
    ConfigurationService.instance = null
  })

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = ConfigurationService.getInstance()
      const instance2 = ConfigurationService.getInstance()
      expect(instance1).toBe(instance2)
    })

    it('should return a new instance after reset', () => {
      const instance1 = ConfigurationService.getInstance()
      // @ts-expect-error - Reset singleton for testing
      ConfigurationService.instance = null
      const instance2 = ConfigurationService.getInstance()
      expect(instance1).not.toBe(instance2)
    })
  })

  describe('getConfiguration', () => {
    it('should return template when no override exists', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const config = service.getConfiguration('tesseract')

      expect(config).toBeDefined()
      expect(config?.id).toBe('tesseract')
      expect(config?.type).toBe('builtin')
    })

    it('should merge template with user override', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
        tesseract: {
          options: { langs: ['chi_sim', 'eng'] }
        }
      })

      const config = service.getConfiguration('tesseract')

      expect(config).toBeDefined()
      expect(config?.id).toBe('tesseract')
      expect(config?.options).toEqual({ langs: ['chi_sim', 'eng'] })
    })

    it('should merge API keys from override', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
        mineru: {
          apiKeys: ['test-api-key']
        }
      })

      const config = service.getConfiguration('mineru')

      expect(config).toBeDefined()
      expect(config?.apiKeys).toEqual(['test-api-key'])
    })

    it('should return undefined for unknown processor', () => {
      const service = ConfigurationService.getInstance()

      const config = service.getConfiguration('unknown-processor')

      expect(config).toBeUndefined()
    })
  })

  describe('getDefaultProcessor', () => {
    it('should return default text_extraction processor', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        'tesseract'
      )

      const result = service.getDefaultProcessor('text_extraction')

      expect(result).toBe('tesseract')
    })

    it('should return default markdown_conversion processor', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_markdown_conversion_processor',
        'mineru'
      )

      const result = service.getDefaultProcessor('markdown_conversion')

      expect(result).toBe('mineru')
    })

    it('should return null when no default is set', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue(
        'feature.file_processing.default_text_extraction_processor',
        null
      )

      const result = service.getDefaultProcessor('text_extraction')

      expect(result).toBeNull()
    })
  })

  describe('updateConfiguration', () => {
    it('should update apiKeys', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const result = service.updateConfiguration('mineru', { apiKeys: ['test-key'] })

      expect(result).toBeDefined()
      expect(result?.apiKeys).toEqual(['test-key'])
    })

    it('should update capabilities', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const result = service.updateConfiguration('mineru', {
        capabilities: { markdown_conversion: { apiHost: 'https://custom.host' } }
      })

      expect(result).toBeDefined()
      const cap = result?.capabilities.find((c) => c.feature === 'markdown_conversion')
      expect(cap?.apiHost).toBe('https://custom.host')
    })

    it('should merge apiKeys and capabilities across multiple updates', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      // First update: set apiKeys
      service.updateConfiguration('mineru', { apiKeys: ['first-key'] })

      // Second update: set apiHost (should preserve apiKeys)
      const result = service.updateConfiguration('mineru', {
        capabilities: { markdown_conversion: { apiHost: 'https://custom.host' } }
      })

      expect(result).toBeDefined()
      expect(result?.apiKeys).toEqual(['first-key'])
      const cap = result?.capabilities.find((c) => c.feature === 'markdown_conversion')
      expect(cap?.apiHost).toBe('https://custom.host')
    })

    it('should merge multiple capabilities across updates', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      // First update: set apiHost
      service.updateConfiguration('mineru', {
        capabilities: { markdown_conversion: { apiHost: 'https://custom.host' } }
      })

      // Second update: set modelId (should preserve apiHost)
      const result = service.updateConfiguration('mineru', {
        capabilities: { markdown_conversion: { modelId: 'custom-model' } }
      })

      expect(result).toBeDefined()
      const cap = result?.capabilities.find((c) => c.feature === 'markdown_conversion')
      expect(cap?.apiHost).toBe('https://custom.host')
      expect(cap?.modelId).toBe('custom-model')
    })

    it('should return undefined for unknown processor', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {})

      const result = service.updateConfiguration('unknown-processor', { apiKeys: ['test'] })

      expect(result).toBeUndefined()
    })
  })
})
