import { net } from 'electron'

import { LegacyHealthSchema, V1HealthSchema } from './schemas'
import type { OpenMineruConnection, OpenMineruProbeResult } from './types'

export async function probeOpenMineru(
  connection: OpenMineruConnection,
  signal?: AbortSignal
): Promise<OpenMineruProbeResult> {
  signal?.throwIfAborted()
  const probeSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(3_000)])

  try {
    for (const protocol of ['v1', 'legacy'] as const) {
      const response = await net.fetch(`${connection.apiHost}/${protocol === 'v1' ? 'v1/health' : 'health'}`, {
        headers: connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : undefined,
        redirect: 'manual',
        credentials: 'omit',
        signal: probeSignal
      })
      if (!response.ok) {
        await response.body?.cancel()
        if (response.status === 404) {
          if (protocol === 'v1') continue
          return { kind: 'not-found' }
        }
        return { kind: 'http-error', status: response.status }
      }

      const payload: unknown = await response.json().catch(() => undefined)
      probeSignal.throwIfAborted()
      const schema = protocol === 'v1' ? V1HealthSchema : LegacyHealthSchema
      return schema.safeParse(payload).success ? { kind: 'supported', protocol } : { kind: 'invalid-response' }
    }
    return { kind: 'not-found' }
  } catch {
    signal?.throwIfAborted()
    return { kind: 'unreachable' }
  }
}
