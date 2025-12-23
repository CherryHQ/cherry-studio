import { promises as fs } from 'fs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import path from 'path'

import type { ProvidersDataFile } from '@/lib/catalog-types'
import { ProviderSchema, ProvidersDataFileSchema, ProviderUpdateResponseSchema } from '@/lib/catalog-types'
import { createErrorResponse, safeParseWithValidation, ValidationError } from '@/lib/validation'

const DATA_DIR = path.join(process.cwd(), '../data')

export async function GET(request: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await params

    // Read and validate providers data using Zod
    const providersDataPath = path.join(DATA_DIR, 'providers.json')
    const providersDataRaw = await fs.readFile(providersDataPath, 'utf-8')
    const providersData = await safeParseWithValidation(
      providersDataRaw,
      ProvidersDataFileSchema,
      'Invalid providers data format in file'
    )

    // Find the provider with type safety
    const provider = providersData.providers.find((p) => p.id === providerId)
    if (!provider) {
      return NextResponse.json(createErrorResponse('Provider not found', 404), { status: 404 })
    }

    return NextResponse.json(provider)
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error fetching provider:', error)
    return NextResponse.json(
      createErrorResponse('Failed to fetch provider', 500, error instanceof Error ? error.message : 'Unknown error'),
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await params

    // Read and validate request body using Zod
    const requestBody = await request.json()

    // Read current providers data using Zod
    const providersDataPath = path.join(DATA_DIR, 'providers.json')
    const providersDataRaw = await fs.readFile(providersDataPath, 'utf-8')
    const providersData = await safeParseWithValidation(
      providersDataRaw,
      ProvidersDataFileSchema,
      'Invalid providers data format in file'
    )

    // Find the provider
    const providerIndex = providersData.providers.findIndex((p) => p.id === providerId)
    if (providerIndex === -1) {
      return NextResponse.json(createErrorResponse('Provider not found', 404), { status: 404 })
    }

    const existingProvider = providersData.providers[providerIndex]

    // Merge existing provider with updates (partial update support)
    const mergedProvider = {
      ...existingProvider,
      ...requestBody,
      id: providerId // Ensure ID cannot be changed
    }

    // Validate the merged provider
    const updatedProvider = await safeParseWithValidation(
      JSON.stringify(mergedProvider),
      ProviderSchema,
      'Invalid provider data after merge'
    )

    // Create updated providers array (immutability)
    const updatedProviders = [
      ...providersData.providers.slice(0, providerIndex),
      updatedProvider,
      ...providersData.providers.slice(providerIndex + 1)
    ]

    const updatedProvidersData: ProvidersDataFile = {
      ...providersData,
      providers: updatedProviders
    }

    // Write back to file
    await fs.writeFile(providersDataPath, JSON.stringify(updatedProvidersData, null, 2), 'utf-8')

    const response = ProviderUpdateResponseSchema.parse({
      success: true,
      provider: updatedProvider
    })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error updating provider:', error)
    return NextResponse.json(
      createErrorResponse('Failed to update provider', 500, error instanceof Error ? error.message : 'Unknown error'),
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
  // PATCH is just an alias for PUT in this case, both support partial updates
  return PUT(request, { params })
}
