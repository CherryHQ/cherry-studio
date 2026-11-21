export type ModelOption<TRaw = unknown> = {
  label: string
  value: string
  group?: string
  isEnabled?: boolean
  raw?: TRaw
}
