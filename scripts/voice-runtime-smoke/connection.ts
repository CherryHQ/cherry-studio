import * as z from 'zod'

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
const targetListSchema = z.array(
  z.object({ type: z.string(), url: z.string(), webSocketDebuggerUrl: z.string().optional() })
)

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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- CDP target discovery returns raw HTTP JSON; validate entries and require one exact page before selecting its debugger socket.
export function selectMainTarget(targets: unknown, endpoint: string, expectedUrl: string): string {
  validateConnection(endpoint, expectedUrl)
  const parsed = targetListSchema.safeParse(targets)
  if (!parsed.success) throw new Error('INVALID_TARGET_LIST')
  const matches = parsed.data.filter((target) => target.type === 'page' && target.url === expectedUrl)
  if (matches.length !== 1) throw new Error('EXACT_TARGET_REQUIRED')
  const target = matches[0]
  if (!target.webSocketDebuggerUrl) throw new Error('INVALID_DEBUGGER_TARGET')
  let socket: URL
  try {
    socket = new URL(target.webSocketDebuggerUrl)
  } catch {
    throw new Error('INVALID_DEBUGGER_TARGET')
  }
  const server = new URL(endpoint)
  if (socket.protocol !== 'ws:' || socket.host !== server.host || socket.username || socket.password) {
    throw new Error('INVALID_DEBUGGER_TARGET')
  }
  return socket.href
}
