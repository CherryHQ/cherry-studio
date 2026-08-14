export type ModelOption<TRaw = unknown> = {
  label: string
  value: string
  group?: string
  isEnabled?: boolean
  raw?: TRaw
  /** Provider-specific extra data. Keep declared fields strictly typed; put anything else here. */
  meta?: Record<string, unknown>
}
