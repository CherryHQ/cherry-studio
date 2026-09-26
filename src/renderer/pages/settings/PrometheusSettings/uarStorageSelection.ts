import type {
  ServiceCandidate,
  ServiceDiscovery,
  UarStorageConfig
} from '@shared/types/prometheusIntegration'

export type UarStorageSelection = 'embedded' | 'manual' | `candidate:${string}`

const candidateValue = (endpoint: string): UarStorageSelection => `candidate:${new URL(endpoint).href}`

export function uarSurrealDbCandidates(discovery: ServiceDiscovery): ServiceCandidate[] {
  return discovery.candidates.filter((candidate) => candidate.service === 'surrealdb')
}

export function selectedUarStorage(
  config: UarStorageConfig,
  candidates: ServiceCandidate[]
): UarStorageSelection {
  if (config.backend === 'embedded') return 'embedded'
  const endpoint = new URL(config.endpoint).href
  return candidates.some((candidate) => new URL(candidate.endpoint).href === endpoint)
    ? candidateValue(endpoint)
    : 'manual'
}

export function uarStorageUpdate(selection: UarStorageSelection): Partial<UarStorageConfig> {
  if (selection === 'embedded') return { backend: 'embedded' }
  if (selection === 'manual') return { backend: 'remote' }
  return { backend: 'remote', endpoint: selection.slice('candidate:'.length) }
}

export function uarCandidateValue(candidate: ServiceCandidate): UarStorageSelection {
  return candidateValue(candidate.endpoint)
}
