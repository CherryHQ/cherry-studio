import { promises as fs } from 'fs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import path from 'path'

import type { Model, ProviderModelOverride } from '@/lib/catalog-types'
import {
  ModelSchema,
  ModelsDataFileSchema,
  OverridesDataFileSchema
} from '@/lib/catalog-types'
import {
  createErrorResponse,
  safeParseWithValidation,
  validatePaginatedResponse,
  validateQueryParams,
  ValidationError
} from '@/lib/validation'

const DATA_DIR = path.join(process.cwd(), '../data')

/**
 * Apply provider overrides to a model
 */
function applyOverride(model: Model, override: ProviderModelOverride, providerId: string): Model {
  const result = { ...model }

  // Apply capabilities override
  if (override.capabilities) {
    let capabilities = [...(model.capabilities || [])]
    if (override.capabilities.add) {
      capabilities.push(...override.capabilities.add)
    }
    if (override.capabilities.remove) {
      capabilities = capabilities.filter(c => !override.capabilities.remove?.includes(c))
    }
    if (override.capabilities.force) {
      capabilities = override.capabilities.force
    }
    result.capabilities = [...new Set(capabilities)] // Deduplicate
  }

  // Apply limits override
  if (override.limits) {
    if (override.limits.context_window !== undefined) {
      result.context_window = override.limits.context_window
    }
    if (override.limits.max_output_tokens !== undefined) {
      result.max_output_tokens = override.limits.max_output_tokens
    }
  }

  // Apply pricing override
  if (override.pricing) {
    result.pricing = override.pricing
  }

  // Apply reasoning override
  if (override.reasoning) {
    result.reasoning = override.reasoning
  }

  // Apply parameters override
  if (override.parameters) {
    result.parameters = { ...result.parameters, ...override.parameters }
  }

  // Set provider (override the owned_by to show which provider this model is being accessed through)
  result.owned_by = providerId

  return result
}

function filterModels(
  models: readonly Model[],
  overrides: readonly ProviderModelOverride[],
  search?: string,
  capabilities?: string[],
  providers?: string[]
): Model[] {
  let filtered = [...models]

  // Build override map for quick lookup
  const overrideMap = new Map<string, Map<string, ProviderModelOverride>>()
  for (const override of overrides) {
    if (!overrideMap.has(override.provider_id)) {
      overrideMap.set(override.provider_id, new Map())
    }
    overrideMap.get(override.provider_id)!.set(override.model_id.toLowerCase(), override)
  }

  // If providers filter is specified, apply overrides and filter
  if (providers && providers.length > 0) {
    const results: Model[] = []

    for (const model of filtered) {
      for (const providerId of providers) {
        // Check if this model is available for this provider
        const matchesOwnedBy = model.owned_by && model.owned_by === providerId
        const matchesSource = model.metadata?.source && model.metadata.source === providerId
        const override = overrideMap.get(providerId)?.get(model.id.toLowerCase())

        if (matchesOwnedBy || matchesSource || override) {
          // Apply override if exists, otherwise use base model
          const finalModel = override
            ? applyOverride(model, override, providerId)
            : { ...model, owned_by: providerId } // Set provider even without override

          results.push(finalModel)
        }
      }
    }

    filtered = results
  }

  if (search) {
    const searchLower = search.toLowerCase()
    filtered = filtered.filter(
      (model) =>
        model.id.toLowerCase().includes(searchLower) ||
        model.name?.toLowerCase().includes(searchLower) ||
        model.owned_by?.toLowerCase().includes(searchLower)
    )
  }

  if (capabilities && capabilities.length > 0) {
    filtered = filtered.filter((model) => model.capabilities && capabilities.some((cap) => model.capabilities.includes(cap)))
  }

  return filtered
}

function paginateItems<T>(
  items: readonly T[],
  page: number,
  limit: number
): {
  items: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
} {
  const total = items.length
  const totalPages = Math.ceil(total / limit)
  const offset = (page - 1) * limit
  const paginatedItems = items.slice(offset, offset + limit)

  return {
    items: paginatedItems,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Validate query parameters using Zod
    const validatedParams = validateQueryParams(searchParams)

    // Read and validate models data using Zod
    const modelsDataPath = path.join(DATA_DIR, 'models.json')
    const modelsDataRaw = await fs.readFile(modelsDataPath, 'utf-8')
    const modelsData = await safeParseWithValidation(
      modelsDataRaw,
      ModelsDataFileSchema,
      'Invalid models data format in file'
    )

    // Read and validate overrides data using Zod
    const overridesDataPath = path.join(DATA_DIR, 'overrides.json')
    const overridesDataRaw = await fs.readFile(overridesDataPath, 'utf-8')
    const overridesData = await safeParseWithValidation(
      overridesDataRaw,
      OverridesDataFileSchema,
      'Invalid overrides data format in file'
    )

    // Filter models with type safety
    const filteredModels = filterModels(
      modelsData.models,
      overridesData.overrides,
      validatedParams.search,
      validatedParams.capabilities,
      validatedParams.providers
    )

    // Paginate results
    const { items, pagination } = paginateItems(filteredModels, validatedParams.page, validatedParams.limit)

    // Create paginated response using Zod schema
    const response = validatePaginatedResponse({ data: items, pagination }, ModelSchema)

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error fetching models:', error)
    return NextResponse.json(
      createErrorResponse('Failed to fetch models', 500, error instanceof Error ? error.message : 'Unknown error'),
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate the data structure using Zod
    const validatedData = await safeParseWithValidation(
      JSON.stringify(body),
      ModelsDataFileSchema,
      'Invalid models data format in request body'
    )

    // Write validated data back to file
    const modelsDataPath = path.join(DATA_DIR, 'models.json')
    await fs.writeFile(modelsDataPath, JSON.stringify(validatedData, null, 2), 'utf-8')

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error updating models:', error)
    return NextResponse.json(
      createErrorResponse('Failed to update models', 500, error instanceof Error ? error.message : 'Unknown error'),
      { status: 500 }
    )
  }
}
