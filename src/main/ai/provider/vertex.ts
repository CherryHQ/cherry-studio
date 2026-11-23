import * as z from 'zod'

import type { AuthConfig } from '@shared/data/types/provider'

const VERTEX_MAAS_MODEL_ID_PATTERN = /^[^/]+\/[^/]+-maas$/i

const normalizedVertexCredentialsSchema = z.object({
  privateKey: z.string().optional(),
  clientEmail: z.string().optional()
})

export function isVertexMaasModelId(modelId: string): boolean {
  return VERTEX_MAAS_MODEL_ID_PATTERN.test(modelId)
}

/**
 * Vertex service-account credentials may arrive with either camelCase
 * (`privateKey`/`clientEmail`) or snake_case (`private_key`/`client_email`)
 * keys depending on how the JSON key file was stored. Normalize both shapes to
 * the camelCase form the Vertex SDK expects.
 */
export function normalizeVertexCredentials(credentials: Extract<AuthConfig, { type: 'iam-gcp' }>['credentials']) {
  const privateKey = credentials?.privateKey ?? credentials?.private_key
  const clientEmail = credentials?.clientEmail ?? credentials?.client_email

  return normalizedVertexCredentialsSchema.parse({
    ...(privateKey !== undefined && { privateKey }),
    ...(clientEmail !== undefined && { clientEmail })
  })
}
