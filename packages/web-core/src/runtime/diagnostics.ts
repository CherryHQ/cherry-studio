// Browser stand-in for `@main/core/diagnostics`; the Node CPU profiler and lag sampler do not apply.
export const DIAGNOSTICS_ENABLED = false

export const SLOW_THRESHOLD_MS = {
  dbQuery: 15,
  ipcHandler: 50,
  dataApiRequest: 50
} as const
