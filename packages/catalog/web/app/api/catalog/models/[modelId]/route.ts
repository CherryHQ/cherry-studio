import { promises as fs } from 'fs'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import path from 'path'

import type { ModelsDataFile } from '@/lib/catalog-types'
import { ModelSchema, ModelsDataFileSchema, ModelUpdateResponseSchema } from '@/lib/catalog-types'
import { createErrorResponse, safeParseWithValidation, ValidationError } from '@/lib/validation'

const DATA_DIR = path.join(process.cwd(), '../data')

export async function GET(request: NextRequest, { params }: { params: { modelId: string } }) {
  try {
    const { modelId } = params

    // Read and validate models data using Zod
    const modelsDataPath = path.join(DATA_DIR, 'models.json')
    const modelsDataRaw = await fs.readFile(modelsDataPath, 'utf-8')
    const modelsData = await safeParseWithValidation(
      modelsDataRaw,
      ModelsDataFileSchema,
      'Invalid models data format in file'
    )

    // Find the model with type safety
    const model = modelsData.models.find((m) => m.id === modelId)
    if (!model) {
      return NextResponse.json(createErrorResponse('Model not found', 404), { status: 404 })
    }

    return NextResponse.json(model)
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error fetching model:', error)
    return NextResponse.json(
      createErrorResponse('Failed to fetch model', 500, error instanceof Error ? error.message : 'Unknown error'),
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, { params }: { params: { modelId: string } }) {
  try {
    const { modelId } = params

    // Read and validate request body using Zod
    const requestBody = await request.json()
    const updatedModel = await safeParseWithValidation(
      JSON.stringify(requestBody),
      ModelSchema,
      'Invalid model data in request body'
    )

    // Validate that the model ID matches
    if (updatedModel.id !== modelId) {
      return NextResponse.json(createErrorResponse('Model ID in request body must match URL parameter', 400), {
        status: 400
      })
    }

    // Read current models data using Zod
    const modelsDataPath = path.join(DATA_DIR, 'models.json')
    const modelsDataRaw = await fs.readFile(modelsDataPath, 'utf-8')
    const modelsData = await safeParseWithValidation(
      modelsDataRaw,
      ModelsDataFileSchema,
      'Invalid models data format in file'
    )

    // Find and update the model
    const modelIndex = modelsData.models.findIndex((m) => m.id === modelId)
    if (modelIndex === -1) {
      return NextResponse.json(createErrorResponse('Model not found', 404), { status: 404 })
    }

    // Create updated models array (immutability)
    const updatedModels = [
      ...modelsData.models.slice(0, modelIndex),
      updatedModel,
      ...modelsData.models.slice(modelIndex + 1)
    ]

    const updatedModelsData: ModelsDataFile = {
      ...modelsData,
      models: updatedModels
    }

    // Write back to file
    await fs.writeFile(modelsDataPath, JSON.stringify(updatedModelsData, null, 2), 'utf-8')

    const response = ModelUpdateResponseSchema.parse({
      success: true,
      model: updatedModel
    })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error('Validation error:', error.message, error.details)
      return NextResponse.json(createErrorResponse(error.message, 400, error.details), { status: 400 })
    }

    console.error('Error updating model:', error)
    return NextResponse.json(
      createErrorResponse('Failed to update model', 500, error instanceof Error ? error.message : 'Unknown error'),
      { status: 500 }
    )
  }
}
