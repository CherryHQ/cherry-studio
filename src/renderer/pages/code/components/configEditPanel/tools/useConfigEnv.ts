import { useCallback, useMemo } from 'react'

/**
 * Shared accessor for tools whose config body is a flat `env` record
 * (opencode / openclaw / hermes). `env` is read defensively; `updateField`
 * writes a value (or deletes it when empty) and commits the new config body.
 */
export function useConfigEnv(config: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void) {
  const env = useMemo<Record<string, string>>(() => {
    if (!config || typeof config.env !== 'object' || config.env === null) {
      return {}
    }
    return config.env as Record<string, string>
  }, [config])

  const updateField = useCallback(
    (envKey: string, value: string) => {
      const nextEnv = { ...env }
      if (value) {
        nextEnv[envKey] = value
      } else {
        delete nextEnv[envKey]
      }
      onChange({ ...config, env: nextEnv })
    },
    [env, config, onChange]
  )

  return { env, updateField }
}
