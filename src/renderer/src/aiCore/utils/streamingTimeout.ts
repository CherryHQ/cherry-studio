export const DEFAULT_MAX_TOOL_STEPS = 20
export const MAX_MAX_TOOL_STEPS = 500

export function normalizeTimeoutMinutes(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.max(0, Math.floor(value))
  return normalized
}

export function timeoutMinutesToMs(minutes: unknown): number | undefined {
  const normalized = normalizeTimeoutMinutes(minutes)
  if (normalized === undefined || normalized <= 0) return undefined
  return normalized * 60 * 1000
}

export function normalizeMaxToolSteps(
  value: unknown,
  options: {
    defaultSteps?: number
    maxSteps?: number
  } = {}
): number {
  const defaultSteps = options.defaultSteps ?? DEFAULT_MAX_TOOL_STEPS
  const maxSteps = options.maxSteps ?? MAX_MAX_TOOL_STEPS

  if (value === undefined || value === null) return defaultSteps
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultSteps

  const normalized = Math.floor(value)
  if (normalized <= 0) return defaultSteps
  return Math.min(normalized, maxSteps)
}

export function buildCombinedAbortSignal(signals: Array<AbortSignal | undefined | null>): AbortSignal | undefined {
  const validSignals = signals.filter((s): s is AbortSignal => Boolean(s))
  if (validSignals.length === 0) return undefined
  if (validSignals.length === 1) return validSignals[0]
  return AbortSignal.any(validSignals)
}
