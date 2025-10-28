import { loggerService } from '@logger'
import { ocrProviderRepository } from '@main/data/repositories/OcrProviderRepository'
import type {
  DbOcrProvider,
  ListOcrProvidersQuery,
  OcrParams,
  OcrProvider,
  OcrProviderBusiness,
  OcrProviderCreateBusiness,
  OcrProviderKeyBusiness,
  OcrProviderReplaceBusiness,
  OcrProviderUpdateBusiness,
  OcrResult,
  SupportedOcrFile
} from '@types'
import { BuiltinOcrProviderIdMap } from '@types'

import type { OcrBaseService } from './builtin/OcrBaseService'
import { ovOcrService } from './builtin/OvOcrService'
import { ppocrService } from './builtin/PpocrService'
import { systemOcrService } from './builtin/SystemOcrService'
import { tesseractService } from './builtin/TesseractService'

const logger = loggerService.withContext('OcrService')

/**
 * Business logic layer for OCR operations
 * Handles OCR provider registration, orchestration, and core OCR functionality
 */
class OcrService {
  private registry: Map<OcrProviderKeyBusiness, OcrBaseService> = new Map()
  private initialized: boolean = false

  constructor() {
    this.registerBuiltinProviders()
  }

  /**
   * Ensure the service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initializeBuiltinProviders()
      this.initialized = true
    }
  }

  /**
   * Initialize built-in OCR providers
   */
  private async initializeBuiltinProviders(): Promise<void> {
    try {
      // Ensure built-in providers exist in database
      await ocrProviderRepository.initializeBuiltInProviders()

      logger.info('OCR service initialized with built-in providers')
    } catch (error) {
      logger.error('Failed to initialize OCR service', error as Error)
      throw error
    }
  }

  /**
   * Register built-in providers (sync)
   */
  private registerBuiltinProviders(): void {
    this.register(BuiltinOcrProviderIdMap.tesseract, tesseractService)

    if (systemOcrService) {
      this.register(BuiltinOcrProviderIdMap.system, systemOcrService)
    }

    this.register(BuiltinOcrProviderIdMap.paddleocr, ppocrService)

    if (ovOcrService) {
      this.register(BuiltinOcrProviderIdMap.ovocr, ovOcrService)
    }
  }

  /**
   * Register an OCR provider service
   */
  private register(providerId: OcrProviderKeyBusiness, service: OcrBaseService): void {
    if (this.registry.has(providerId)) {
      logger.warn(`Provider ${providerId} already registered. Overwriting.`)
    }
    this.registry.set(providerId, service)
    logger.info(`Registered OCR provider: ${providerId}`)
  }

  // Not sure when it will be needed.
  /**
   * Unregister an OCR provider service
   */
  // private unregister(providerId: OcrProviderId): void {
  //   if (this.registry.delete(providerId)) {
  //     logger.info(`Unregistered OCR provider: ${providerId}`)
  //   }
  // }

  /**
   * Get all registered provider IDs
   */
  public getRegisteredProviderIds(): OcrProviderKeyBusiness[] {
    return Array.from(this.registry.keys())
  }

  /**
   * Check if a provider is registered
   */
  public isProviderRegistered(providerId: OcrProviderKeyBusiness): boolean {
    return this.registry.has(providerId)
  }

  /**
   * Get list of OCR providers
   */
  public async listProviders(query?: ListOcrProvidersQuery): Promise<OcrProviderBusiness[]> {
    try {
      await this.ensureInitialized()
      const providers = await ocrProviderRepository.findAll()

      let result = providers
      if (query?.registered) {
        // Filter by registered providers
        const registeredIds = this.getRegisteredProviderIds()
        result = providers.filter((provider) => registeredIds.includes(provider.id))
      }

      logger.debug(`Listed ${result.length} OCR providers`)
      return result
    } catch (error) {
      logger.error('Failed to list OCR providers', error as Error)
      throw error
    }
  }

  /**
   * Get OCR provider by ID
   */
  public async getProvider(providerId: OcrProviderKeyBusiness): Promise<OcrProviderBusiness> {
    try {
      await this.ensureInitialized()
      const provider = await ocrProviderRepository.findById(providerId)
      logger.debug(`Retrieved OCR provider: ${providerId}`)
      return provider
    } catch (error) {
      logger.error(`Failed to get OCR provider ${providerId}`, error as Error)
      throw error
    }
  }

  /**
   * Create new OCR provider
   */
  public async createProvider(data: OcrProviderCreateBusiness): Promise<OcrProviderBusiness> {
    try {
      await this.ensureInitialized()
      const result = await ocrProviderRepository.create(data)
      logger.info(`Created OCR provider: ${data.id}`)
      return result
    } catch (error) {
      logger.error(`Failed to create OCR provider ${data.id}`, error as Error)
      throw error
    }
  }

  /**
   * Update OCR provider (partial update)
   */
  public async updateProvider(
    id: OcrProviderKeyBusiness,
    data: OcrProviderUpdateBusiness
  ): Promise<OcrProviderBusiness> {
    try {
      await this.ensureInitialized()
      const result = await ocrProviderRepository.update(id, data)
      logger.info(`Updated OCR provider: ${id}`)
      return result
    } catch (error) {
      logger.error(`Failed to update OCR provider ${id}`, error as Error)
      throw error
    }
  }

  /**
   * Replace OCR provider (full update)
   */
  public async replaceProvider(data: OcrProviderReplaceBusiness): Promise<OcrProviderBusiness> {
    try {
      await this.ensureInitialized()
      const result = await ocrProviderRepository.replace(data)
      logger.info(`Replaced OCR provider: ${data.id}`)
      return result
    } catch (error) {
      logger.error(`Failed to replace OCR provider ${data.id}`, error as Error)
      throw error
    }
  }

  /**
   * Delete OCR provider
   */
  public async deleteProvider(id: OcrProviderKeyBusiness): Promise<void> {
    try {
      await this.ensureInitialized()
      await ocrProviderRepository.delete(id)
      logger.info(`Deleted OCR provider: ${id}`)
    } catch (error) {
      logger.error(`Failed to delete OCR provider ${id}`, error as Error)
      throw error
    }
  }

  /**
   * Perform OCR on a file using the specified provider
   */
  public async ocr(file: SupportedOcrFile, params: OcrParams): Promise<OcrResult> {
    try {
      await this.ensureInitialized()
      const service = this.registry.get(params.providerId)
      if (!service) {
        throw new Error(`Provider ${params.providerId} is not registered`)
      }

      // Validate that the provider exists in database
      const provider = await this.getProvider(params.providerId)

      logger.debug(`Performing OCR with provider: ${JSON.stringify(provider, undefined, 2)}`)
      const result = await service.ocr(file, provider.config)

      logger.info(`OCR completed successfully with provider: ${params.providerId}`)
      return result
    } catch (error) {
      logger.error(`OCR failed with provider ${params.providerId}`, error as Error)
      throw error
    }
  }

  /**
   * Check if a provider is available and ready
   */
  public async isProviderAvailable(providerId: OcrProviderKeyBusiness): Promise<boolean> {
    try {
      const service = this.registry.get(providerId)
      if (!service) {
        return false
      }

      // Check if provider exists in database
      await this.getProvider(providerId)

      // Additional availability checks can be added here
      return true
    } catch (error) {
      logger.debug(`Provider ${providerId} is not available`, error as Error)
      return false
    }
  }

  private async _isProviderAvailable(provider: OcrProvider): Promise<boolean> {
    try {
      return this.registry.get(provider.id) !== undefined
    } catch (error) {
      logger.debug(`Provider ${provider.id} is not available`, error as Error)
      return false
    }
  }

  /**
   * Get available providers
   * It's only for image type. May re-designed for a specific file type in the future.
   *
   */
  public async getAvailableProvidersForFile(): Promise<DbOcrProvider[]> {
    try {
      const providers = await this.listProviders()

      // Filter providers that can handle the file type
      // This logic can be extended based on file type and provider capabilities
      const availableProviders: DbOcrProvider[] = []
      const capFilter = (provider: OcrProvider) => provider.capabilities.image

      for (const provider of providers.filter(capFilter)) {
        if (await this._isProviderAvailable(provider)) {
          availableProviders.push(provider)
        }
      }

      logger.debug(`Found ${availableProviders.length} available providers for file`)
      return availableProviders
    } catch (error) {
      logger.error('Failed to get available providers for file', error as Error)
      throw error
    }
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.registry.clear()
    logger.info('OCR service disposed')
  }
}

export const ocrService = new OcrService()
