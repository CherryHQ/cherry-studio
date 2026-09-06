import type { CommandOptions } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'

export async function settleAction<T>(session: GuestSession, action: () => Promise<T>, options: CommandOptions = {}) {
  if (!session.pendingDialog) await session.send('Page.getFrameTree', undefined, options)
  const before = session.documentId
  const beforeUrl = session.guest.getURL()
  let navigating = false
  let loaded = false
  let lastNetwork = Date.now()
  const requests = new Set<string>()
  const listener = session.onEvent(({ method, params }) => {
    if (method === 'Page.frameStartedLoading' && params.frameId === session.mainFrameId) {
      navigating = true
      loaded = false
    }
    if (
      method === 'Page.loadEventFired' ||
      (method === 'Page.frameStoppedLoading' && params.frameId === session.mainFrameId)
    )
      loaded = true
    if (method === 'Network.requestWillBeSent' && ['Fetch', 'XHR'].includes(params.type)) {
      requests.add(params.requestId)
      lastNetwork = Date.now()
    }
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      if (requests.delete(params.requestId)) lastNetwork = Date.now()
    }
  })
  try {
    const value = await action()
    const start = Date.now()
    await session.pause(100, options)
    while (true) {
      if (session.pendingDialog) throw new BrowserSessionError('dialog_open', session.pendingDialog)
      if (navigating) {
        if (loaded) break
        if (Date.now() - start >= 10_000) throw new BrowserSessionError('timeout')
      } else {
        if (!requests.size && Date.now() - lastNetwork >= 300) break
        if (Date.now() - start >= 5_000) break
      }
      await session.pause(50, options)
    }
    return { value, navigated: before !== session.documentId || beforeUrl !== session.guest.getURL() }
  } finally {
    listener.dispose()
  }
}
