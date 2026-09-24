const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function validateConnection(endpoint: string, expectedUrl: string): void {
  const cdp = new URL(endpoint)
  const main = new URL(expectedUrl)
  if (
    cdp.protocol !== 'http:' ||
    !loopbackHosts.has(cdp.hostname) ||
    cdp.username ||
    cdp.password ||
    cdp.pathname !== '/' ||
    cdp.search ||
    cdp.hash ||
    !((main.protocol === 'file:' && !main.hostname) || (main.protocol === 'http:' && loopbackHosts.has(main.hostname)))
  )
    throw new Error('INVALID_LOCAL_TARGET')
}

export function selectMainTarget(targets: unknown, endpoint: string, expectedUrl: string): string {
  validateConnection(endpoint, expectedUrl)
  if (!Array.isArray(targets)) throw new Error('INVALID_TARGET_LIST')
  const matches = targets.filter((target) => target?.type === 'page' && target?.url === expectedUrl)
  if (matches.length !== 1) throw new Error('EXACT_TARGET_REQUIRED')
  const socket = new URL(matches[0].webSocketDebuggerUrl)
  const server = new URL(endpoint)
  if (socket.protocol !== 'ws:' || socket.host !== server.host || socket.username || socket.password) {
    throw new Error('INVALID_DEBUGGER_TARGET')
  }
  return socket.href
}
