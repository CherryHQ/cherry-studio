export interface TelemetryConfig {
  serviceName: string
  endpoint?: string
  headers?: Record<string, string>
  defaultTracerName?: string
}

export interface TraceConfig extends TelemetryConfig {
  maxAttributesPerSpan?: number
}

/** Mutated in place by {@link NodeTracer.init}; readers pick up the tracer name set at boot. */
export const defaultConfig: TelemetryConfig = {
  serviceName: 'default',
  headers: {},
  defaultTracerName: 'default'
}
