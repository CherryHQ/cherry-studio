/**
 * Schema Validator
 * Provides validation functionality for all configuration schemas
 */

import * as z from 'zod'

import { ModelConfigSchema, OverrideListSchema, ProviderConfigSchema } from '../schemas'
import { zod4Schema } from '../utils/schema'
import { safeValidateTypes } from '../utils/validate-type'

export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type OverrideConfig = z.infer<typeof OverrideListSchema>

export interface ValidationResult<T = any> {
  success: boolean
  data?: T
  errors?: z.ZodIssue['path'] extends (string | number)[] ? z.ZodIssue : z.ZodIssue[]
  warnings?: string[]
}

export interface ValidationOptions {
  strict?: boolean
  includeWarnings?: boolean
  customValidation?: (data: any) => string[]
}

export class SchemaValidator {
  /**
   * Validate model configuration
   */
  async validateModel(config: any, options: ValidationOptions = {}): Promise<ValidationResult<ModelConfig>> {
    const { includeWarnings = true, customValidation } = options

    const schema = zod4Schema(ModelConfigSchema)

    const validation = await safeValidateTypes({ value: config, schema })

    if (!validation.success) {
      return {
        success: false,
        errors: [{ code: 'custom' as const, message: validation.error.message, path: [] }]
      }
    }

    const model = validation.value

    const warnings: string[] = []

    // Basic warnings
    if (includeWarnings) {
      if (!model.pricing) {
        warnings.push('No pricing information provided')
      }

      if (!model.description) {
        warnings.push('No model description provided')
      }

      if (model.capabilities?.includes('REASONING') && !model.reasoning) {
        warnings.push('Model has REASONING capability but no reasoning configuration')
      }

      if (model.contextWindow && model.contextWindow > 128000) {
        warnings.push('Large context window may impact performance')
      }

      if (model.capabilities?.length === 0) {
        warnings.push('No capabilities specified for model')
      }
    }

    // Custom validation warnings
    if (includeWarnings && customValidation) {
      warnings.push(...customValidation(config))
    }

    return {
      success: true,
      data: model,
      warnings: warnings.length > 0 ? warnings : undefined
    }
  }

  /**
   * Validate provider configuration
   */
  validateProvider(config: any, options: ValidationOptions = {}): ValidationResult<ProviderConfig> {
    const { includeWarnings = true, customValidation } = options

    try {
      const result = ProviderConfigSchema.parse(config)

      const warnings: string[] = []

      if (includeWarnings && customValidation) {
        warnings.push(...customValidation(config))
      }

      if (includeWarnings) {
        if (!config.behaviors.requiresApiKeyValidation) {
          warnings.push('Provider does not require API key validation - ensure this is intentional')
        }

        if (config.endpoints.length === 0) {
          warnings.push('No endpoints defined for provider')
        }

        if (config.pricingModel === 'UNIFIED' && !config.behaviors.providesModelMapping) {
          warnings.push('Unified pricing model without model mapping may cause confusion')
        }
      }

      return {
        success: true,
        data: result,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          errors: error.issues
        }
      }

      return {
        success: false,
        errors: [{ code: 'custom' as const, message: 'Unknown validation error', path: [] }]
      }
    }
  }

  /**
   * Validate override configuration
   */
  validateOverride(config: any, options: ValidationOptions = {}): ValidationResult<OverrideConfig> {
    const { includeWarnings = true, customValidation } = options

    try {
      const result = OverrideListSchema.parse(config)

      const warnings: string[] = []

      if (includeWarnings && customValidation) {
        warnings.push(...customValidation(config))
      }

      if (includeWarnings) {
        if (result.overrides.some((override) => !override.reason)) {
          warnings.push('Some overrides lack reason documentation')
        }

        if (result.overrides.some((override) => override.priority > 1000)) {
          warnings.push('Very high priority values may indicate configuration issues')
        }

        // Check for potential conflicts
        const modelProviderPairs = result.overrides.map((o) => `${o.modelId}:${o.providerId}`)
        const duplicates = modelProviderPairs.filter((pair, index) => modelProviderPairs.indexOf(pair) !== index)
        if (duplicates.length > 0) {
          warnings.push(`Duplicate override entries detected: ${duplicates.join(', ')}`)
        }
      }

      return {
        success: true,
        data: result,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          errors: error.issues
        }
      }

      return {
        success: false,
        errors: [{ code: 'custom' as const, message: 'Unknown validation error', path: [] }]
      }
    }
  }

  /**
   * Validate array of configurations
   */
  async validateModelArray(
    configs: any[],
    options: ValidationOptions = {}
  ): Promise<{
    valid: ModelConfig[]
    invalid: { config: any; errors: z.ZodIssue['path'] extends (string | number)[] ? z.ZodIssue : z.ZodIssue[] }[]
    warnings: string[]
  }> {
    const valid: ModelConfig[] = []
    const invalid: {
      config: any
      errors: z.ZodIssue['path'] extends (string | number)[] ? z.ZodIssue : z.ZodIssue[]
    }[] = []
    const allWarnings: string[] = []

    configs.forEach(async (config, index) => {
      const result = await this.validateModel(config, options)

      if (result.success) {
        valid.push(result.data!)
        if (result.warnings) {
          allWarnings.push(...result.warnings.map((w) => `Model ${index}: ${w}`))
        }
      } else {
        invalid.push({ config, errors: result.errors! })
      }
    })

    return { valid, invalid, warnings: allWarnings }
  }

  /**
   * Validate provider array
   */
  validateProviderArray(
    configs: any[],
    options: ValidationOptions = {}
  ): {
    valid: ProviderConfig[]
    invalid: { config: any; errors: z.ZodIssue['path'] extends (string | number)[] ? z.ZodIssue : z.ZodIssue[] }[]
    warnings: string[]
  } {
    const valid: ProviderConfig[] = []
    const invalid: {
      config: any
      errors: z.ZodIssue['path'] extends (string | number)[] ? z.ZodIssue : z.ZodIssue[]
    }[] = []
    const allWarnings: string[] = []

    configs.forEach((config, index) => {
      const result = this.validateProvider(config, options)

      if (result.success) {
        valid.push(result.data!)
        if (result.warnings) {
          allWarnings.push(...result.warnings.map((w) => `Provider ${index}: ${w}`))
        }
      } else {
        invalid.push({ config, errors: result.errors! })
      }
    })

    return { valid, invalid, warnings: allWarnings }
  }

  /**
   * Format validation errors for display
   */
  formatErrors(errors: z.ZodIssue['path'] extends (string | number)[] ? z.ZodIssue : z.ZodIssue[]): string[] {
    return errors.map((error) => {
      const path = error.path.length > 0 ? `${error.path.join('.')}: ` : ''
      return `${path}${error.message}`
    })
  }

  /**
   * Generate validation summary
   */
  generateSummary(results: {
    models: {
      valid: ModelConfig[]
      invalid: { config: any; errors: z.ZodIssue['path'] extends (string | number)[] ? z.ZodIssue : z.ZodIssue[] }[]
      warnings: string[]
    }
    providers: {
      valid: ProviderConfig[]
      invalid: { config: any; errors: z.ZodIssue['path'] extends (string | number)[] ? z.ZodIssue : z.ZodIssue[] }[]
      warnings: string[]
    }
    overrides: ValidationResult<OverrideConfig>
  }): {
    totalModels: number
    validModels: number
    totalProviders: number
    validProviders: number
    overridesValid: boolean
    allWarnings: string[]
  } {
    const { models, providers, overrides } = results

    return {
      totalModels: models.valid.length + models.invalid.length,
      validModels: models.valid.length,
      totalProviders: providers.valid.length + providers.invalid.length,
      validProviders: providers.valid.length,
      overridesValid: overrides.success || false,
      allWarnings: [...models.warnings, ...providers.warnings, ...(overrides.warnings || [])]
    }
  }
}
