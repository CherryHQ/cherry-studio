import { promises as fs } from 'fs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import path from 'path'

import type { ModelsDataFile, ProvidersDataFile, OverridesDataFile } from '@/lib/catalog-types'
import { ModelsDataFileSchema, ProvidersDataFileSchema, OverridesDataFileSchema } from '@/lib/catalog-types'
import { createErrorResponse, safeParseWithValidation, ValidationError } from '@/lib/validation'
import { BaseImporter } from '../../../../../../src/utils/importers/base/base-importer'
import { OpenRouterTransformer } from '../../../../../../src/utils/importers/openrouter/transformer'
import { AiHubMixTransformer } from '../../../../../../src/utils/importers/aihubmix/transformer'
import { OpenAICompatibleTransformer } from '../../../../../../src/utils/importers/base/base-transformer'
import { mergeModelsList, MergeStrategies } from '../../../../../../src/utils/merge-utils'
import { generateOverride, mergeOverrides, deduplicateOverrides } from '../../../../../../src/utils/override-utils'

const DATA_DIR = path.join(process.cwd(), '../data')

/**
 * Sync models from provider API
 * POST /api/catalog/providers/[providerId]/sync
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await params
    const body = await request.json().catch(() => ({}))
    const apiKey = body.apiKey as string | undefined

    // Read providers data
    const providersDataPath = path.join(DATA_DIR, 'providers.json')
    const providersDataRaw = await fs.readFile(providersDataPath, 'utf-8')
    const providersData = await safeParseWithValidation(
      providersDataRaw,
      ProvidersDataFileSchema,
      'Invalid providers data format'
    )

    // Find provider
    const provider = providersData.providers.find((p) => p.id === providerId)
    if (!provider) {
      return NextResponse.json(createErrorResponse('Provider not found', 404), { status: 404 })
    }

    // Check if provider has models_api configured
    if (!provider.models_api || !provider.models_api.enabled) {
      return NextResponse.json(
        createErrorResponse(
          'Provider does not have models_api configured or it is disabled',
          400,
          { providerId, has_models_api: !!provider.models_api, enabled: provider.models_api?.enabled }
        ),
        { status: 400 }
      )
    }

    // Read current models data
    const modelsDataPath = path.join(DATA_DIR, 'models.json')
    const modelsDataRaw = await fs.readFile(modelsDataPath, 'utf-8')
    const modelsData = await safeParseWithValidation(
      modelsDataRaw,
      ModelsDataFileSchema,
      'Invalid models data format'
    )

    // Read current overrides data
    const overridesDataPath = path.join(DATA_DIR, 'overrides.json')
    let overridesData: OverridesDataFile
    try {
      const overridesDataRaw = await fs.readFile(overridesDataPath, 'utf-8')
      overridesData = await safeParseWithValidation(
        overridesDataRaw,
        OverridesDataFileSchema,
        'Invalid overrides data format'
      )
    } catch (error) {
      // If overrides.json doesn't exist, create empty structure
      overridesData = {
        version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
        overrides: []
      }
    }

    // Initialize importer and transformer
    const importer = new BaseImporter()
    let transformer

    // Select transformer based on provider
    if (providerId === 'openrouter') {
      transformer = new OpenRouterTransformer()
    } else if (providerId === 'aihubmix') {
      transformer = new AiHubMixTransformer()
    } else {
      // Use default OpenAI-compatible transformer
      transformer = new OpenAICompatibleTransformer()
    }

    // Import models from all endpoints
    const importResults = []
    const allProviderModels = []

    for (const endpoint of provider.models_api.endpoints) {
      try {
        const result = await importer.importFromEndpoint(providerId, endpoint, transformer, apiKey)
        importResults.push(result)
        allProviderModels.push(...result.models)
      } catch (error) {
        console.error(`Failed to import from endpoint ${endpoint.url}:`, error)
        importResults.push({
          providerId,
          endpointType: endpoint.endpoint_type,
          models: [],
          fetchedAt: new Date().toISOString(),
          count: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    // Statistics
    const stats = {
      fetched: allProviderModels.length,
      newModels: 0,
      updatedModels: 0,
      overridesGenerated: 0,
      overridesMerged: 0
    }

    // Merge with existing models.json
    const existingModelIds = new Set(modelsData.models.map((m) => m.id.toLowerCase()))
    const newModels = allProviderModels.filter((m) => !existingModelIds.has(m.id.toLowerCase()))
    stats.newModels = newModels.length

    // Add new models to models.json
    if (newModels.length > 0) {
      modelsData.models = [...modelsData.models, ...newModels]
      stats.updatedModels += newModels.length
    }

    // Generate or update overrides for existing models
    const newOverrides = []
    for (const providerModel of allProviderModels) {
      const baseModel = modelsData.models.find((m) => m.id.toLowerCase() === providerModel.id.toLowerCase())
      if (!baseModel) continue // Skip new models (already added above)

      // Always generate override to mark provider support (even if identical)
      const generatedOverride = generateOverride(baseModel, providerModel, providerId, {
        priority: 0,
        alwaysCreate: true
      })

      if (generatedOverride) {
        // Check if manual override exists (priority >= 100)
        const existingOverride = overridesData.overrides.find(
          (o) => o.provider_id === providerId && o.model_id.toLowerCase() === providerModel.id.toLowerCase()
        )

        if (existingOverride) {
          // Merge with existing override
          const mergedOverride = mergeOverrides(existingOverride, generatedOverride, {
            preserveManual: true,
            manualPriorityThreshold: 100
          })
          newOverrides.push(mergedOverride)
          stats.overridesMerged++
        } else {
          // Add new override
          newOverrides.push(generatedOverride)
          stats.overridesGenerated++
        }
      }
    }

    // Update overrides data
    if (newOverrides.length > 0) {
      // Remove old auto-generated overrides for this provider (priority < 100)
      const filteredOverrides = overridesData.overrides.filter(
        (o) => !(o.provider_id === providerId && o.priority < 100)
      )

      // Add new overrides
      overridesData.overrides = [...filteredOverrides, ...newOverrides]

      // Deduplicate
      overridesData.overrides = deduplicateOverrides(overridesData.overrides)
    }

    // Update last_synced timestamp in provider config
    const updatedProvider = {
      ...provider,
      models_api: {
        ...provider.models_api,
        last_synced: new Date().toISOString()
      }
    }

    const providerIndex = providersData.providers.findIndex((p) => p.id === providerId)
    providersData.providers[providerIndex] = updatedProvider

    // Save all data files
    await fs.writeFile(providersDataPath, JSON.stringify(providersData, null, 2) + '\n', 'utf-8')
    await fs.writeFile(modelsDataPath, JSON.stringify(modelsData, null, 2) + '\n', 'utf-8')
    await fs.writeFile(overridesDataPath, JSON.stringify(overridesData, null, 2) + '\n', 'utf-8')

    // Return sync report
    return NextResponse.json({
      success: true,
      providerId,
      syncedAt: new Date().toISOString(),
      statistics: stats,
      importResults: importResults.map((r) => ({
        endpointType: r.endpointType,
        count: r.count,
        error: (r as any).error
      }))
    })
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error syncing provider models:', error)
    return NextResponse.json(
      createErrorResponse(
        'Failed to sync provider models',
        500,
        error instanceof Error ? error.message : 'Unknown error'
      ),
      { status: 500 }
    )
  }
}
