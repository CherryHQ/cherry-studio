export interface RuntimeLoginRequest {
  readonly methodId: string
  readonly secret?: string
  readonly provider?: string
}

export interface RuntimeLoginHost {
  showPrompt(prompt: { url?: string; code?: string }): void
  openBrowser(url: string): Promise<void>
  /** Ask the user before opening the displayed URL. */
  confirmBrowser?(
    prompt: { url: string; message: string },
    signal: AbortSignal
  ): Promise<'accept' | 'decline' | 'cancel'>
}

export interface RuntimeAccountIdentity {
  readonly id?: string
  readonly email?: string
  readonly displayName?: string
  readonly workspace?: { readonly id?: string; readonly name?: string }
}

export type RuntimeAccountResult =
  | { readonly status: 'signed-in'; readonly account?: RuntimeAccountIdentity }
  | { readonly status: 'signed-out' | 'unsupported' | 'unknown'; readonly account?: never }

export interface SubscriptionUsageWindow {
  id: string
  label: string
  groupLabel?: string
  usedRatio: number
  durationMinutes?: number
  resetsAt?: number
}

export interface SubscriptionBalance {
  id: string
  label: string
  amount: number
  currency: string
}

export type SubscriptionUsageResult =
  | { status: 'available'; readAt: number; windows: SubscriptionUsageWindow[]; balances?: SubscriptionBalance[] }
  | { status: 'signed-out' }
  | { status: 'unsupported' }
  | { status: 'unavailable' }

export interface RuntimeAccountAccess {
  authenticate?(request: RuntimeLoginRequest, host: RuntimeLoginHost, signal: AbortSignal): Promise<void>
  readAccount?(signal: AbortSignal): Promise<RuntimeAccountResult>
  readSubscriptionUsage?(signal: AbortSignal): Promise<SubscriptionUsageResult>
}
