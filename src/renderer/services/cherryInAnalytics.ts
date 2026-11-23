import { trackProductEvent } from '@renderer/services/productAnalytics'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { oauthErrorCodes } from '@shared/ipc/errors/oauth'

let entryViewed = false

/** Records the CherryIN provider card once per renderer window. */
export function trackCherryInEntryView(signedIn: boolean): void {
  if (entryViewed) return
  entryViewed = true
  trackProductEvent({ event: 'cherryin_entry_view', signedIn })
}

export function cherryInSignInFailureResult(error: unknown): 'cancelled' | 'failed' {
  return error instanceof IpcError && error.code === oauthErrorCodes.SIGN_IN_CANCELLED ? 'cancelled' : 'failed'
}

/** The top-up page carries the click's attribution so CherryIN orders can be joined to it. */
export function buildCherryInTopupUrl(topupUrl: string, flowId: string): string {
  const url = new URL(topupUrl)
  url.searchParams.set('entry', 'desktop')
  url.searchParams.set('entry_source', 'provider_settings')
  url.searchParams.set('flow_id', flowId)
  return url.toString()
}
