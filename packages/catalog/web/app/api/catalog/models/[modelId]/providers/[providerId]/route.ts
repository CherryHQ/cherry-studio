import { promises as fs } from 'fs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import path from 'path'
import { z } from 'zod'

import type { Model, ProviderModelOverride, OverridesDataFile } from '@/lib/catalog-types'
import {
  ModelSchema,
  ModelsDataFileSchema,
  ProvidersDataFileSchema,
  OverridesDataFileSchema
} from '@/lib/catalog-types'
import { safeParseWithValidation, validateString, ValidationError, createErrorResponse } from '@/lib/validation'

const DATA_DIR = path.join(process.cwd(), '../data')

// Type-safe helper function to detect model modifications
function detectModifications(
  baseModel: Model,
  updatedModel: Partial<Model>
): {
  pricing: Model['pricing'] | undefined
  limits:
    | {
        context_window?: number
        max_output_tokens?: number
      }
    | undefined
} | null {
  const modifications: {
    pricing: Model['pricing'] | undefined
    limits:
      | {
          context_window?: number
          max_output_tokens?: number
        }
      | undefined
  } = {
    pricing: undefined,
    limits: undefined
  }

  // Check for differences in pricing
  if (JSON.stringify(baseModel.pricing) !== JSON.stringify(updatedModel.pricing)) {
    modifications.pricing = updatedModel.pricing
  }

  // Check for differences in limits
  if (
    baseModel.context_window !== updatedModel.context_window ||
    baseModel.max_output_tokens !== updatedModel.max_output_tokens
  ) {
    modifications.limits = {}
    if (baseModel.context_window !== updatedModel.context_window) {
      modifications.limits.context_window = updatedModel.context_window
    }
    if (baseModel.max_output_tokens !== updatedModel.max_output_tokens) {
      modifications.limits.max_output_tokens = updatedModel.max_output_tokens
    }
  }

  return modifications.pricing || modifications.limits ? modifications : null
}

export async function GET(request: NextRequest, { params }: { params: { modelId: string; providerId: string } }) {
  try {
    const { modelId, providerId } = params

    // Validate parameters
    const validModelId = validateString(modelId, 'modelId')
    const validProviderId = validateString(providerId, 'providerId')

    // Read and validate all data files
    const [modelsDataRaw] = await fs.readFile(path.join(DATA_DIR, 'models.json'), 'utf-8')
      // fs.readFile(path.join(DATA_DIR, 'overrides.json'), 'utf-8')


    const modelsData = await safeParseWithValidation(
      modelsDataRaw,
      ModelsDataFileSchema,
      'Invalid models data format in file'
    )
    // const providersData = await safeParseWithValidation(
    //   providersDataRaw,
    //   ProvidersDataFileSchema,
    //   'Invalid providers data format in file'
    // )
    // const overridesData = await safeParseWithValidation(
    //   overridesDataRaw,
    //   OverridesDataFileSchema,
    //   'Invalid overrides data format in file'
    // )

    // Find base model
    const baseModel = modelsData.models.find((m) => m.id === validModelId)
    if (!baseModel) {
      return NextResponse.json(createErrorResponse('Model not found', 404), { status: 404 })
    }

    // Find provider override for this model
    // const override = overridesData.overrides.find(
    //   (o) => o.model_id === validModelId && o.provider_id === validProviderId
    // )

    // // Apply override if exists - may throw if model is disabled
    // try {
    //   const finalModel = applyOverrides(baseModel, override || null)
    //   return NextResponse.json(ModelSchema.parse(finalModel))
    // } catch (error) {
    //   if (error instanceof OverrideApplicationError) {
    //     return NextResponse.json(
    //       createErrorResponse(error.message, 403),
    //       { status: 403 }
    //     )
    //   }
    //   throw error
    // }
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error fetching provider model:', error)
    return NextResponse.json(
      createErrorResponse(
        'Failed to fetch model configuration',
        500,
        error instanceof Error ? error.message : 'Unknown error'
      ),
      { status: 500 }
    )
  }
}

// Response schema for provider model updates
const ProviderModelUpdateResponseSchema = z.object({
  updated: z.enum(['base_model', 'override', 'override_updated', 'override_removed']),
  model: ModelSchema
})

export async function PUT(request: NextRequest, { params }: { params: { modelId: string; providerId: string } }) {
  try {
    const { modelId, providerId } = params

    // Validate parameters
    const validModelId = validateString(modelId, 'modelId')
    const validProviderId = validateString(providerId, 'providerId')

    // Validate request body
    const requestBody = await request.json()
    const updatedModel = await safeParseWithValidation(
      JSON.stringify(requestBody),
      ModelSchema.partial(),
      'Invalid model data in request body'
    )

    // Read and validate current data
    const [modelsDataRaw, providersDataRaw, overridesDataRaw] = await Promise.all([
      fs.readFile(path.join(DATA_DIR, 'models.json'), 'utf-8'),
      fs.readFile(path.join(DATA_DIR, 'providers.json'), 'utf-8'),
      fs.readFile(path.join(DATA_DIR, 'overrides.json'), 'utf-8')
    ])

    const modelsData = await safeParseWithValidation(
      modelsDataRaw,
      ModelsDataFileSchema,
      'Invalid models data format in file'
    )
    const providersData = await safeParseWithValidation(
      providersDataRaw,
      ProvidersDataFileSchema,
      'Invalid providers data format in file'
    )
    const overridesData = await safeParseWithValidation(
      overridesDataRaw,
      OverridesDataFileSchema,
      'Invalid overrides data format in file'
    )

    // Find base model and existing override
    const baseModelIndex = modelsData.models.findIndex((m) => m.id === validModelId)
    const existingOverrideIndex = overridesData.overrides.findIndex(
      (o) => o.model_id === validModelId && o.provider_id === validProviderId
    )

    if (baseModelIndex === -1) {
      return NextResponse.json(createErrorResponse('Base model not found', 404), { status: 404 })
    }

    const baseModel = modelsData.models[baseModelIndex]

    // Detect what needs to be overridden
    const modifications = detectModifications(baseModel, updatedModel)

    let updated: 'base_model' | 'override' | 'override_updated' | 'override_removed' = 'base_model'
    let overrideCreated = false

    if (modifications) {
      // Create or update override
      const override: ProviderModelOverride = {
        provider_id: validProviderId,
        model_id: validModelId,
        disabled: false,
        reason: 'Manual configuration update',
        priority: 100,
        ...modifications
      }

      const updatedOverrides = [...overridesData.overrides]

      if (existingOverrideIndex >= 0) {
        updatedOverrides[existingOverrideIndex] = {
          ...updatedOverrides[existingOverrideIndex],
          ...override
        }
      } else {
        updatedOverrides.push(override)
        overrideCreated = true
      }

      const updatedOverridesData: OverridesDataFile = {
        ...overridesData,
        overrides: updatedOverrides
      }

      updated = overrideCreated ? 'override' : 'override_updated'

      // Save changes to overrides file
      await fs.writeFile(path.join(DATA_DIR, 'overrides.json'), JSON.stringify(updatedOverridesData, null, 2), 'utf-8')
    } else if (existingOverrideIndex >= 0) {
      // Remove override if no differences exist
      const updatedOverrides = overridesData.overrides.filter((_, index) => index !== existingOverrideIndex)

      const updatedOverridesData: OverridesDataFile = {
        ...overridesData,
        overrides: updatedOverrides
      }

      updated = 'override_removed'

      // Save changes to overrides file
      await fs.writeFile(path.join(DATA_DIR, 'overrides.json'), JSON.stringify(updatedOverridesData, null, 2), 'utf-8')
    }

    // Return the final model configuration
    const finalOverride = overridesData.overrides.find(
      (o) => o.model_id === validModelId && o.provider_id === validProviderId
    )
    const finalModel = applyOverrides(baseModel, finalOverride || null)

    const response = ProviderModelUpdateResponseSchema.parse({
      updated,
      model: finalModel
    })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error updating provider model:', error)
    return NextResponse.json(
      createErrorResponse(
        'Failed to update model configuration',
        500,
        error instanceof Error ? error.message : 'Unknown error'
      ),
      { status: 500 }
    )
  }
}
