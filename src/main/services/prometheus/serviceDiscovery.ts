import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import { getBinaryPath } from '@main/utils/binaryResolver'
import type {
  IntegrationConfig,
  IntegrationService,
  ServiceCandidate,
  ServiceDiscovery
} from '@shared/types/prometheusIntegration'

import { runIntegrationProcess } from './integrationProcess'

const endpoint = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
  })
const provenanceSchema = z
  .object({
    source: z.literal('full-pack'),
    ownership: z.literal('external'),
    label: z.string().min(1).max(128),
    markers: z.array(z.string().max(4096)).max(16),
    sourceVersion: z.string().max(128).optional(),
    configPath: z.string().max(4096).optional()
  })
  .strict()
const discoverySchema = z
  .object({
    code: z.literal(0),
    candidates: z
      .array(
        z
          .object({
            id: z.string(),
            service: z.enum(['surrealdb', 'memory', 'liter']),
            endpoint,
            provenance: z.array(provenanceSchema).min(1).max(4)
          })
          .strict()
      )
      .max(12)
  })
  .passthrough()

function applicationCandidates(config: IntegrationConfig): ServiceCandidate[] {
  const entries: Array<[IntegrationService, string]> = [
    ['surrealdb', `http://127.0.0.1:${config.services.surrealPort}`],
    ['memory', `http://127.0.0.1:${config.services.memoryPort}/mcp/sse`],
    ['liter', `http://127.0.0.1:${config.services.literPort}`]
  ]
  return entries.map(([service, value]) => ({
    id: `${service}:${new URL(value).href}`,
    service,
    endpoint: new URL(value).href,
    provenance: [
      {
        source: 'application',
        ownership: 'managed',
        label: 'The Boss',
        markers: [application.getPath('feature.prometheus.state')]
      }
    ]
  }))
}

function selectedCandidates(config: IntegrationConfig): ServiceCandidate[] {
  return (['surrealdb', 'memory', 'liter'] as const)
    .map((service) => [service, config.services[service]] as const)
    .filter(([, profile]) => profile.source !== 'application')
    .map(([service, profile]) => ({
      id: `${service}:${new URL(profile.endpoint).href}`,
      service,
      endpoint: new URL(profile.endpoint).href,
      provenance: [
        {
          source: profile.source,
          ownership: profile.ownership,
          label: profile.source === 'full-pack' ? 'Prometheus full pack' : 'Manual endpoint',
          markers: []
        }
      ]
    }))
}

function mergeCandidates(candidates: ServiceCandidate[]): ServiceCandidate[] {
  const merged = new Map<string, ServiceCandidate>()
  for (const candidate of candidates) {
    const endpoint = new URL(candidate.endpoint).href
    const key = `${candidate.service}:${endpoint}`
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...candidate, id: key, endpoint, provenance: [...candidate.provenance] })
      continue
    }
    for (const provenance of candidate.provenance) {
      if (
        !existing.provenance.some(
          (current) => current.source === provenance.source && current.ownership === provenance.ownership
        )
      ) {
        existing.provenance.push(provenance)
      }
    }
  }
  return [...merged.values()].sort((left, right) =>
    `${left.service}:${left.endpoint}`.localeCompare(`${right.service}:${right.endpoint}`)
  )
}

export async function discoverServiceCandidates(
  config: IntegrationConfig,
  signal?: AbortSignal
): Promise<ServiceDiscovery> {
  const local = [...applicationCandidates(config), ...selectedCandidates(config)]
  try {
    const node = await getBinaryPath('node')
    const output = await runIntegrationProcess(
      node,
      [
        path.join(application.getPath('feature.prometheus.pack.runtime'), 'scripts', 'services.mjs'),
        'discover',
        '--json'
      ],
      { signal }
    )
    const discovered = discoverySchema.parse(JSON.parse(output))
    return { candidates: mergeCandidates([...local, ...(discovered.candidates as ServiceCandidate[])]), errors: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { candidates: mergeCandidates(local), errors: [message] }
  }
}
