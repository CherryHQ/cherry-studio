import * as z from 'zod'

export interface VertexAIServiceAccountJson {
  projectId?: string
  privateKey: string
  clientEmail: string
}

export type VertexAIConfigField = 'projectId' | 'location' | 'clientEmail' | 'privateKey'

export interface VertexAILocationOption {
  value: string
  label: string
}

export const DEFAULT_VERTEX_AI_LOCATIONS: VertexAILocationOption[] = [
  { value: 'global', label: 'global' },
  { value: 'us-central1', label: 'us-central1' },
  { value: 'us-east1', label: 'us-east1' },
  { value: 'us-west1', label: 'us-west1' },
  { value: 'europe-west1', label: 'europe-west1' },
  { value: 'europe-west4', label: 'europe-west4' },
  { value: 'asia-east1', label: 'asia-east1' },
  { value: 'asia-northeast1', label: 'asia-northeast1' },
  { value: 'asia-southeast1', label: 'asia-southeast1' }
]

const serviceAccountJsonSchema = z.object({
  private_key: z.string().trim().min(1),
  client_email: z.string().trim().min(1),
  project_id: z.string().trim().optional().catch(undefined)
})

const hasValue = (value?: string): boolean => !!value?.trim()

export function getMissingVertexAIConfigFields(config: {
  projectId?: string
  location?: string
  serviceAccount?: {
    privateKey?: string
    clientEmail?: string
  }
}): VertexAIConfigField[] {
  const missingFields: VertexAIConfigField[] = []

  if (!hasValue(config.projectId)) {
    missingFields.push('projectId')
  }

  if (!hasValue(config.location)) {
    missingFields.push('location')
  }

  if (!hasValue(config.serviceAccount?.clientEmail)) {
    missingFields.push('clientEmail')
  }

  if (!hasValue(config.serviceAccount?.privateKey)) {
    missingFields.push('privateKey')
  }

  return missingFields
}

export function parseVertexAIServiceAccountJson(value: string): VertexAIServiceAccountJson | undefined {
  const trimmed = value.trim().replace(/^\uFEFF/, '')

  if (!trimmed.startsWith('{')) {
    return undefined
  }

  try {
    const parsed = serviceAccountJsonSchema.safeParse(JSON.parse(trimmed))
    if (!parsed.success) return undefined

    return {
      privateKey: parsed.data.private_key,
      clientEmail: parsed.data.client_email,
      projectId: parsed.data.project_id || undefined
    }
  } catch {
    return undefined
  }
}
