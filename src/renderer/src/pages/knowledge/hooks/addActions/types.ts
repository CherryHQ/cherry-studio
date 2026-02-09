export interface AddAction {
  handler: () => Promise<void>
  disabled: boolean
  loading: boolean
}
