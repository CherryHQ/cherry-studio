export function normalizeTimeoutMinutes(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

export function timeoutMinutesToMs(minutes: unknown): number | undefined {
  const normalized = normalizeTimeoutMinutes(minutes)
  if (normalized === undefined || normalized <= 0) return undefined
  return normalized * 60 * 1000
}

export function buildCombinedAbortSignal(signals: Array<AbortSignal | undefined | null>): AbortSignal | undefined {
  const validSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (validSignals.length === 0) return undefined
  if (validSignals.length === 1) return validSignals[0]
  return AbortSignal.any(validSignals)
}
