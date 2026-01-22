import { promises as fs } from 'fs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import path from 'path'

import type { Provider } from '@/lib/catalog-types'
import {
  ProviderSchema,
  ProvidersDataFileSchema
} from '@/lib/catalog-types'
import {
  createErrorResponse,
  safeParseWithValidation,
  validatePaginatedResponse,
  validateQueryParams,
  ValidationError
} from '@/lib/validation'

const DATA_DIR = path.join(process.cwd(), '../data')

function filterProviders(providers: readonly Provider[], search?: string, authentication?: string[]): Provider[] {
  let filtered = [...providers]

  if (search) {
    const searchLower = search.toLowerCase()
    filtered = filtered.filter(
      (provider) =>
        provider.id.toLowerCase().includes(searchLower) ||
        provider.name.toLowerCase().includes(searchLower) ||
        provider.description?.toLowerCase().includes(searchLower)
    )
  }

  if (authentication && authentication.length > 0) {
    filtered = filtered.filter((provider) => authentication.includes(provider.authentication))
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

    // Read and validate providers data using Zod
    const providersDataPath = path.join(DATA_DIR, 'providers.json')
    const providersDataRaw = await fs.readFile(providersDataPath, 'utf-8')
    const providersData = await safeParseWithValidation(
      providersDataRaw,
      ProvidersDataFileSchema,
      'Invalid providers data format in file'
    )

    // Filter providers with type safety
    const filteredProviders = filterProviders(
      providersData.providers,
      validatedParams.search,
      validatedParams.authentication
    )

    // Paginate results
    const { items, pagination } = paginateItems(filteredProviders, validatedParams.page, validatedParams.limit)

    // Create paginated response using Zod schema
    const response = validatePaginatedResponse({ data: items, pagination }, ProviderSchema)

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error fetching providers:', error)
    return NextResponse.json(
      createErrorResponse('Failed to fetch providers', 500, error instanceof Error ? error.message : 'Unknown error'),
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
      ProvidersDataFileSchema,
      'Invalid providers data format in request body'
    )

    // Write validated data back to file
    const providersDataPath = path.join(DATA_DIR, 'providers.json')
    await fs.writeFile(providersDataPath, JSON.stringify(validatedData, null, 2), 'utf-8')

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error updating providers:', error)
    return NextResponse.json(
      createErrorResponse('Failed to update providers', 500, error instanceof Error ? error.message : 'Unknown error'),
      { status: 500 }
    )
  }
}
