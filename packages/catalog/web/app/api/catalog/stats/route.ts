import { promises as fs } from 'fs'
import { NextResponse } from 'next/server'
import path from 'path'
import { z } from 'zod'

// Define schema for stats response
const StatsResponseSchema = z.object({
  total_models: z.number(),
  total_providers: z.number(),
  total_overrides: z.number(),
  last_updated: z.string().optional(),
  migration_status: z.enum(['completed', 'in_progress', 'failed']).optional()
})

const DATA_DIR = path.join(process.cwd(), '../data')

// Define schema for migration report
const MigrationReportSchema = z.object({
  summary: z.object({
    total_base_models: z.number(),
    total_providers: z.number(),
    total_overrides: z.number()
  })
})

const ModelsDataSchema = z.object({
  version: z.string(),
  models: z.array(z.any())
})

export async function GET() {
  try {
    // Read migration report for stats with Zod validation
    const reportData = await fs.readFile(path.join(DATA_DIR, 'migration-report.json'), 'utf-8')
    const report = MigrationReportSchema.parse(JSON.parse(reportData))

    // Read actual data for last updated timestamp with Zod validation
    const modelsData = await fs.readFile(path.join(DATA_DIR, 'models.json'), 'utf-8')
    const models = ModelsDataSchema.parse(JSON.parse(modelsData))

    const stats = {
      total_models: report.summary.total_base_models,
      total_providers: report.summary.total_providers,
      total_overrides: report.summary.total_overrides,
      last_updated: new Date().toISOString(),
      version: models.version
    }

    // Validate response with Zod schema
    const validatedStats = StatsResponseSchema.parse(stats)

    return NextResponse.json(validatedStats)
  } catch (error) {
    console.error('Error fetching stats:', error)

    // Try to provide a minimal fallback response
    const fallbackStats = {
      total_models: 0,
      total_providers: 0,
      total_overrides: 0
    }

    try {
      const validatedFallback = StatsResponseSchema.parse(fallbackStats)
      return NextResponse.json(validatedFallback)
    } catch {
      return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
    }
  }
}
