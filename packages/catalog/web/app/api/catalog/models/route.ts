import { promises as fs } from 'fs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import path from 'path'

import type { Model } from '@/lib/catalog-types'
import {
  ModelSchema,
  ModelsDataFileSchema
} from '@/lib/catalog-types'
import {
  createErrorResponse,
  safeParseWithValidation,
  validatePaginatedResponse,
  validateQueryParams,
  ValidationError
} from '@/lib/validation'

const DATA_DIR = path.join(process.cwd(), '../data')

function filterModels(
  models: readonly Model[],
  search?: string,
  capabilities?: string[],
  providers?: string[]
): Model[] {
  let filtered = [...models]

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
    filtered = filtered.filter((model) => capabilities.some((cap) => model.capabilities.includes(cap)))
  }

  if (providers && providers.length > 0) {
    filtered = filtered.filter((model) => model.owned_by && providers.includes(model.owned_by))
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

    // Filter models with type safety
    const filteredModels = filterModels(
      modelsData.models,
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
