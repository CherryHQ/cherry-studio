import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigurationService } from '../config/ConfigurationService'

describe('ConfigurationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    ConfigurationService._resetForTesting()
  })

  describe('getInstance', () => {
    it('should return the same instance', () => {
      const instance1 = ConfigurationService.getInstance()
      const instance2 = ConfigurationService.getInstance()
      expect(instance1).toBe(instance2)
    })

    it('should return a new instance after reset', () => {
      const instance1 = ConfigurationService.getInstance()
      ConfigurationService._resetForTesting()
      const instance2 = ConfigurationService.getInstance()
      expect(instance1).not.toBe(instance2)
    })
  })

  describe('getTemplate', () => {
    it('should return template for known processor', () => {
      const service = ConfigurationService.getInstance()

      const template = service.getTemplate('tesseract')

      expect(template).toBeDefined()
      expect(template?.id).toBe('tesseract')
      expect(template?.type).toBe('builtin')
    })

    it('should return undefined for unknown processor', () => {
      const service = ConfigurationService.getInstance()

      const template = service.getTemplate('unknown-processor')

      expect(template).toBeUndefined()
    })
  })

  describe('getAllTemplates', () => {
    it('should return all processor templates', () => {
      const service = ConfigurationService.getInstance()

      const templates = service.getAllTemplates()

      expect(templates.length).toBeGreaterThan(0)
      expect(templates.some((t) => t.id === 'tesseract')).toBe(true)
      expect(templates.some((t) => t.id === 'mineru')).toBe(true)
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

    it('should merge API key from override', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
        mineru: {
          apiKey: 'test-api-key'
        }
      })

      const config = service.getConfiguration('mineru')

      expect(config).toBeDefined()
      expect(config?.apiKey).toBe('test-api-key')
    })

    it('should return undefined for unknown processor', () => {
      const service = ConfigurationService.getInstance()

      const config = service.getConfiguration('unknown-processor')

      expect(config).toBeUndefined()
    })
  })

  describe('getAllConfigurations', () => {
    it('should return merged configurations for all processors', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.overrides', {
        tesseract: { options: { langs: ['eng'] } }
      })

      const configs = service.getAllConfigurations()

      expect(configs.length).toBeGreaterThan(0)
      const tesseractConfig = configs.find((c) => c.id === 'tesseract')
      expect(tesseractConfig?.options).toEqual({ langs: ['eng'] })
    })
  })

  describe('getDefaultProcessor', () => {
    it('should return default image processor', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_image_processor', 'tesseract')

      const result = service.getDefaultProcessor('image')

      expect(result).toBe('tesseract')
    })

    it('should return default document processor', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_document_processor', 'mineru')

      const result = service.getDefaultProcessor('document')

      expect(result).toBe('mineru')
    })

    it('should return null when no default is set', () => {
      const service = ConfigurationService.getInstance()
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.file_processing.default_image_processor', null)

      const result = service.getDefaultProcessor('image')

      expect(result).toBeNull()
    })
  })

  describe('onConfigurationChange', () => {
    it('should subscribe to preference changes', () => {
      const service = ConfigurationService.getInstance()
      const callback = vi.fn()

      const unsubscribe = service.onConfigurationChange(callback)

      expect(typeof unsubscribe).toBe('function')
    })
  })
})
