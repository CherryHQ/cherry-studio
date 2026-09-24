/** Prometheus integration-domain IpcApi error codes. */
export const prometheusErrorCodes = {
  /** A settings section changed after the renderer loaded it. */
  STALE_INTEGRATION_REVISION: 'PROMETHEUS_STALE_INTEGRATION_REVISION'
} as const
