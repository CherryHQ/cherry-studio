/**
 * Configuration Loader
 * Responsible for loading and parsing JSON configuration files
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type * as z from 'zod'

import { ModelListSchema, OverrideListSchema, ProviderListSchema } from '../schemas'
import { safeParseJSON } from '../utils/parse-json/parse-json'
import { zod4Schema } from '../utils/schema'

export type ModelConfig = z.infer<typeof ModelListSchema>['models'][0]
export type ProviderConfig = z.infer<typeof ProviderListSchema>['providers'][0]
export type ProviderModelOverride = z.infer<typeof OverrideListSchema>['overrides'][0]

export interface ConfigLoadOptions {
  basePath?: string
  validateOnLoad?: boolean
  cacheEnabled?: boolean
}

export class ConfigLoader {
  private cache = new Map<string, any>()
  private options: ConfigLoadOptions

  constructor(options: ConfigLoadOptions = {}) {
    this.options = {
      basePath: path.join(__dirname, '../data'),
      validateOnLoad: true,
      cacheEnabled: true,
      ...options
    }
  }

  /**
   * Load model configurations from JSON file
   */
  async loadModels(filename = 'models.json'): Promise<ModelConfig[]> {
    const filePath = path.join(this.options.basePath!, filename)

    if (this.options.cacheEnabled && this.cache.has(filePath)) {
      return this.cache.get(filePath)
    }

    try {
      const rawData = await fs.readFile(filePath, 'utf-8')

      let validatedData: any
      if (this.options.validateOnLoad) {
        const schema = zod4Schema(ModelListSchema)
        const parseResult = await safeParseJSON({ text: rawData, schema })

        if (!parseResult.success) {
          throw new Error(`Validation failed: ${parseResult.error.message}`)
        }
        validatedData = parseResult.value
      } else {
        const parseResult = await safeParseJSON({ text: rawData })

        if (!parseResult.success) {
          throw new Error(`Parse failed: ${parseResult.error.message}`)
        }
        validatedData = parseResult.value
      }

      const models = validatedData.models
      const version = validatedData.version

      if (this.options.cacheEnabled) {
        this.cache.set(filePath, { models, version })
      }

      return models
    } catch (error) {
      throw new Error(
        `Failed to load models from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Load provider configurations from JSON file
   */
  async loadProviders(filename = 'providers.json'): Promise<ProviderConfig[]> {
    const filePath = path.join(this.options.basePath!, filename)

    if (this.options.cacheEnabled && this.cache.has(filePath)) {
      return this.cache.get(filePath)
    }

    try {
      const rawData = await fs.readFile(filePath, 'utf-8')
      let validatedData: any
      if (this.options.validateOnLoad) {
        const schema = zod4Schema(ProviderListSchema)
        const parseResult = await safeParseJSON({ text: rawData, schema })

        if (!parseResult.success) {
          throw new Error(`Validation failed: ${parseResult.error.message}`)
        }
        validatedData = parseResult.value
      } else {
        const parseResult = await safeParseJSON({ text: rawData })

        if (!parseResult.success) {
          throw new Error(`Parse failed: ${parseResult.error.message}`)
        }
        validatedData = parseResult.value
      }

      const providers = validatedData.providers
      const version = validatedData.version

      if (this.options.cacheEnabled) {
        this.cache.set(filePath, { providers, version })
      }

      return providers
    } catch (error) {
      throw new Error(
        `Failed to load providers from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Load override configurations from JSON file
   */
  async loadOverrides(filename = 'overrides.json'): Promise<ProviderModelOverride[]> {
    const filePath = path.join(this.options.basePath!, filename)

    if (this.options.cacheEnabled && this.cache.has(filePath)) {
      return this.cache.get(filePath)
    }

    try {
      const rawData = await fs.readFile(filePath, 'utf-8')
      let validatedData: any
      if (this.options.validateOnLoad) {
        const schema = zod4Schema(OverrideListSchema)
        const parseResult = await safeParseJSON({ text: rawData, schema })

        if (!parseResult.success) {
          throw new Error(`Validation failed: ${parseResult.error.message}`)
        }
        validatedData = parseResult.value
      } else {
        const parseResult = await safeParseJSON({ text: rawData })

        if (!parseResult.success) {
          throw new Error(`Parse failed: ${parseResult.error.message}`)
        }
        validatedData = parseResult.value
      }

      const overrides = validatedData.overrides
      const version = validatedData.version

      if (this.options.cacheEnabled) {
        this.cache.set(filePath, { overrides, version })
      }

      return overrides
    } catch (error) {
      throw new Error(
        `Failed to load overrides from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Load all configuration files
   */
  async loadAllConfigs(options: { modelsFile?: string; providersFile?: string; overridesFile?: string } = {}): Promise<{
    models: ModelConfig[]
    providers: ProviderConfig[]
    overrides: ProviderModelOverride[]
  }> {
    const [models, providers, overrides] = await Promise.all([
      this.loadModels(options.modelsFile),
      this.loadProviders(options.providersFile),
      this.loadOverrides(options.overridesFile)
    ])

    return { models, providers, overrides }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get configuration file version
   */
  async getConfigVersion(filename: string): Promise<string | null> {
    const filePath = path.join(this.options.basePath!, filename)

    if (!(await this.fileExists(filePath))) {
      return null
    }

    try {
      const rawData = await fs.readFile(filePath, 'utf-8')
      const jsonData = JSON.parse(rawData)
      return jsonData.version || null
    } catch {
      return null
    }
  }

  /**
   * Get all configuration versions
   */
  async getAllConfigVersions(): Promise<{
    models: string | null
    providers: string | null
    overrides: string | null
  }> {
    const [models, providers, overrides] = await Promise.all([
      this.getConfigVersion('models.json'),
      this.getConfigVersion('providers.json'),
      this.getConfigVersion('overrides.json')
    ])

    return { models, providers, overrides }
  }
}
