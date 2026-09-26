import { useCallback, useMemo, useState } from 'react'

import { useModels } from '@renderer/hooks/useModel'
import i18n from '@renderer/i18n/resolver'
import { formatErrorMessage, serializeHealthCheckError } from '@renderer/utils/error'

import { checkApi, getModelHealthCheckSkipReason, healthCheckErrorToDiagnosis } from '../utils/healthCheck'

/** Short enough that a dead key does not hold the drawer, long enough for a cold provider. */
const PROBE_TIMEOUT_MS = 15_000

export type ApiKeyProbeState =
  | { status: 'probing' }
  | { status: 'ok'; latency: number }
  | { status: 'failed'; message: string }

/**
 * Probe one API key against a chat-capable model of the provider.
 *
 * Results are keyed by the key value rather than its id: a freshly added key is
 * probed before the list refetch hands back its id.
 */
export function useApiKeyProbe(providerId: string) {
  const { models } = useModels({ providerId, enabled: true })
  const [results, setResults] = useState<Record<string, ApiKeyProbeState>>({})

  // Image/audio/TTS models either cannot answer a probe or cost money to run.
  const probeModel = useMemo(() => models.find((model) => getModelHealthCheckSkipReason(model) === null), [models])

  const probe = useCallback(
    async (key: string) => {
      if (!probeModel) return
      setResults((current) => ({ ...current, [key]: { status: 'probing' } }))
      try {
        const { latency } = await checkApi(probeModel.id, { apiKey: key, timeout: PROBE_TIMEOUT_MS })
        setResults((current) => ({ ...current, [key]: { status: 'ok', latency } }))
      } catch (error) {
        // The provider's own words say what happened; the diagnosis says what it means. Both,
        // because "Insufficient Balance" is evidence and "the account is out of credit" is advice.
        const serialized = serializeHealthCheckError(error)
        const diagnosis = healthCheckErrorToDiagnosis(serialized, i18n.t.bind(i18n))
        const raw = formatErrorMessage(error)
        setResults((current) => ({
          ...current,
          [key]: { status: 'failed', message: diagnosis ? `${diagnosis}\n${raw}` : raw }
        }))
      }
    },
    [probeModel]
  )

  return { probe, results, probeModelName: probeModel?.name }
}
