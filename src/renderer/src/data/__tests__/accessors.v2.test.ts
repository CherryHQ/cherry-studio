import { DataApiError, ErrorCode } from '@shared/data/api/apiErrors'
import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getEnabledProvidersAsync,
  getModelAsync,
  getModelByUniqueIdAsync,
  getProviderByIdAsync,
  getProvidersAsync
} from '../accessors.v2'

const mockProviders = [
  { id: 'openai', name: 'OpenAI', isEnabled: true },
  { id: 'anthropic', name: 'Anthropic', isEnabled: true }
]

const mockModel = {
  id: 'openai::gpt-4o',
  providerId: 'openai',
  name: 'GPT-4o',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
}

describe('accessors.v2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getProvidersAsync', () => {
    it('should call dataApiService.get with /providers', async () => {
      mockDataApiService.get.mockResolvedValueOnce(mockProviders)

      const result = await getProvidersAsync()

      expect(mockDataApiService.get).toHaveBeenCalledWith('/providers')
      expect(result).toEqual(mockProviders)
    })
  })

  describe('getEnabledProvidersAsync', () => {
    it('should call dataApiService.get with enabled query', async () => {
      mockDataApiService.get.mockResolvedValueOnce(mockProviders)

      const result = await getEnabledProvidersAsync()

      expect(mockDataApiService.get).toHaveBeenCalledWith('/providers', { query: { enabled: true } })
      expect(result).toEqual(mockProviders)
    })
  })

  describe('getProviderByIdAsync', () => {
    it('should return the provider when found', async () => {
      mockDataApiService.get.mockResolvedValueOnce(mockProviders[0])

      const result = await getProviderByIdAsync('openai')

      expect(mockDataApiService.get).toHaveBeenCalledWith('/providers/openai')
      expect(result).toEqual(mockProviders[0])
    })

    it('should return undefined on NOT_FOUND error', async () => {
      mockDataApiService.get.mockRejectedValueOnce(new DataApiError(ErrorCode.NOT_FOUND, 'Provider not found', 404))

      const result = await getProviderByIdAsync('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should rethrow non-404 errors', async () => {
      const serverError = new DataApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'Server error', 500)
      mockDataApiService.get.mockRejectedValueOnce(serverError)

      await expect(getProviderByIdAsync('openai')).rejects.toThrow(serverError)
    })

    it('should rethrow non-DataApiError errors', async () => {
      const networkError = new Error('Network error')
      mockDataApiService.get.mockRejectedValueOnce(networkError)

      await expect(getProviderByIdAsync('openai')).rejects.toThrow(networkError)
    })
  })

  describe('getModelAsync', () => {
    it('should return the model when found', async () => {
      mockDataApiService.get.mockResolvedValueOnce(mockModel)

      const result = await getModelAsync('openai', 'gpt-4o')

      expect(mockDataApiService.get).toHaveBeenCalledWith('/models/openai/gpt-4o')
      expect(result).toEqual(mockModel)
    })

    it('should return undefined on NOT_FOUND error', async () => {
      mockDataApiService.get.mockRejectedValueOnce(new DataApiError(ErrorCode.NOT_FOUND, 'Model not found', 404))

      const result = await getModelAsync('openai', 'nonexistent')
      expect(result).toBeUndefined()
    })

    it('should rethrow non-404 errors', async () => {
      const serverError = new DataApiError(ErrorCode.INTERNAL_SERVER_ERROR, 'Server error', 500)
      mockDataApiService.get.mockRejectedValueOnce(serverError)

      await expect(getModelAsync('openai', 'gpt-4o')).rejects.toThrow(serverError)
    })
  })

  describe('getModelByUniqueIdAsync', () => {
    it('should parse UniqueModelId and call getModelAsync', async () => {
      mockDataApiService.get.mockResolvedValueOnce(mockModel)

      const result = await getModelByUniqueIdAsync('openai::gpt-4o' as any)

      expect(mockDataApiService.get).toHaveBeenCalledWith('/models/openai/gpt-4o')
      expect(result).toEqual(mockModel)
    })

    it('should return undefined when model not found', async () => {
      mockDataApiService.get.mockRejectedValueOnce(new DataApiError(ErrorCode.NOT_FOUND, 'Model not found', 404))

      const result = await getModelByUniqueIdAsync('openai::nonexistent' as any)
      expect(result).toBeUndefined()
    })
  })
})
