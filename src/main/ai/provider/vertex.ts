const VERTEX_MAAS_MODEL_ID_PATTERN = /^[^/]+\/[^/]+-maas$/i

export function isVertexMaasModelId(modelId: string): boolean {
  return VERTEX_MAAS_MODEL_ID_PATTERN.test(modelId)
}

/**
 * Vertex service-account credentials may arrive with either camelCase
 * (`privateKey`/`clientEmail`) or snake_case (`private_key`/`client_email`)
 * keys depending on how the JSON key file was stored. Normalize both shapes to
 * the camelCase form the Vertex SDK expects.
 */
export function normalizeVertexCredentials(credentials: Record<string, unknown> | undefined): {
  privateKey?: string
  clientEmail?: string
} {
  if (!credentials) return {}
  const privateKey = (credentials.privateKey ?? credentials.private_key) as string | undefined
  const clientEmail = (credentials.clientEmail ?? credentials.client_email) as string | undefined
  return {
    ...(privateKey !== undefined && { privateKey }),
    ...(clientEmail !== undefined && { clientEmail })
  }
}
