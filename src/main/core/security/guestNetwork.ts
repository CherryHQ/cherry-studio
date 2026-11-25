export const DENY_ALL_PAC = 'function FindProxyForURL(url, host) { return "PROXY 127.0.0.1:1"; }'

export function denyGuestNetwork(session: Electron.Session): Promise<void> {
  return session.setProxy({ pacScript: `data:text/plain,${encodeURIComponent(DENY_ALL_PAC)}` })
}
