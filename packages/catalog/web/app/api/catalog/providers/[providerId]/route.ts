import { promises as fs } from 'fs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import path from 'path'

import type { ProvidersDataFile } from '@/lib/catalog-types'
import { ProviderSchema, ProvidersDataFileSchema, ProviderUpdateResponseSchema } from '@/lib/catalog-types'
import { createErrorResponse, safeParseWithValidation, ValidationError } from '@/lib/validation'

const DATA_DIR = path.join(process.cwd(), '../data')

export async function GET(request: NextRequest, { params }: { params: { providerId: string } }) {
  try {
    const { providerId } = params

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

export async function PUT(request: NextRequest, { params }: { params: { providerId: string } }) {
  try {
    const { providerId } = params

    // Read and validate request body using Zod
    const requestBody = await request.json()
    const updatedProvider = await safeParseWithValidation(
      JSON.stringify(requestBody),
      ProviderSchema,
      'Invalid provider data in request body'
    )

    // Validate that the provider ID matches
    if (updatedProvider.id !== providerId) {
      return NextResponse.json(createErrorResponse('Provider ID in request body must match URL parameter', 400), {
        status: 400
      })
    }

    // Read current providers data using Zod
    const providersDataPath = path.join(DATA_DIR, 'providers.json')
    const providersDataRaw = await fs.readFile(providersDataPath, 'utf-8')
    const providersData = await safeParseWithValidation(
      providersDataRaw,
      ProvidersDataFileSchema,
      'Invalid providers data format in file'
    )

    // Find and update the provider
    const providerIndex = providersData.providers.findIndex((p) => p.id === providerId)
    if (providerIndex === -1) {
      return NextResponse.json(createErrorResponse('Provider not found', 404), { status: 404 })
    }

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
