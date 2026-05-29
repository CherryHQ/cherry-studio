export interface VertexAiServiceAccountJson {
  projectId?: string
  privateKey: string
  clientEmail: string
}

export type VertexAiConfigField = 'projectId' | 'location' | 'clientEmail' | 'privateKey'

export const VERTEX_AI_CONFIG_FIELD_LABEL_KEYS: Record<VertexAiConfigField, string> = {
  projectId: 'settings.provider.vertex_ai.project_id',
  location: 'settings.provider.vertex_ai.location',
  clientEmail: 'settings.provider.vertex_ai.service_account.client_email',
  privateKey: 'settings.provider.vertex_ai.service_account.private_key'
}

export interface VertexAiLocationOption {
  value: string
  label: string
}

export const DEFAULT_VERTEX_AI_LOCATIONS: VertexAiLocationOption[] = [
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

const getStringField = (value: Record<string, unknown>, field: string): string | undefined => {
  const fieldValue = value[field]

  if (typeof fieldValue !== 'string') {
    return undefined
  }

  const trimmed = fieldValue.trim()
  return trimmed || undefined
}

const hasValue = (value?: string): boolean => !!value?.trim()

export function getMissingVertexAiConfigFields(config: {
  projectId?: string
  location?: string
  serviceAccount?: {
    privateKey?: string
    clientEmail?: string
  }
}): VertexAiConfigField[] {
  const missingFields: VertexAiConfigField[] = []

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

export function parseVertexAiServiceAccountJson(value: string): VertexAiServiceAccountJson | undefined {
  const trimmed = value.trim().replace(/^\uFEFF/, '')

  if (!trimmed.startsWith('{')) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }

    const credentials = parsed as Record<string, unknown>
    const privateKey = getStringField(credentials, 'private_key')
    const clientEmail = getStringField(credentials, 'client_email')

    if (!privateKey || !clientEmail) {
      return undefined
    }

    return {
      privateKey,
      clientEmail,
      projectId: getStringField(credentials, 'project_id')
    }
  } catch {
    return undefined
  }
}

export function mergeVertexAiLocationOptions(
  fetchedLocations: VertexAiLocationOption[],
  currentLocation?: string
): VertexAiLocationOption[] {
  const options = [...DEFAULT_VERTEX_AI_LOCATIONS, ...fetchedLocations]
  const current = currentLocation?.trim()

  if (current) {
    options.unshift({ value: current, label: current })
  }

  const seen = new Set<string>()
  return options.filter((option) => {
    const value = option.value.trim()

    if (!value || seen.has(value)) {
      return false
    }

    seen.add(value)
    return true
  })
}
