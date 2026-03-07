export const DEFAULT_MAX_TOOL_STEPS = 20
export const MAX_MAX_TOOL_STEPS = 500

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
